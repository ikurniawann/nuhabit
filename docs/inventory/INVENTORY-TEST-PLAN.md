# 🧪 Inventory Testing Plan - Arkiv OS

**Date:** April 23, 2026  
**Tester:** OpenClaw Agent (Claw 🐾)  
**Status:** IN PROGRESS  

---

## 📋 **Test Scenarios**

### **1. Stock Overview Page** ✅ EXISTING

**URL:** http://localhost:3000/dashboard/inventory

**Test Steps:**
1. [ ] Navigate to `/dashboard/inventory`
2. [ ] Verify stock list loads correctly
3. [ ] Check status badges display properly:
   - ✅ Normal (green) - Stock above minimum
   - ⚠️ Low Stock (yellow) - Stock at/below minimum
   - ❌ Out of Stock (red) - Zero stock
   - 📊 Overstock (blue) - Stock above maximum
4. [ ] Test search by material name/code
5. [ ] Test filter by stock status
6. [ ] Verify summary cards show correct counts

**Expected Result:**
- All raw materials with stock displayed
- Status badges match actual stock levels
- Search and filters work correctly
- Total value calculation accurate (qty × avg_cost)

---

### **2. GRN → Inventory Integration** 🔍 CRITICAL

**Test Case A: Create New GRN (First Receipt)**

**Steps:**
1. [ ] Go to `/dashboard/purchasing/grn/new`
2. [ ] Select a delivery/PO
3. [ ] Input qty_diterima > 0 (e.g., 50 units)
4. [ ] Save GRN
5. [ ] Check terminal log for "Adding X to inventory"
6. [ ] Go to `/dashboard/inventory`
7. [ ] Verify stock increased by qty_diterima

**Expected:**
```
Before: qty_available = 0
GRN: +50 units
After: qty_available = 50
```

