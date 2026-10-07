# Purchasing Module Development Plan

## 📋 Overview
Modul Purchasing untuk ERP Aapex Technology - mengelola Purchase Request (PR), Purchase Order (PO), Vendor, dan Goods Receipt.

---

## ✅ Phase 1: Foundation (Completed)

### 1.1 Types & Schemas ✅
- [x] `types/purchasing.ts` - Definisi tipe data lengkap
- [x] `lib/purchasing/utils.ts` - Helper functions (format currency, generate nomor, approval logic)

### 1.2 Master Data API ✅
- [x] `api/purchasing/vendors/route.ts` - CRUD vendor
- [x] Utils untuk generate nomor otomatis (PR-YYYY-NNNNN)

### 1.3 Purchase Request API ✅
- [x] `api/purchasing/pr/route.ts` - Create PR dengan items

### 1.4 UI Components ✅
- [x] `components/purchasing/pr-form.tsx` - Form PR dengan dynamic items

### 1.5 Pages ✅
- [x] `purchasing/page.tsx` - Dashboard purchasing dengan stats
- [x] `purchasing/pr/new/page.tsx` - Form buat PR baru
- [x] `purchasing/pr/[id]/page.tsx` - Detail PR dengan approval workflow
- [x] `purchasing/print/pr/[id]/page.tsx` - Print-friendly PR format

### 1.6 Navigation ✅
- [x] Updated `dashboard/layout.tsx` dengan purchasing menu untuk semua role

---

## 🚧 Phase 2: Core Features (Next)

### 2.1 Database Schema (PostgreSQL)
**Priority: HIGH**

```sql
-- Departments table
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  head_id UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors table
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('it', 'office', 'stationery', 'services', 'raw_material', 'other')),
  npwp TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_account_name TEXT,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase Requests table
CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number TEXT UNIQUE NOT NULL,
  requester_id UUID REFERENCES users(id) NOT NULL,
  department_id UUID REFERENCES departments(id) NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending_head', 'pending_finance', 'pending_direksi', 'approved', 'rejected', 'converted')),
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  notes TEXT,
  required_date DATE,
  current_approval_level TEXT,
  approved_by_head UUID REFERENCES users(id),
  approved_at_head TIMESTAMPTZ,
  approved_by_finance UUID REFERENCES users(id),
  approved_at_finance TIMESTAMPTZ,
  approved_by_direksi UUID REFERENCES users(id),
  approved_at_direksi TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  converted_po_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PR Items table
CREATE TABLE pr_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID REFERENCES purchase_requests(id) ON DELETE CASCADE NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL,
  estimated_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0
);

-- RLS Policies
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
```

### 2.2 PR List Page
**Priority: HIGH**
**File:** `app/(dashboard)/dashboard/purchasing/pr/page.tsx`

Features:
- [ ] Tabel list PR dengan filter (status, dept, date range)
- [ ] Search PR number
- [ ] Pagination
- [ ] Export to Excel/CSV (optional)

### 2.3 Approval API Endpoints
**Priority: HIGH**
**File:** `app/api/purchasing/pr/[id]/approve/route.ts`

```typescript
// POST /api/purchasing/pr/[id]/approve
// Body: { action: "approve" | "reject", reason?: string }
```

### 2.4 Submit PR Workflow
**Priority: HIGH**
**File:** Update `pr-form.tsx` dan `route.ts`

Flow:
1. Simpan sebagai Draft → status: draft
2. Submit PR → Check threshold → Set status: pending_head/pending_finance/pending_direksi

---

## 📦 Phase 3: Purchase Order (PO)

### 3.1 PO Schema
```sql
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE NOT NULL,
  pr_id UUID REFERENCES purchase_requests(id) NOT NULL,
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partial', 'received', 'closed', 'cancelled')),
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  tax_percent DECIMAL(5,2) DEFAULT 11,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  shipping_cost DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  order_date DATE NOT NULL,
  delivery_date DATE,
  expected_delivery DATE,
  payment_terms TEXT,
  delivery_address TEXT NOT NULL DEFAULT '',
  notes TEXT,
  created_by UUID REFERENCES users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE po_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0
);
```

### 3.2 PO Pages & Components
- [ ] `app/(dashboard)/dashboard/purchasing/po/page.tsx` - List PO
- [ ] `app/(dashboard)/dashboard/purchasing/po/new/page.tsx` - Create PO dari PR
- [ ] `app/(dashboard)/dashboard/purchasing/po/[id]/page.tsx` - Detail PO
- [ ] `app/(dashboard)/dashboard/purchasing/print/po/[id]/page.tsx` - Print PO
- [ ] `components/purchasing/po-form.tsx` - Form PO dengan kalkulasi otomatis

