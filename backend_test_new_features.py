#!/usr/bin/env python3
"""
Backend API Testing for NEW RetailCLIQ DocAI Features
Tests: Gemini fallback, Bank Statement parsing, Tally XML, BST GL Mapping
"""
import requests
import sys
import json
from datetime import datetime

BASE_URL = "https://sarvam-ocr-engine.preview.emergentagent.com/api/docai"

class NewFeaturesTester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.results = []
        
    def run_test(self, name, method, endpoint, expected_status, data=None, json_data=None, timeout=15):
        """Run a single API test"""
        url = f"{BASE_URL}{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        print(f"\n{'='*70}")
        print(f"🔍 Test {self.tests_run}: {name}")
        print(f"   {method} {endpoint}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=json_data, data=data, headers=headers, timeout=timeout)
            elif method == 'PUT':
                response = requests.put(url, json=json_data, headers=headers, timeout=timeout)
            
            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"   ✅ PASSED - Status: {response.status_code}")
                try:
                    resp_json = response.json()
                    self.results.append({
                        "test": name,
                        "status": "PASS",
                        "response": resp_json
                    })
                    return True, resp_json
                except:
                    self.results.append({
                        "test": name,
                        "status": "PASS",
                        "response": response.text[:200]
                    })
                    return True, {}
            else:
                print(f"   ❌ FAILED - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:500]}")
                self.results.append({
                    "test": name,
                    "status": "FAIL",
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:300]
                })
                return False, {}
                
        except Exception as e:
            print(f"   ❌ FAILED - Error: {str(e)}")
            self.results.append({
                "test": name,
                "status": "FAIL",
                "error": str(e)
            })
            return False, {}
    
    def test_gemini_fallback_status(self):
        """Test 1: Gemini fallback status endpoint"""
        print("\n" + "="*70)
        print("TEST CATEGORY: GEMINI FALLBACK")
        print("="*70)
        
        success, response = self.run_test(
            "Gemini Fallback Status API",
            "GET",
            "/fallback-status",
            200
        )
        
        if success:
            print(f"\n   📊 DETAILED RESPONSE:")
            print(f"   • Sarvam configured: {response.get('sarvam', {}).get('configured')}")
            print(f"   • Sarvam keys: {response.get('sarvam', {}).get('keys')}")
            print(f"   • Gemini configured: {response.get('gemini', {}).get('configured')}")
            print(f"   • Gemini model: {response.get('gemini', {}).get('model')}")
            print(f"   • Gemini role: {response.get('gemini', {}).get('role')}")
            print(f"   • Fallback chain: {response.get('fallbackChain')}")
            print(f"   • Bank statement mode: {response.get('bankStatementMode')}")
            
            # Verify expected structure
            if 'fallbackChain' in response and 'Sarvam AI → Google Gemini → Heuristic' in response['fallbackChain']:
                print(f"   ✅ Fallback chain correct")
            else:
                print(f"   ⚠️  Fallback chain format unexpected")
        
        return success
    
    def test_health_gemini_info(self):
        """Test 2: Health endpoint shows Gemini info"""
        success, response = self.run_test(
            "Health Endpoint - Gemini Info",
            "GET",
            "/health",
            200
        )
        
        if success:
            print(f"\n   📊 HEALTH CHECK:")
            print(f"   • OCR engine: {response.get('ocr')}")
            print(f"   • LLM engine: {response.get('llm')}")
            print(f"   • Gemini status: {response.get('gemini')}")
            print(f"   • Fallback: {response.get('fallback')}")
            
            if response.get('gemini') == 'configured' or response.get('fallback') == 'gemini':
                print(f"   ✅ Gemini fallback configured in health")
            else:
                print(f"   ⚠️  Gemini not shown in health (may be expected)")
        
        return success
    
    def test_diagnostics_gemini(self):
        """Test 3: Diagnostics shows Gemini fallback"""
        success, response = self.run_test(
            "Diagnostics - Gemini Fallback Section",
            "GET",
            "/diag",
            200
        )
        
        if success:
            print(f"\n   📊 DIAGNOSTICS:")
            print(f"   • OCR Engine: {response.get('ocrEngine')}")
            print(f"   • LLM Engine: {response.get('llmEngine')}")
            print(f"   • Fallback Engine: {response.get('fallbackEngine')}")
            
            if 'gemini' in response:
                gemini = response['gemini']
                print(f"   • Gemini status: {gemini.get('status')}")
                print(f"   • Gemini OK: {gemini.get('ok')}")
                print(f"   • Gemini model: {gemini.get('model')}")
                print(f"   • Gemini active key: {gemini.get('activeKey')}")
                print(f"   ✅ Gemini section present in diagnostics")
            else:
                print(f"   ⚠️  No Gemini section in diagnostics")
        
        return success
    
    def test_tally_xml_parse(self):
        """Test 4: Tally XML parsing endpoint"""
        print("\n" + "="*70)
        print("TEST CATEGORY: TALLY XML PARSING")
        print("="*70)
        
        # Sample Tally XML for PT_PUR (Purchase)
        tally_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TALLYMESSAGE>
  <VOUCHER VCHTYPE="Purchase" ACTION="Create">
    <DATE>20260115</DATE>
    <VOUCHERNUMBER>PI-2026-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME>SriLakshmi Traders</PARTYLEDGERNAME>
    <NARRATION>Purchase of rice and wheat</NARRATION>
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Basmati Rice 5kg</STOCKITEMNAME>
      <ACTUALQTY> 40 Nos</ACTUALQTY>
      <RATE>410/Nos</RATE>
      <AMOUNT>-16400</AMOUNT>
      <HSNCODE>1006</HSNCODE>
    </ALLINVENTORYENTRIES.LIST>
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Wheat Flour 10kg</STOCKITEMNAME>
      <ACTUALQTY> 20 Nos</ACTUALQTY>
      <RATE>380/Nos</RATE>
      <AMOUNT>-7600</AMOUNT>
      <HSNCODE>1101</HSNCODE>
    </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME>CGST</LEDGERNAME>
      <AMOUNT>-1200</AMOUNT>
    </LEDGERENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERNAME>SGST</LEDGERNAME>
      <AMOUNT>-1200</AMOUNT>
    </LEDGERENTRIES.LIST>
  </VOUCHER>
