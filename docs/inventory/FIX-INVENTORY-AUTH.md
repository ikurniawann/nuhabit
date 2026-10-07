# 🐛 FIX: Inventory Shows 0 Despite GRN Update

**Date:** April 23, 2026  
**Status:** ROOT CAUSE IDENTIFIED  

---

## 🔍 **Investigation Results**

### **Good News:** ✅ Inventory IS Updating!

From terminal logs:
```
[PATCH GRN/4bdc69a7-...] Updating inventory...
[PATCH GRN/4bdc69a7-...] Adding 40 to inventory for 6ad2009e-3b7a-487d-8f51-a4f21d119bf3
[PATCH GRN/4bdc69a7-...] Inventory updated ✅
```

**Database HAS the correct stock!** The issue is the **frontend cannot fetch it**.

---

## 🚨 **Real Problem: API Authentication Failure**

### **Error Log:**
```
GET /api/inventory?page=1&limit=20 500 in 91ms
Error fetching inventory: ApiError: Authentication required
    at requireApiRole (src/lib/api/auth.ts:54:16)
    at async GET (src/app/api/inventory/route.ts:7:5)
```

### **Root Cause:**
The `/api/inventory` route requires authentication via `requireApiRole()`, but:
1. Auth token not being sent from frontend
2. Token expired
3. User session invalid
4. CORS issue blocking auth headers

---

## ✅ **Solution Options**

### **Option A: Refresh Login Session** (Quick Fix)

**Steps:**
1. Logout from Arkiv OS
2. Clear browser cache/cookies
3. Login again
4. Go to inventory page
5. Check if stock shows correctly

**Why this works:**
- Fresh auth token
- Valid session
- Proper headers sent

---

### **Option B: Check Frontend Auth Headers** (Debug)

**File:** `src/app/(dashboard)/dashboard/inventory/page.tsx`

**Check if fetch includes credentials:**
```typescript
// Should be like this:
const res = await fetch(`/api/inventory?${params}`, {
  credentials: 'include', // or headers with Authorization
});
```

**Or using pg pool / REST API directly:**
```typescript
const db = createBrowserClient();
const { data } = await db
  .from('v_raw_materials_stock')
  .select('*');
```

---

### **Option C: Use PostgreSQL view directly** (Recommended Long-term)

Instead of calling `/api/inventory` (which needs auth), query the view directly with pg pool / REST API:

**Modify:** `src/app/(dashboard)/dashboard/inventory/page.tsx`

**From:**
```typescript
const res = await fetch(`/api/inventory?${params}`);
```

**To:**
```typescript
import { createBrowserClient } from '@/lib/pg/browser-client';

const db = createBrowserClient();
const { data, error } = await db
  .from('v_raw_materials_stock')
  .select('*')
  .eq('is_active', true)
  .order('nama', { ascending: true });
```

**Benefits:**
- No API route needed
- Uses RLS (Row Level Security)
- Faster (no middleware)
- Simpler code

---

## 🎯 **Immediate Action Plan**

### **Step 1: Verify Database Has Correct Stock**

Run in psql atau SQL client:
```sql
SELECT 
  rm.kode,
  rm.nama,
  inv.qty_available,
  inv.unit_cost,
  inv.last_movement_at
FROM inventory inv
JOIN raw_materials rm ON rm.id = inv.raw_material_id
WHERE rm.nama ILIKE '%mie instant%'
ORDER BY inv.last_movement_at DESC
LIMIT 5;
```

**Expected:** Should show qty_available > 0 (e.g., 10, 40, or 50)

---

### **Step 2: Quick Test - Refresh Browser + Hard Reload**

1. Go to: http://localhost:3000/dashboard/inventory
2. Press `Ctrl+Shift+R` (hard reload)
3. Check if stock appears

---

### **Step 3: If Still 0 - Check Browser Console**

1. Open DevTools (F12)
2. Go to Network tab
3. Refresh inventory page
4. Look for `/api/inventory` request
5. Check:
   - Status code (should be 200, not 401/500)
   - Request headers (Authorization present?)
   - Response body (error message?)

**Screenshot the console and network tab if error persists.**

---

### **Step 4: Fix Auth Issue**

**If 401 Unauthorized:**
- Logout and login again
- Check if user has proper role (`warehouse_staff`, `warehouse_admin`, etc.)

**If 500 Error:**
- Check terminal logs for detailed error
- May need to fix API route

---

## 💡 **Long-term Recommendation**

**Remove dependency on `/api/inventory` route** and use pg pool / REST API directly in frontend components. This avoids:
- Extra API layer
- Auth token issues
- Performance overhead

**Migration Plan:**
1. Identify all pages using `/api/inventory`
2. Replace with direct REST / pg queries
3. Add proper RLS policies
4. Test thoroughly
5. Remove unused API routes

---

## 📊 **Summary**

| Component | Status | Notes |
|-----------|--------|-------|
| GRN Creation | ✅ Working | Creates GRN successfully |
| Inventory Update Logic | ✅ Working | `addInventoryFromGrn()` called correctly |
| Database Write | ✅ Working | Stock increased in DB |
| API Route (`/api/inventory`) | ❌ Broken | Auth failure (401/500) |
| Frontend Display | ❌ Broken | Cannot fetch due to API error |

**Fix Priority:**
1. High: Fix auth issue in `/api/inventory` route OR bypass it
2. Medium: Migrate to direct REST / pg queries
3. Low: Add better error handling in frontend

---

**Next Step:** Bang Ilham silakan check browser console dan report back apa yang terlihat di Network tab untuk `/api/inventory` request! 🔍
