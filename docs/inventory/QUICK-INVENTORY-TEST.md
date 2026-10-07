# 🧪 Quick Inventory Test - Arkiv OS

**Date:** April 23, 2026  
**Estimated Time:** 15 minutes  

---

## ✅ **Test 1: View Current Stock**

**URL:** http://localhost:3000/dashboard/inventory

**Steps:**
1. Open browser → http://localhost:3000/dashboard/inventory
2. Check if stock list loads
3. Look for these columns:
   - Kode Bahan Baku
   - Nama Bahan Baku
   - Stok Tersedia
   - Status (AMAN/MENIPIS/HABIS)
   - Nilai Total

**Expected Result:**
- List of raw materials with stock levels
- Status badges colored correctly:
  - 🟢 Green = AMAN (Normal)
  - 🟡 Yellow = MENIPIS (Low Stock)
  - 🔴 Red = HABIS (Out of Stock)

**Screenshot:** Take screenshot of inventory page

---

## ✅ **Test 2: Create GRN → Check Stock Increases**

**Step A: Create New GRN**

1. Go to: http://localhost:3000/dashboard/purchasing/grn/new
2. Select a delivery/PO that has not been fully received
3. Input qty_diterima (e.g., 50 units)
4. Leave qty_ditolak = 0
5. Click "Simpan GRN"

**Step B: Verify Stock Increased**

1. Go back to: http://localhost:3000/dashboard/inventory
2. Find the material you just received
3. Check qty_tersedia increased by 50

**Expected in Terminal:**
```
[PATCH GRN/xxx] Updating inventory...
[PATCH GRN/xxx] Adding 50 to inventory for [bahan_baku_id]
[PATCH GRN/xxx] Inventory updated
```

**Pass Criteria:**
- ✅ Stock increased by exact qty_diterima
- ✅ Movement recorded (check movement history)
- ✅ Status badge updated if needed

---

## ✅ **Test 3: Edit GRN → Check Stock Adjusts**

**Step A: Increase GRN Qty**

1. Go to: http://localhost:3000/dashboard/purchasing/grn
2. Find the GRN you just created
3. Click "Lanjutkan Penerimaan" or edit button
4. Increase qty_diterima from 50 to 80 (+30)
5. Save

**Expected:**
- Stock increases by +30 (the diff)
- Terminal shows: "Adding 30 to inventory"

**Step B: Decrease GRN Qty**

1. Edit same GRN again
2. Decrease qty_diterima from 80 to 60 (-20)
3. Save

**Expected:**
- Stock decreases by -20 (the diff)
- Terminal shows: "Removing 20 from inventory"

---

## ✅ **Test 4: Stock Adjustment (Manual)**

**URL:** http://localhost:3000/dashboard/inventory/adjustment

**Steps:**
1. Go to adjustment page
2. Select a raw material
3. Enter adjustment qty (e.g., -5 for damaged stock)
4. Add reason: "Test adjustment - damaged items"
5. Submit

**Expected:**
- Stock adjusted correctly
- Movement created with type = "adjustment"
- Reason saved in database

---

## ✅ **Test 5: Movement History**

**URL:** http://localhost:3000/dashboard/inventory/movements

**Steps:**
1. Go to movements page
2. Look for recent movements from tests above
3. Verify columns:
   - Tanggal
   - Tipe (IN/OUT/ADJUSTMENT)
   - Jumlah (+/-)
   - Reference (GRN #)
   - Sebelum → Sesudah

**Expected:**
- All movements tracked chronologically
- IN movements from GRN visible
- ADJUSTMENT movements visible
- Before/after quantities shown

---

## 🐛 **What to Report**

If you find any issues, report:

1. **Issue Description:** What happened?
2. **Expected:** What should happen?
3. **Actual:** What actually happened?
4. **Steps to Reproduce:** How to make it happen again?
5. **Screenshot:** If visual issue
6. **Terminal Log:** Copy from terminal if error

---

## ✅ **Pass/Fail Checklist**

```
Test 1: View Stock          [ ] PASS  [ ] FAIL
Test 2: GRN Adds Stock      [ ] PASS  [ ] FAIL
Test 3: Edit Adjusts Stock  [ ] PASS  [ ] FAIL
Test 4: Manual Adjustment   [ ] PASS  [ ] FAIL
Test 5: Movement History    [ ] PASS  [ ] FAIL

Overall: [ ] READY FOR PROD  [ ] NEEDS FIXES
```

---

## 🎯 **Next Steps After Testing**

**If ALL PASS:**
- ✅ Module is production ready!
- Move to OUT movements implementation
- Build remaining reports

**If ANY FAIL:**
- Document bugs found
- Fix critical issues first
- Re-test failed scenarios

---

**Ready to start testing?** 

Silakan test satu-per-satu dan kasih feedback ya Bang! 🙏