</TALLYMESSAGE>"""
        
        success, response = self.run_test(
            "Tally XML Parse API - PT_PUR Detection",
            "POST",
            "/parse-tally-xml",
            200,
            json_data={"content": tally_xml}
        )
        
        if success:
            print(f"\n   📊 TALLY XML PARSE RESULT:")
            print(f"   • OK: {response.get('ok')}")
            print(f"   • Vouchers count: {response.get('vouchers')}")
            
            if response.get('data') and len(response['data']) > 0:
                voucher = response['data'][0]
                print(f"   • Detected doc type: {voucher.get('docType')}")
                print(f"   • ERP source: {voucher.get('erpSource')}")
                print(f"   • File format: {voucher.get('fileFormat')}")
                
                if voucher.get('header'):
                    header = voucher['header']
                    print(f"   • Doc No: {header.get('docNo')}")
                    print(f"   • Party: {header.get('party')}")
                    print(f"   • Grand Total: {header.get('grandTotal')}")
                
                if voucher.get('lines'):
                    print(f"   • Line items: {len(voucher['lines'])}")
                    for i, line in enumerate(voucher['lines'][:2], 1):
                        print(f"     Line {i}: {line.get('description')} - Qty: {line.get('qty')} {line.get('uom')}, Rate: {line.get('rate')}")
                
                if voucher.get('docType') == 'PT_PUR':
                    print(f"   ✅ Correctly detected as PT_PUR (Purchase)")
                else:
                    print(f"   ⚠️  Expected PT_PUR, got {voucher.get('docType')}")
            else:
                print(f"   ⚠️  No voucher data returned")
        
        return success
    
    def test_tally_xml_sales(self):
        """Test 5: Tally XML PT_SAL detection"""
        tally_xml_sales = """<?xml version="1.0" encoding="UTF-8"?>
<TALLYMESSAGE>
  <VOUCHER VCHTYPE="Sales" ACTION="Create">
    <DATE>20260120</DATE>
    <VOUCHERNUMBER>SI-2026-005</VOUCHERNUMBER>
    <PARTYLEDGERNAME>ABC Retail Store</PARTYLEDGERNAME>
    <NARRATION>Sales invoice for retail goods</NARRATION>
    <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Premium Tea 250g</STOCKITEMNAME>
      <ACTUALQTY> 50 Nos</ACTUALQTY>
      <RATE>120/Nos</RATE>
      <AMOUNT>6000</AMOUNT>
    </ALLINVENTORYENTRIES.LIST>
  </VOUCHER>
</TALLYMESSAGE>"""
        
        success, response = self.run_test(
            "Tally XML Parse API - PT_SAL Detection",
            "POST",
            "/parse-tally-xml",
            200,
            json_data={"content": tally_xml_sales}
        )
        
        if success and response.get('data') and len(response['data']) > 0:
            voucher = response['data'][0]
            print(f"\n   📊 SALES VOUCHER:")
            print(f"   • Detected doc type: {voucher.get('docType')}")
            
            if voucher.get('docType') == 'PT_SAL':
                print(f"   ✅ Correctly detected as PT_SAL (Sales)")
            else:
                print(f"   ⚠️  Expected PT_SAL, got {voucher.get('docType')}")
        
        return success
    
    def test_bank_statement_detection(self):
        """Test 6: Bank statement text detection"""
        print("\n" + "="*70)
        print("TEST CATEGORY: BANK STATEMENT PROCESSING")
        print("="*70)
        
        # Sample HDFC bank statement text
        bank_text = """HDFC BANK LIMITED
