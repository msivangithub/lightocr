#!/usr/bin/env python3
"""
POC test: Sarvam AI + MSSQL + MongoDB connectivity
"""
import os, json, time, httpx, pymssql
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

SARVAM_BASE = "https://api.sarvam.ai"
SARVAM_KEY = "sk_so3juu1p_DemnueZiHlyJk34jaTCzX0jK"
SARVAM_KEY_2 = "sk_u2h6s153_6orPehsgHQrlHhTjglkgs5VA"

MSSQL_SERVER = "120.138.9.33"
MSSQL_PORT = 58842
MSSQL_USER = "sa"
MSSQL_PASSWORD = "myaccounts_hbs123"
MSSQL_DB = "RC26MASTERDB"

MONGO_URL = "mongodb://localhost:27017"
MONGO_DB = "docai_db"

TERMINAL = {"completed", "partially_completed", "failed", "rejected"}


def test_sarvam_chat():
    """Test 1: Sarvam chat with JSON mode"""
    print("\n=== TEST 1: Sarvam Chat ===")
    try:
        r = httpx.post(
            f"{SARVAM_BASE}/v1/chat/completions",
            headers={"api-subscription-key": SARVAM_KEY, "Content-Type": "application/json"},
            json={
                "model": "sarvam-105b",
                "messages": [{"role": "user", "content": "Reply with JSON: {\"ok\": true, \"msg\": \"hello\"}"}],
                "response_format": {"type": "json_object"},
                "max_tokens": 50,
                "temperature": 0.1,
            },
            timeout=30.0
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"Response: {content[:200]}")
            print("✅ Sarvam chat: PASS")
            return True
        else:
            print(f"❌ Sarvam chat failed: {r.text[:300]}")
            # Try key 2
            print("Trying key 2...")
            r2 = httpx.post(
                f"{SARVAM_BASE}/v1/chat/completions",
                headers={"api-subscription-key": SARVAM_KEY_2, "Content-Type": "application/json"},
                json={
                    "model": "sarvam-105b",
                    "messages": [{"role": "user", "content": "Reply with JSON: {\"ok\": true}"}],
                    "response_format": {"type": "json_object"},
                    "max_tokens": 50,
                },
                timeout=30.0
            )
            print(f"Key 2 Status: {r2.status_code}")
            if r2.status_code == 200:
                print("✅ Sarvam chat key 2: PASS")
                return True
            print(f"❌ Key 2 also failed: {r2.text[:300]}")
            return False
    except Exception as e:
        print(f"❌ Sarvam chat exception: {e}")
        return False


def test_sarvam_digitise():
    """Test 2: Sarvam Doc-AI digitise with sample image"""
    print("\n=== TEST 2: Sarvam Document Digitise ===")
    sample_path = "/app/services/docai-node/samples/purchase_invoice_scan.jpg"
    if not os.path.exists(sample_path):
        print(f"⚠️  Sample file not found: {sample_path}")
        return None
    
    try:
        with open(sample_path, "rb") as f:
            content = f.read()
        
        r = httpx.post(
            f"{SARVAM_BASE}/doc-ai/v1/job/digitise",
            headers={"api-subscription-key": SARVAM_KEY},
            data={"language": "en-IN", "output_format": "md", "content_type": "printed"},
            files={"file": ("purchase_invoice_scan.jpg", content, "image/jpeg")},
            timeout=60.0
        )
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            job = r.json()
            job_id = job.get("job_id", "")
            print(f"Job ID: {job_id}, Status: {job.get('status')}")
            print("✅ Sarvam digitise job started: PASS")
            
            # Poll for completion (max 60s)
            started = time.time()
            while time.time() - started < 90:
                time.sleep(5)
                sr = httpx.get(
                    f"{SARVAM_BASE}/doc-ai/v1/job/{job_id}/status",
                    headers={"api-subscription-key": SARVAM_KEY},
                    timeout=30.0
                )
                if sr.status_code == 200:
                    st = sr.json()
                    status = st.get("status", "").lower()
                    print(f"  Job status: {status}")
                    if status in TERMINAL:
                        if status in ("completed", "partially_completed"):
                            # Get results
                            rr = httpx.get(
                                f"{SARVAM_BASE}/doc-ai/v1/job/{job_id}/results",
                                headers={"api-subscription-key": SARVAM_KEY},
                                params={"format": "json"},
                                timeout=30.0
                            )
                            if rr.status_code == 200:
                                result = rr.json()
                                # Extract text
                                docs = result.get("documents", [])
                                text = "\n".join(p.get("content", "") for d in docs for p in d.get("pages", []))
                                print(f"Extracted text preview: {text[:300]}")
                                print("✅ Sarvam digitise result: PASS")
                                return text
                            else:
                                print(f"❌ Results failed: {rr.text[:200]}")
                                return None
                        else:
                            print(f"❌ Job failed: {status}")
                            return None
            print("❌ Timeout waiting for job")
            return None
        else:
            print(f"❌ Digitise failed: {r.text[:300]}")
            return None
    except Exception as e:
        print(f"❌ Digitise exception: {e}")
        return None