### 3.3 PO API Routes
- [ ] `app/api/purchasing/po/route.ts` - List, Create
- [ ] `app/api/purchasing/po/[id]/route.ts` - Get, Update, Delete
- [ ] `app/api/purchasing/po/[id]/send/route.ts` - Mark as sent

---

## 🏢 Phase 4: Master Data Management

### 4.1 Vendor Management
- [ ] `app/(dashboard)/dashboard/purchasing/vendors/page.tsx` - List vendor
- [ ] `app/(dashboard)/dashboard/purchasing/vendors/new/page.tsx` - Add vendor
- [ ] `app/(dashboard)/dashboard/purchasing/vendors/[id]/page.tsx` - Edit vendor

### 4.2 Department Management
- [ ] `app/(dashboard)/dashboard/purchasing/departments/page.tsx` - List department

### 4.3 Products (optional, bisa pakai free text dulu)
- [ ] `app/(dashboard)/dashboard/purchasing/products/page.tsx`

---

## 📊 Phase 5: Reports & Analytics

### 5.1 Purchasing Dashboard Enhancement
- [ ] Chart: PR per bulan
- [ ] Chart: Spending per department
- [ ] Chart: PO status distribution

### 5.2 Reports
- [ ] Report: PR aging (PR yang lama pending)
- [ ] Report: Vendor performance (bisa next phase)
- [ ] Report: Budget vs Actual spending

---

## 🔔 Phase 6: Notifications (Email/WhatsApp)

### 6.1 Email Notifications
- [ ] PR submitted → notify approver
- [ ] PR approved/rejected → notify requester
- [ ] PO created → notify vendor (manual atau auto)

### 6.2 WhatsApp Integration (using existing fonnte setup)
- [ ] Same triggers as email

---

## 🔐 Phase 7: Security & Polish

### 7.1 RLS Policies
- [ ] Users hanya lihat PR dari department mereka (kecuali admin)
- [ ] Approver hanya bisa approve sesuai level

### 7.2 Validation & Error Handling
- [ ] Form validation lengkap
- [ ] Error boundaries
- [ ] Loading states

### 7.3 Testing
- [ ] Unit tests untuk utils
- [ ] Integration tests untuk API

---

## 📅 Development Timeline (Estimasi)

| Phase | Estimasi | Priority |
|-------|----------|----------|
| Phase 2: Core PR Features | 2-3 hari | HIGH |
| Phase 3: Purchase Order | 3-4 hari | HIGH |
| Phase 4: Master Data | 2 hari | MEDIUM |
| Phase 5: Reports | 2 hari | MEDIUM |
| Phase 6: Notifications | 1-2 hari | LOW |
| Phase 7: Polish | 2 hari | MEDIUM |
| **Total** | **12-15 hari** | |

---

## 🎯 Next Steps (Prioritas)

1. **Hari ini:** Setup database schema di PostgreSQL
2. **Besok:** Implement PR list page dan fix PR submit workflow
3. **Lusa:** PO creation dari PR approved
4. **Next week:** Master data (vendors) dan polish

---

## 📝 Notes

### Approval Threshold (configurable di env)
```bash
# .env.local
APPROVAL_THRESHOLD_HEAD_DEPT=5000000      # > 5jt → Head Dept
APPROVAL_THRESHOLD_FINANCE=20000000       # > 20jt → Finance
APPROVAL_THRESHOLD_DIREKSI=50000000       # > 50jt → Direksi
```

### Print Format
- A4 Portrait
- Header: Logo perusahaan + "Purchase Request"
- Table items dengan border
- Signature section untuk approval

### Role Access Matrix

| Feature | HRD | Hiring Manager | Direksi | Purchasing | Finance | Warehouse |
|---------|-----|----------------|---------|------------|---------|-------------|
| Create PR | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve PR (Head) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve PR (Finance) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Approve PR (Direksi) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Create PO | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| View All PR | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| View All PO | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Master Vendor | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Goods Receipt | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🐛 Known Issues / TODOs

1. PR Form perlu fix: `setValue("save_as_draft")` tidak ter-define
2. Perlu tambah error handling di server actions
3. Print page perlu testing di browser
4. Belum ada rate limiting untuk API

---

Mau mulai dari mana? Saran gue:
1. **Setup database dulu** → jalankan SQL migration
2. **Test PR flow** → dari create sampai approval
3. **Lanjut PO** → bikin PO dari PR yang approved