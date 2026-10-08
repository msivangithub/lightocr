const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/docai`;

async function api(path, opt = {}) {
  const headers = {};
  if (opt.body && !(opt.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(API + path, {
    headers,
    ...opt,
    body: opt.body instanceof FormData ? opt.body : opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

export { api, API };