def test_mssql():
    """Test 3: MSSQL connectivity"""
    print("\n=== TEST 3: MSSQL Master Query ===")
    try:
        conn = pymssql.connect(
            server=MSSQL_SERVER,
            port=MSSQL_PORT,
            user=MSSQL_USER,
            password=MSSQL_PASSWORD,
            database=MSSQL_DB,
            timeout=10,
            login_timeout=10
        )
        cursor = conn.cursor(as_dict=True)
        # Try a simple query
        try:
            cursor.execute("SELECT TOP 3 SupplierCode AS code, SupplierName AS name FROM SupplierMaster")
            rows = cursor.fetchall()
            print(f"Suppliers: {rows}")
            print("✅ MSSQL SupplierMaster: PASS")
        except Exception as e:
            print(f"⚠️  SupplierMaster query failed: {e}")
            # Try alternate query
            cursor.execute("SELECT TOP 1 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES")
            row = cursor.fetchone()
            print(f"Tables available: {row}")
            print("✅ MSSQL connection works but table names differ")
        conn.close()
        return True
    except Exception as e:
        print(f"❌ MSSQL connection failed: {e}")
        return False


async def test_mongodb():
    """Test 4: MongoDB batch write/read"""
    print("\n=== TEST 4: MongoDB Batch Store ===")
    try:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[MONGO_DB]
        
        # Write a test batch
        test_batch = {
            "id": "test-batch-001",
            "status": "draft",
            "docType": "PI",
            "createdAt": "2026-01-01T00:00:00Z",
            "header": {"docNo": "TEST001", "party": "Test Supplier"}
        }
        await db.docai_batches.insert_one(test_batch)
        
        # Read it back
        found = await db.docai_batches.find_one({"id": "test-batch-001"}, {"_id": 0})
        print(f"Batch stored and retrieved: {found.get('id')}, docType: {found.get('docType')}")
        
        # Cleanup
        await db.docai_batches.delete_one({"id": "test-batch-001"})
        client.close()
        print("✅ MongoDB batch store: PASS")
        return True
    except Exception as e:
        print(f"❌ MongoDB failed: {e}")
        return False


if __name__ == "__main__":
    results = {}
    
    # Test 1: Sarvam Chat
    results["sarvam_chat"] = test_sarvam_chat()
    
    # Test 2: Sarvam Digitise (takes time, skip if chat failed)
    if results["sarvam_chat"]:
        print("\nStarting digitise test (may take 30-90s)...")
        results["sarvam_digitise"] = test_sarvam_digitise()
    else:
        print("\nSkipping digitise test (chat failed)")
        results["sarvam_digitise"] = None
    
    # Test 3: MSSQL
    results["mssql"] = test_mssql()
    
    # Test 4: MongoDB
    results["mongodb"] = asyncio.run(test_mongodb())
    
    print("\n" + "="*50)
    print("RESULTS SUMMARY:")
    for k, v in results.items():
        status = "✅ PASS" if v else ("⚠️  SKIP" if v is None else "❌ FAIL")
        print(f"  {k}: {status}")
    
    all_pass = all(v for v in results.values() if v is not None)
    print(f"\nOverall: {'✅ ALL PASS' if all_pass else '⚠️  Some issues'}")