Account Statement
Account Number: 50200012345678
IFSC Code: HDFC0001234
Statement Period: 01-Jan-2026 to 31-Jan-2026

Opening Balance: 125,450.00

Date        Description                          Ref No          Debit       Credit      Balance
01-Jan-26   Opening Balance                                                              125,450.00
02-Jan-26   NEFT-SBIN0012345-ABC Traders        N123456789      15,000.00               110,450.00
05-Jan-26   UPI-XYZ Store-Payment               UPI123456       2,500.00                107,950.00
08-Jan-26   Salary Credit-ABC Corp              SAL202601                   85,000.00   192,950.00
10-Jan-26   ATM Withdrawal-MG Road              ATM456789       5,000.00                187,950.00
15-Jan-26   RTGS-ICIC0001234-Supplier Pay       R987654321      45,000.00               142,950.00
20-Jan-26   Interest Credit                     INT202601                   125.50      143,075.50
25-Jan-26   Bank Charges                        CHG202601       150.00                  142,925.50

Closing Balance: 142,925.50"""
        
        success, response = self.run_test(
            "Bank Statement Text Detection",
            "POST",
            "/batches",
            200,
            json_data={
                "kind": "text",
                "text": bank_text,
                "fileName": "hdfc_statement.txt"
            }
        )
        
        if success:
            batch_id = response.get('id')
            print(f"\n   📊 BATCH CREATED:")
            print(f"   • Batch ID: {batch_id[:16]}...")
            print(f"   • Status: {response.get('status')}")
            
            # Now trigger detection
            if batch_id:
                print(f"\n   🔄 Triggering detection...")
                det_success, det_response = self.run_test(
                    "Bank Statement Detection",
                    "POST",
                    f"/batches/{batch_id}/detect",
                    202,
                    json_data={}
                )
                
                if det_success:
                    # Wait and check progress
                    import time
                    print(f"   ⏳ Waiting for detection...")
                    time.sleep(5)
                    
                    prog_success, prog_response = self.run_test(
                        "Bank Statement Detection Progress",
                        "GET",
                        f"/batches/{batch_id}/progress",
                        200
                    )
                    
                    if prog_success:
                        print(f"\n   📊 DETECTION PROGRESS:")
                        print(f"   • Done: {prog_response.get('done')}")
                        print(f"   • Running: {prog_response.get('running')}")
                        print(f"   • Doc Type: {prog_response.get('docType')}")
                        
                        detection = prog_response.get('detection', {})
                        if detection:
                            print(f"   • Detection engine: {detection.get('engine')}")
                            print(f"   • Confidence: {detection.get('confidence', 0)*100:.0f}%")
                            
                            # Check if it's using bank-parser engine
                            if detection.get('engine') == 'bank-parser':
                                print(f"   ✅ Using bank-parser engine (not sarvam)")
                            elif detection.get('engine') == 'sarvam':
                                print(f"   ⚠️  Using sarvam engine (should be bank-parser for BST)")
                            
                            if prog_response.get('docType') == 'BST':
                                print(f"   ✅ Correctly detected as BST (Bank Statement)")
                            else:
                                print(f"   ⚠️  Expected BST, got {prog_response.get('docType')}")
        
        return success
    
    def run_all_tests(self):
        """Run all new feature tests"""
        print("\n" + "="*70)
        print("🚀 RetailCLIQ DocAI - NEW FEATURES TESTING")
        print("="*70)
        print(f"📍 Base URL: {BASE_URL}")
        print(f"⏰ Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*70)
        
        # Test Gemini fallback
        self.test_gemini_fallback_status()
        self.test_health_gemini_info()
        self.test_diagnostics_gemini()
        
        # Test Tally XML parsing
        self.test_tally_xml_parse()
        self.test_tally_xml_sales()
        
        # Test Bank Statement processing
        self.test_bank_statement_detection()
        
        # Summary
        print("\n" + "="*70)
        print("📊 TEST SUMMARY")
        print("="*70)
        print(f"✅ Tests Passed: {self.tests_passed}/{self.tests_run}")
        print(f"❌ Tests Failed: {self.tests_run - self.tests_passed}/{self.tests_run}")
        print(f"📈 Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        print("="*70)
        
        # Save results to file
        results_file = f"/app/test_results_new_features_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump({
                "summary": {
                    "total": self.tests_run,
                    "passed": self.tests_passed,
                    "failed": self.tests_run - self.tests_passed,
                    "success_rate": f"{(self.tests_passed/self.tests_run*100):.1f}%"
                },
                "tests": self.results
            }, f, indent=2)
        print(f"\n📄 Results saved to: {results_file}")
        
        return 0 if self.tests_passed == self.tests_run else 1

def main():
    tester = NewFeaturesTester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())
