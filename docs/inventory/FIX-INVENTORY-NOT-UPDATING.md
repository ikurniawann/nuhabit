# 🐛 FIX: Inventory Tidak Bertambah Setelah GRN

**Date:** April 23, 2026  
**Issue:** GRN diterima 50pcs Mie Instant, tapi inventory masih 0  
**Root Cause:** Missing QC Inspection step  

---

## 🔍 **Root Cause Analysis**

### **Current Flow (With QC):**
```
1. Create GRN → Status: pending
   └─ grn_items created with qty_diterima = 50
   
2. Submit QC Inspection → /api/purchasing/qc
   └─ qc_inspections inserted
   └─ addStockFromQC() called
   └─ inventory.qty_in_stock += 50 ✅
   
3. GRN status updated → received/partially_received
```

### **What Happened:**
Bang Ilham langsung input `qty_diterima = 50` di GRN form, tapi **tidak submit QC inspection**.

**Result:**
- ✅ GRN created with items
- ❌ QC inspection never submitted
- ❌ `addStockFromQC()` never called
- ❌ Inventory not updated (still 0)

---

## ✅ **Solution Options**

### **Option A: Submit QC Inspection Now** (Recommended)

**Submit QC untuk GRN yang sudah created:**

1. **Via API (Quick Fix):**
```bash
curl -X POST http://localhost:3000/api/purchasing/qc \
  -H "Content-Type: application/json" \
  -d '{
    "grn_id": "[GRN_ID_HERE]",
    "items": [
      {
        "bahan_baku_id": "[BAHAN_BAKU_ID]",
        "jumlah_diperiksa": 50,
        "jumlah_diterima": 50,
        "jumlah_ditolak": 0,
        "hasil": "passed",
        "alasan": "Auto-QC fix for testing"
      }
    ]
  }'
```

2. **Via UI (Proper Way):**
   - Go to: http://localhost:3000/dashboard/purchasing/qc
   - Find the GRN (e.g., GRN-20260423-XXXX)
   - Click "Inspeksi QC"
   - Input:
     - Jumlah Diperiksa: 50
     - Jumlah Diterima: 50
     - Jumlah Ditolak: 0
     - Hasil: Passed
   - Submit

**Expected Result:**
- QC inspection created
- Inventory increases to 50
- GRN status updated

---

### **Option B: Auto-QC on GRN Create** (For Simple Cases)

**Modify GRN route to auto-create QC passed when all items accepted:**

Add this to `/api/purchasing/grn/route.ts` after GRN creation:

```typescript
// AUTO-QC: If all items accepted (no rejects), auto-pass QC
const hasRejects = validated.items.some(i => (i.qty_ditolak || 0) > 0);

if (!hasRejects) {
  // Auto-create QC inspection as passed
  for (const item of validated.items) {
    if (item.qty_diterima > 0) {
      await db.from("qc_inspections").insert({
        goods_receipt_id: grn.id,
        bahan_baku_id: item.raw_material_id,
        jumlah_diperiksa: item.qty_diterima,
        jumlah_diterima: item.qty_diterima,
        jumlah_ditolak: item.qty_ditolak || 0,
        hasil: "passed",
        inspector_id: user.id,
        tanggal_inspeksi: new Date().toISOString(),
        created_by: user.id,
      });

      // Add to inventory
      const poItem = poItemByBahanBaku.get(item.raw_material_id);
      const unitPrice = poItem?.unit_price || 0;
      
      await addStockFromQC(db, {
        grnId: grn.id,
        grnItemId: grnItem.id,
        bahanBakuId: item.raw_material_id,
        qtyAccepted: item.qty_diterima,
        unitPrice,
        userId: user.id,
      });
    }
  }
}
```

**Pros:**
- Simpler workflow for trusted suppliers
- No manual QC needed for standard receipts
- Inventory updates immediately

**Cons:**
- Bypasses quality control check
- Not suitable for critical materials
- Less audit trail

---

### **Option C: Hybrid Approach** (Best of Both)

**Add checkbox in GRN form: "Skip QC Inspection"**

- [ ] Skip QC (auto-pass) - For trusted suppliers/standard items
- [ ] Require QC - For new suppliers/critical materials

**Implementation:**
1. Add `skip_qc` boolean field to GRN schema
2. If `skip_qc = true`: Auto-create QC passed + add stock
3. If `skip_qc = false` (default): Require manual QC

---

## 🎯 **Recommended Action Plan**

### **Immediate Fix (Now):**
1. **Find the GRN ID** that Bang Ilham created
2. **Submit QC manually** via API or UI
3. **Verify inventory** increases to 50

### **Long-term Fix (Next Sprint):**
1. **Implement Option C** (Hybrid with skip_qc checkbox)
2. **Add QC page** to dashboard if not exists
3. **Document workflow** clearly for users

---

## 📝 **Steps for Bang Ilham Right Now**

### **Step 1: Find GRN ID**
```sql
-- Run in psql atau SQL client
SELECT id, nomor_grn, status, created_at 
FROM goods_receipts 
ORDER BY created_at DESC 
LIMIT 1;
```

Copy the `id` (UUID format) and `nomor_grn`.

### **Step 2: Find Bahan Baku ID for Mie Instant**
```sql
SELECT id, kode, nama 
FROM raw_materials 
WHERE nama ILIKE '%mie instant%';
```

Copy the `id`.

### **Step 3: Submit QC via API**
```bash
# Replace [GRN_ID] and [BAHAN_BAKU_ID] with actual IDs
curl -X POST http://localhost:3000/api/purchasing/qc \
  -H "Content-Type: application/json" \
  -d '{
    "grn_id": "[GRN_ID]",
    "items": [
      {
        "bahan_baku_id": "[BAHAN_BAKU_ID]",
        "jumlah_diperiksa": 50,
        "jumlah_diterima": 50,
        "jumlah_ditolak": 0,
        "hasil": "passed",
        "alasan": "Fix inventory - tested by Bang Ilham"
      }
    ]
  }'
```

### **Step 4: Verify Inventory**
1. Refresh: http://localhost:3000/dashboard/inventory
2. Find "Mie Instant"
3. Stock should be 50 now ✅

---

## 🚨 **Important Note**

**Current Design is Actually Correct!**

Proper warehouse management requires:
1. **Goods Receipt** → Physical receiving
2. **QC Inspection** → Quality check
3. **Stock In** → Only accepted items go to inventory

This prevents:
- Defective items entering inventory
- Incorrect stock valuations
- Quality issues in production

**Recommendation:** Keep QC step, but maybe add "Skip QC" option for trusted scenarios.

---

## 📊 **Database Schema Reference**

```sql
-- QC Inspections Table
CREATE TABLE qc_inspections (
  id UUID PRIMARY KEY,
  goods_receipt_id UUID REFERENCES goods_receipts(id),
  bahan_baku_id UUID REFERENCES raw_materials(id),
  jumlah_diperiksa INTEGER NOT NULL,
  jumlah_diterima INTEGER NOT NULL,
  jumlah_ditolak INTEGER NOT NULL,
  hasil TEXT CHECK (hasil IN ('passed', 'rejected', 'partial')),
  inspector_id UUID REFERENCES auth.users(id),
  tanggal_inspeksi TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory Movement Triggered by QC
-- Function: addStockFromQC()
-- Called from: /api/purchasing/qc POST route
```

---

**Need help finding the GRN ID or submitting QC?** 

DM me the GRN number and I'll help craft the exact API call! 💪
