"""
RetailCLIQ DocAI Gateway (FastAPI)
- Starts & monitors the Node.js DocAI server (port 4010) as a subprocess
- Proxies all /api/docai/* requests to the Node.js service
- Re-creates the supervisor config on every startup (as a backup)
"""
import asyncio
import os
import subprocess
import signal
import logging
import httpx
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DOCAI_NODE_DIR = Path('/app/services/docai-node')
DOCAI_NODE_BASE = 'http://127.0.0.1:4010'
NODE_PROC: subprocess.Popen | None = None

# ─────────────────────────────────────────── supervisor config (persistent backup)
SUPERVISOR_CONF_PATH = '/etc/supervisor/conf.d/docai-node.conf'
SUPERVISOR_CONF = """\
[program:docai-node]
command=node server/index.js
directory=/app/services/docai-node
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/docai-node.err.log
stdout_logfile=/var/log/supervisor/docai-node.out.log
stopsignal=TERM
stopwaitsecs=30
stopasgroup=true
killasgroup=true
"""

def ensure_supervisor_conf():
    """Write supervisor config so it survives pod restarts via /etc (if writable)."""
    try:
        conf_path = Path(SUPERVISOR_CONF_PATH)
        if not conf_path.exists() or conf_path.read_text() != SUPERVISOR_CONF:
            conf_path.write_text(SUPERVISOR_CONF)
            logger.info("Supervisor config written/updated at %s", SUPERVISOR_CONF_PATH)
    except Exception as e:
        logger.warning("Could not write supervisor config (non-fatal): %s", e)


def ensure_system_tools():
    """Install system tools (poppler-utils, tesseract-ocr) and light-OCR models if missing."""
    import shutil
    tools_to_install = []
    
    if not shutil.which('pdftoppm'):
        tools_to_install.append('poppler-utils')
        
    if not shutil.which('tesseract'):
        tools_to_install.extend(['tesseract-ocr', 'tesseract-ocr-eng', 'tesseract-ocr-hin',
                                  'tesseract-ocr-tel', 'tesseract-ocr-tam', 'tesseract-ocr-kan',
                                  'tesseract-ocr-mar', 'tesseract-ocr-guj', 'tesseract-ocr-ben',
                                  'tesseract-ocr-ori', 'tesseract-ocr-pan'])

    if tools_to_install:
        logger.info(f"Installing missing tools: {', '.join(tools_to_install)}")
        try:
            result = subprocess.run(
                ['apt-get', 'install', '-y', '-q'] + tools_to_install,
                capture_output=True, timeout=180
            )
            if result.returncode == 0:
                logger.info(f"Installed: {', '.join(tools_to_install)}")
            else:
                logger.warning(f"Tool install failed: {result.stderr.decode()[:200]}")
        except Exception as e:
            logger.warning(f"Could not install tools: {e}")
    else:
        logger.info("All system tools available (poppler, tesseract)")

    # Ensure light-OCR npm dependency is installed
    node_modules = Path('/app/services/docai-node/node_modules/onnxruntime-node')
    if not node_modules.exists():
        logger.info("Installing light-OCR deps (onnxruntime-node, sharp)...")
        try:
            subprocess.run(['npm', 'install', 'onnxruntime-node', 'sharp', '@arcships/light-ocr',
                           '--prefix', '/app/services/docai-node'],
                          capture_output=True, timeout=120)
            logger.info("light-OCR deps installed")
        except Exception as e:
            logger.warning(f"light-OCR npm install failed: {e}")


# ─────────────────────────────────────────── Node.js process management
async def wait_for_node(timeout: float = 30.0) -> bool:
    """Poll until Node.js DocAI server responds on :4010."""
    client = httpx.AsyncClient(timeout=2.0)
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            r = await client.get(f'{DOCAI_NODE_BASE}/api/docai/health')
            if r.status_code == 200:
                await client.aclose()
                return True
        except Exception:
            pass
        await asyncio.sleep(1.0)
    await client.aclose()
    return False


def start_node_process() -> subprocess.Popen | None:
    """Start the Node.js DocAI server if not already running."""
    # Check if already running (supervisor may have started it)
    try:
        r = httpx.get(f'{DOCAI_NODE_BASE}/api/docai/health', timeout=3.0)
        if r.status_code == 200:
            logger.info("Node.js DocAI server already running (supervisor)")
            return None
    except Exception:
        pass

    if not DOCAI_NODE_DIR.exists():
        logger.error("Node DocAI directory not found: %s", DOCAI_NODE_DIR)
        return None

    # Ensure node_modules exist (in case of first run or partial state)
    if not (DOCAI_NODE_DIR / 'node_modules').exists():
        logger.info("Installing Node.js dependencies in %s …", DOCAI_NODE_DIR)
        try:
            subprocess.run(['npm', 'install', '--production', '--loglevel=warn'],
                           cwd=str(DOCAI_NODE_DIR), timeout=120, check=True)
        except Exception as e:
            logger.warning("npm install failed: %s", e)

    log_dir = Path('/var/log/supervisor')
    log_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Starting Node.js DocAI server...")
    proc = subprocess.Popen(
        ['node', 'server/index.js'],
        cwd=str(DOCAI_NODE_DIR),
        stdout=open('/var/log/supervisor/docai-node.out.log', 'a'),
        stderr=open('/var/log/supervisor/docai-node.err.log', 'a'),
        preexec_fn=os.setsid,
        env={**os.environ, 'PORT': '4010'},
    )
    logger.info("Node.js DocAI server started with PID %d", proc.pid)
    return proc


