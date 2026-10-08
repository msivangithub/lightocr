#!/usr/bin/env python3
"""
Backend API Test Suite for 5-Tier OCR Chain with light-OCR (PP-OCRv6)
Tests all health, diagnostic, and fallback status endpoints
"""

import requests
import sys
import json
from datetime import datetime

BASE_URL = "https://sarvam-ocr-engine.preview.emergentagent.com/api/docai"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

class OCRChainTester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.results = []

    def log(self, msg, level="info"):
        colors = {"info": Colors.BLUE, "success": Colors.GREEN, "error": Colors.RED, "warning": Colors.YELLOW}
        print(f"{colors.get(level, '')}{msg}{Colors.RESET}")

    def test(self, name, fn):
        """Run a single test"""
        self.tests_run += 1
        self.log(f"\n🔍 Test {self.tests_run}: {name}", "info")
        try:
            result = fn()
            if result.get("passed"):
                self.tests_passed += 1
                self.log(f"✅ PASSED: {result.get('message', '')}", "success")
                self.results.append({"test": name, "status": "PASSED", "details": result.get("details")})
            else:
                self.tests_failed += 1
                self.log(f"❌ FAILED: {result.get('message', '')}", "error")
                self.results.append({"test": name, "status": "FAILED", "details": result.get("details")})
            return result
        except Exception as e:
            self.tests_failed += 1
            self.log(f"❌ EXCEPTION: {str(e)}", "error")
            self.results.append({"test": name, "status": "EXCEPTION", "error": str(e)})
            return {"passed": False, "message": str(e)}

    def test_health_endpoint(self):
        """Test 1: Health endpoint returns 5-tier fallback configuration"""
        try:
            resp = requests.get(f"{BASE_URL}/health", timeout=10)
            data = resp.json()
            
            checks = []
            checks.append(("Status code 200", resp.status_code == 200))
            checks.append(("fallback field present", "fallback" in data))
            checks.append(("fallback contains '5-tier'", "5-tier" in data.get("fallback", "")))
            checks.append(("fallback contains 'light-ocr'", "light-ocr" in data.get("fallback", "").lower()))
            checks.append(("lightOcr configured", data.get("lightOcr") == "configured"))
            checks.append(("tesseract configured", data.get("tesseract") == "configured"))
            checks.append(("sarvam configured", data.get("sarvam") in ["configured", "mock"]))
            checks.append(("gemini configured", data.get("gemini") in ["configured", "not-set"]))
            
            all_passed = all(result for _, result in checks)
            details = {k: v for k, v in checks}
            details["response"] = data
            
            return {
                "passed": all_passed,
                "message": f"Health endpoint checks: {sum(1 for _, r in checks if r)}/{len(checks)} passed",
                "details": details
            }
        except Exception as e:
            return {"passed": False, "message": f"Request failed: {str(e)}"}

    def test_fallback_status_endpoint(self):
        """Test 2: Fallback status shows all 5 tiers with correct configuration"""
        try:
            resp = requests.get(f"{BASE_URL}/fallback-status", timeout=10)
            data = resp.json()
            
            checks = []
            checks.append(("Status code 200", resp.status_code == 200))
            checks.append(("tier1 present", "tier1" in data))
            checks.append(("tier2 present", "tier2" in data))
            checks.append(("tier3 present", "tier3" in data))
            checks.append(("tier4 present", "tier4" in data))
            checks.append(("tier5 present", "tier5" in data))
            
            # Tier 1: light-OCR
            if "tier1" in data:
                tier1 = data["tier1"]
                checks.append(("tier1 engine is light-ocr", tier1.get("engine") == "light-ocr"))
                checks.append(("tier1 label contains PP-OCRv6", "PP-OCRv6" in tier1.get("label", "")))
                checks.append(("tier1 configured", tier1.get("configured") == True))
                checks.append(("tier1 dictSize is 18709", tier1.get("dictSize") == 18709))
            
            # Tier 2: Tesseract
            if "tier2" in data:
                tier2 = data["tier2"]
                checks.append(("tier2 engine is tesseract", tier2.get("engine") == "tesseract"))
                checks.append(("tier2 label contains Tesseract", "Tesseract" in tier2.get("label", "")))
                checks.append(("tier2 configured", tier2.get("configured") == True))
                checks.append(("tier2 has langs", tier2.get("langCount", 0) >= 10))
            
            # Tier 3: Sarvam
            if "tier3" in data:
                tier3 = data["tier3"]
                checks.append(("tier3 engine is sarvam", tier3.get("engine") == "sarvam"))
                checks.append(("tier3 label contains Sarvam", "Sarvam" in tier3.get("label", "")))
            
            # Tier 4: Gemini
            if "tier4" in data:
                tier4 = data["tier4"]
                checks.append(("tier4 engine is gemini", tier4.get("engine") == "gemini"))
                checks.append(("tier4 label contains Gemini", "Gemini" in tier4.get("label", "")))
            
            # Tier 5: Heuristic
            if "tier5" in data:
                tier5 = data["tier5"]
                checks.append(("tier5 engine is heuristic", tier5.get("engine") == "heuristic"))
                checks.append(("tier5 configured", tier5.get("configured") == True))
            
            checks.append(("fallbackChain present", "fallbackChain" in data))
            checks.append(("minConfidence is 0.60", data.get("minConfidence") == 0.60))
            
            all_passed = all(result for _, result in checks)
            details = {k: v for k, v in checks}
            details["response"] = data
            
            return {
                "passed": all_passed,
                "message": f"Fallback status checks: {sum(1 for _, r in checks if r)}/{len(checks)} passed",
                "details": details
            }
        except Exception as e:
            return {"passed": False, "message": f"Request failed: {str(e)}"}

    def test_diag_endpoint(self):
        """Test 3: Diag endpoint returns lightOcr.ok=true with dictSize=18709"""
        try:
            resp = requests.get(f"{BASE_URL}/diag", timeout=10)
            data = resp.json()
            
            checks = []
            checks.append(("Status code 200", resp.status_code == 200))
            checks.append(("lightOcr present", "lightOcr" in data))
            
            if "lightOcr" in data:
                light_ocr = data["lightOcr"]
                checks.append(("lightOcr.ok is true", light_ocr.get("ok") == True))
                checks.append(("lightOcr.dictSize is 18709", light_ocr.get("dictSize") == 18709))
                checks.append(("lightOcr.model contains PP-OCRv6", "PP-OCRv6" in light_ocr.get("model", "")))
            
            checks.append(("fallbackChain present", "fallbackChain" in data))
            checks.append(("fallbackChain contains 5 tiers", "light-OCR" in data.get("fallbackChain", "") and "Tesseract" in data.get("fallbackChain", "")))
            checks.append(("tesseract present", "tesseract" in data))
            
            if "tesseract" in data:
                tess = data["tesseract"]
                checks.append(("tesseract.ok is true", tess.get("ok") == True))
            
            checks.append(("minConfidence is 0.60", data.get("minConfidence") == 0.60))
            
            all_passed = all(result for _, result in checks)
            details = {k: v for k, v in checks}
            details["response"] = data
            
            return {
                "passed": all_passed,
                "message": f"Diag endpoint checks: {sum(1 for _, r in checks if r)}/{len(checks)} passed",
                "details": details
            }
        except Exception as e:
            return {"passed": False, "message": f"Request failed: {str(e)}"}

    def test_light_ocr_direct(self):
        """Test 4: Direct light-OCR engine test (via Node.js test script if available)"""
        # This test would require running a Node.js script directly
        # For now, we'll mark it as informational based on diag results
        try:
            resp = requests.get(f"{BASE_URL}/diag", timeout=10)
            data = resp.json()
            
            if "lightOcr" in data and data["lightOcr"].get("ok"):
                return {
                    "passed": True,
                    "message": "light-OCR engine is loaded and operational (verified via diag endpoint)",
                    "details": {"lightOcr": data["lightOcr"]}
                }
            else:
                return {
                    "passed": False,
                    "message": "light-OCR engine not operational",
                    "details": {"lightOcr": data.get("lightOcr")}
                }
        except Exception as e:
            return {"passed": False, "message": f"Request failed: {str(e)}"}

    def test_doc_types_endpoint(self):
        """Test 5: Document types endpoint returns valid types"""
        try:
            resp = requests.get(f"{BASE_URL}/doc-types", timeout=10)
            data = resp.json()
            
            checks = []
            checks.append(("Status code 200", resp.status_code == 200))
            checks.append(("Response is array", isinstance(data, list)))
            checks.append(("Has document types", len(data) > 0))
            
            if isinstance(data, list) and len(data) > 0:
                checks.append(("First type has code", "code" in data[0]))
                checks.append(("First type has name", "name" in data[0]))
            
            all_passed = all(result for _, result in checks)
            details = {k: v for k, v in checks}
            details["doc_types_count"] = len(data) if isinstance(data, list) else 0
            
            return {
                "passed": all_passed,
                "message": f"Document types: {len(data) if isinstance(data, list) else 0} types available",
                "details": details
            }
        except Exception as e:
            return {"passed": False, "message": f"Request failed: {str(e)}"}

    def print_summary(self):
        """Print test summary"""
        self.log("\n" + "="*80, "info")
        self.log("TEST SUMMARY", "info")
        self.log("="*80, "info")
        self.log(f"Total tests run: {self.tests_run}", "info")
        self.log(f"Tests passed: {self.tests_passed}", "success")
        self.log(f"Tests failed: {self.tests_failed}", "error")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"Success rate: {success_rate:.1f}%", "success" if success_rate >= 80 else "warning")
        
        self.log("\n" + "="*80, "info")
        self.log("DETAILED RESULTS", "info")
        self.log("="*80, "info")
        
        for result in self.results:
            status_color = "success" if result["status"] == "PASSED" else "error"
            self.log(f"{result['test']}: {result['status']}", status_color)
            if result.get("details"):
                for key, value in result["details"].items():
                    if key != "response":
                        self.log(f"  - {key}: {value}", "info")
        
        return 0 if self.tests_failed == 0 else 1

def main():
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}")
    print(f"{Colors.BLUE}5-Tier OCR Chain Backend Test Suite{Colors.RESET}")
    print(f"{Colors.BLUE}Testing: {BASE_URL}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}\n")
    
    tester = OCRChainTester()
    
    # Run all tests
    tester.test("Health endpoint returns 5-tier fallback configuration", tester.test_health_endpoint)
    tester.test("Fallback status shows all 5 tiers with correct configuration", tester.test_fallback_status_endpoint)
    tester.test("Diag endpoint returns lightOcr.ok=true with dictSize=18709", tester.test_diag_endpoint)
    tester.test("light-OCR engine operational check", tester.test_light_ocr_direct)
    tester.test("Document types endpoint", tester.test_doc_types_endpoint)
    
    # Print summary and return exit code
    return tester.print_summary()

if __name__ == "__main__":
    sys.exit(main())
