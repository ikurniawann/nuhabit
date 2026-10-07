# Combobox Migration Progress Tracker

**Started:** 2026-04-24 10:46 AM  
**Goal:** Convert ALL Select dropdowns to searchable Combobox

---

## ✅ COMPLETED

### 1. Raw Materials New (`raw-materials/new/page.tsx`)
**Status:** ✅ 100% DONE (4/4 dropdowns)
- [x] Kategori
- [x] Satuan Besar
- [x] Satuan Kecil  
- [x] Storage Condition
**Tested:** YES ✅

### 2. Suppliers New (`suppliers/new/page.tsx`)
**Status:** ✅ 100% DONE (3/3 dropdowns)
- [x] Payment Terms
- [x] Currency
- [x] Kota
**Tested:** Pending

---

## 🔄 IN PROGRESS

### 3. Raw Materials Edit (`raw-materials/[id]/edit/page.tsx`)
**Status:** ⏳ Import added, converting dropdowns...
- [ ] Kategori
- [ ] Satuan Besar
- [ ] Satuan Kecil
- [ ] Storage Condition

### 4. Products Edit (`products/[id]/edit/page.tsx`)
**Status:** ⏳ Import added
- [ ] Kategori
- [ ] Satuan

### 5. Suppliers Edit (`suppliers/[id]/edit/page.tsx`)
**Status:** ⏳ Import added
- [ ] Payment Terms
- [ ] Currency
- [ ] Kota

### 6. Price List New (`price-list/new/page.tsx`)
**Status:** ⏳ Import added
- [ ] Supplier
- [ ] Bahan Baku
- [ ] Satuan

### 7. Price List Edit (`price-list/[id]/edit/page.tsx`)
**Status:** ⏳ Import added
- [ ] Supplier
- [ ] Bahan Baku
- [ ] Satuan

---

## 📋 TODO - Priority 1

### 8. Purchase Order New (`po/new/page.tsx`)
**Complexity:** HIGH (dynamic rows with material selection)
- [ ] Supplier dropdown
- [ ] Material dropdown (multiple rows)

### 9. GRN Pages
- [ ] `grn/page.tsx` - Status filters
- [ ] `grn/[id]/qc/page.tsx` - QC status

### 10. Returns Pages
- [ ] `returns/new/page.tsx`
- [ ] `returns/page.tsx`

---

## 📋 TODO - Priority 2

### Inventory Module
- [ ] `inventory/page.tsx`
- [ ] `inventory/low-stock/page.tsx`

### Reports
- [ ] `reports/inventory-valuation/page.tsx`
- [ ] `reports/po-summary/page.tsx`

---

## Summary Stats

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Completed | 2 pages | ~6% |
| 🔄 In Progress | 5 pages | ~15% |
| 📋 TODO | ~27 pages | ~79% |
| **Total** | **~34 pages** | **100%** |

**Dropdowns Converted:** 7 out of ~100+ (~7%)

---

## Next Steps

1. ✅ Complete Raw Materials Edit (4 dropdowns)
2. ✅ Complete Products Edit (2 dropdowns)
3. ✅ Complete Suppliers Edit (3 dropdowns)
4. ✅ Complete Price List New/Edit (6 dropdowns)
5. ⚠️ Tackle complex PO New page
6. 📊 Move to Inventory module
7. 📈 Finish with Reports

**Estimated Time Remaining:** ~60-90 minutes

---

**Last Updated:** 2026-04-24 10:47 AM