async def monitor_node(proc: subprocess.Popen | None):
    """Background task: restart Node.js if it dies."""
    global NODE_PROC
    while True:
        await asyncio.sleep(10)
        # Check liveness
        try:
            r = httpx.get(f'{DOCAI_NODE_BASE}/api/docai/health', timeout=3.0)
            if r.status_code == 200:
                continue
        except Exception:
            pass

        logger.warning("Node.js DocAI server not responding — restarting…")
        if NODE_PROC:
            try:
                os.killpg(os.getpgid(NODE_PROC.pid), signal.SIGTERM)
            except Exception:
                pass
        NODE_PROC = start_node_process()
        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global NODE_PROC
    # 1. Recreate supervisor config (idempotent) and ensure system tools
    ensure_supervisor_conf()
    ensure_system_tools()

    # 2. Start Node.js (or confirm it's already running)
    NODE_PROC = start_node_process()

    # 3. Wait up to 30 s for it to be ready
    ready = await wait_for_node(30.0)
    if ready:
        logger.info("Node.js DocAI server is ready on :4010")
    else:
        logger.error("Node.js DocAI server did NOT start within 30 s — proxy will fail until it starts")

    # 4. Start watchdog
    monitor_task = asyncio.create_task(monitor_node(NODE_PROC))

    yield  # ← app is running

    # 5. Shutdown
    monitor_task.cancel()
    if NODE_PROC:
        logger.info("Stopping Node.js DocAI server (PID %d)…", NODE_PROC.pid)
        try:
            os.killpg(os.getpgid(NODE_PROC.pid), signal.SIGTERM)
            NODE_PROC.wait(timeout=10)
        except Exception as e:
            logger.warning("Node stop error: %s", e)


# ─────────────────────────────────────────── FastAPI app
app = FastAPI(title='RetailCLIQ DocAI Gateway', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=['*'],
    allow_headers=['*'],
)

# Long-lived httpx client for proxying (300 s timeout for Sarvam OCR jobs)
http_client = httpx.AsyncClient(
    base_url=DOCAI_NODE_BASE,
    timeout=httpx.Timeout(300.0, connect=10.0),
    follow_redirects=True,
)


# ─────────────────────────────────────────── proxy helpers
async def _proxy(request: Request, url: str) -> Response:
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ('host', 'content-length')}
    body = await request.body()
    is_sse = 'text/event-stream' in request.headers.get('accept', '') or url.endswith('/events')

    if is_sse:
        async def _stream():
            async with http_client.stream(
                request.method, url,
                headers=headers, content=body or None,
                params=dict(request.query_params),
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

        return StreamingResponse(
            _stream(), media_type='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'},
        )

    try:
        resp = await http_client.request(
            request.method, url,
            headers=headers,
            content=body or None,
            params=dict(request.query_params),
        )
        resp_headers = {k: v for k, v in resp.headers.items()
                        if k.lower() not in ('transfer-encoding', 'content-encoding')}
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
            media_type=resp.headers.get('content-type', 'application/json'),
        )
    except httpx.TimeoutException:
        return Response(content='{"error":"DocAI service timeout"}', status_code=504, media_type='application/json')
    except Exception as e:
        logger.error("Proxy error: %s", e)
        return Response(content=f'{{"error":"DocAI proxy error: {e}"}}', status_code=502, media_type='application/json')


# ─────────────────────────────────────────── routes
@app.api_route('/api/docai/intake/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
async def proxy_intake(request: Request, path: str):
    return await _proxy(request, f'/api/docai/intake/{path}')

@app.api_route('/api/docai/intake', methods=['GET', 'POST'])
async def proxy_intake_root(request: Request):
    return await _proxy(request, '/api/docai/intake')

@app.api_route('/api/docai/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
async def proxy_docai(request: Request, path: str):
    return await _proxy(request, f'/api/docai/{path}')

@app.api_route('/api/docai', methods=['GET', 'POST'])
async def proxy_docai_root(request: Request):
    return await _proxy(request, '/api/docai')

# Proxy i18n routes to Node.js (globalization module)
@app.api_route('/api/i18n/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
async def proxy_i18n(request: Request, path: str):
    return await _proxy(request, f'/api/i18n/{path}')

@app.api_route('/api/i18n', methods=['GET', 'POST'])
async def proxy_i18n_root(request: Request):
    return await _proxy(request, '/api/i18n')
@app.get('/api/')
async def root():
    return {'message': 'RetailCLIQ DocAI Gateway', 'node': DOCAI_NODE_BASE}


# ──────────────────────────────────────────────────────── cron endpoint ──
import hashlib, hmac as _hmac

@app.post('/api/cron/digest')
async def cron_daily_digest(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get('WEBHOOK_CRON_SECRET', '')
    auth = request.headers.get('authorization', '')
    token = auth.replace('Bearer ', '').strip()
    if secret and not _hmac.compare_digest(token, secret):
        return Response(content='{"error":"unauthorized"}', status_code=401, media_type='application/json')
    # Forward to Node.js dashboard/send-digest in background
    import asyncio
    async def _trigger():
        try:
            await http_client.post('/api/docai/dashboard/send-digest', json={'source': 'cron'})
        except Exception as e:
            logger.warning(f'Cron digest trigger error: {e}')
    asyncio.create_task(_trigger())
    return {'accepted': True, 'message': 'Daily digest triggered'}


@app.on_event('shutdown')
async def shutdown():
    await http_client.aclose()