**Test Case B: Continue GRN (Partial Receipt #2)**

**Steps:**
1. [ ] Find existing GRN with status `partially_received`
2. [ ] Click "Lanjutkan Penerimaan" button
3. [ ] Increase qty_diterima (e.g., from 50 to 80)
4. [ ] Save
5. [ ] Check terminal log for "Adding X to inventory"
6. [ ] Verify stock increased by diff only (30 units)

**Expected:**
```
Before: qty_available = 50
GRN Edit: +30 units (80 - 50)
After: qty_available = 80
```

**Test Case C: Decrease GRN Qty (Edit Down)**

**Steps:**
1. [ ] Edit existing GRN
2. [ ] Decrease qty_diterima (e.g., from 80 to 60)
3. [ ] Save
4. [ ] Check terminal log for "Removing X from inventory"
5. [ ] Verify stock decreased by diff (20 units)

**Expected:**
```
Before: qty_available = 80
GRN Edit: -20 units (60 - 80)
After: qty_available = 60
```

**Test Case D: Reject Items (qty_ditolak)**

**Steps:**
1. [ ] Create/edit GRN
2. [ ] Set qty_ditolak > 0 (e.g., 10 units rejected)
3. [ ] Save
4. [ ] Verify ONLY qty_diterima adds to stock
5. [ ] Rejected items should NOT affect inventory

**Expected:**
```
qty_diterima = 50 → +50 to inventory
qty_ditolak = 10 → NO impact on inventory
Net change: +50
```

---

### **3. Stock Adjustment (Stock Opname)**

**URL:** http://localhost:3000/dashboard/inventory/adjustment

**Test Steps:**
1. [ ] Navigate to adjustment page
2. [ ] Select a raw material
3. [ ] Enter adjustment quantity (positive or negative)
4. [ ] Add reason/notes (required)
5. [ ] Submit adjustment
6. [ ] Verify inventory updated
7. [ ] Check movement history created

**Expected:**
- Adjustment creates `inventory_movements` record
- Type = `ADJUSTMENT`
- qty_available updated correctly
- Audit trail preserved (sebelum/sesudah)

---

### **4. Movement History**

**URL:** http://localhost:3000/dashboard/inventory/movements

**Test Steps:**
1. [ ] Navigate to movements page
2. [ ] Filter by material/type/date
3. [ ] Verify movements show:
   - IN from GRN
   - OUT to production (if implemented)
   - ADJUSTMENT entries
4. [ ] Check reference links (GRN #, PO #, etc.)

**Expected:**
- All movements tracked chronologically
- Reference type/id correct
- Before/after quantities shown
- User who made change recorded

---

### **5. Stock Detail Page**

**URL:** http://localhost:3000/dashboard/inventory/[id]

**Test Steps:**
1. [ ] Click on any inventory item
2. [ ] Verify detail shows:
   - Current stock level
   - Minimum/maximum thresholds
   - Average cost
   - Total value
   - Recent movements
   - Last movement date
3. [ ] Check charts/graphs if available

**Expected:**
- Complete stock profile per material
- Movement history embedded
- Alerts for low/out of stock

---

### **6. Edge Cases & Error Handling**

**Test Scenarios:**
1. [ ] **Negative Stock Prevention**
   - Try to adjust stock below zero
   - Should show error or prevent save

2. [ ] **Duplicate Movements**
   - Create same GRN twice (should not be possible)
   - Verify no duplicate movements

3. [ ] **Concurrent Updates**
   - Two users edit same GRN simultaneously
   - Check for race conditions

4. [ ] **Delete GRN**
   - Delete GRN that added stock
   - Verify stock reverses correctly

5. [ ] **Zero Quantity**
   - Create GRN with qty_diterima = 0
   - Should not create movement

---

## 🐛 **Known Issues to Verify**

### **Issue #1: receive_count Not Incrementing**
- **Status:** FIX PENDING (SQL script ready)
- **Impact:** Display shows wrong receive sequence
- **Workaround:** Run SQL fix script in database admin

### **Issue #2: QC Route Error**
```
Error: Route "/api/purchasing/grn/[id]/qc" used `params.id`
`params` is a Promise and must be unwrapped
```
- **Status:** NEEDS FIX
- **Impact:** QC inspection page may not load
- **Fix:** Update route.ts to await params

### **Issue #3: Dropdown Button Hydration Error**
```
In HTML, <button> cannot be a descendant of <button>
```
- **Status:** UI BUG
- **Impact:** Console warnings, potential UX issues
- **Fix:** Remove nested button in dropdown menu

---

## ✅ **Acceptance Criteria**

**Inventory Module is READY when:**

1. ✅ Stock overview displays all materials correctly
2. ✅ GRN creates IN movements automatically
3. ✅ GRN edit adjusts inventory (add/remove diff)
4. ✅ Stock adjustments work (manual corrections)
5. ✅ Movement history tracks all changes
6. ✅ Status badges reflect actual stock levels
7. ✅ Low stock alerts trigger correctly
8. ✅ Total value calculation accurate
9. ✅ No data loss on edge cases
10. ✅ Audit trail complete and accurate

---

## 📊 **Test Results Template**

```markdown
### Test Session: [DATE]

**Tester:** [Name]
**Duration:** [X hours]

#### Pass Rate:
- Total Tests: XX
- Passed: XX ✅
- Failed: XX ❌
- Blocked: XX ⚠️

#### Critical Issues Found:
1. [Issue description]
2. [Issue description]

#### Notes:
[Any observations, recommendations, etc.]
```

---

## 🎯 **Next Steps After Testing**

1. **Fix bugs found during testing**
2. **Implement OUT movements** (production/sales)
3. **Add email notifications** for low stock
4. **Build remaining reports** (valuation, turnover, aging)
5. **Consider multi-location support** (future)

---

**Last Updated:** April 23, 2026  
**Version:** 1.0.0  
**Status:** Ready for Testing Phase
