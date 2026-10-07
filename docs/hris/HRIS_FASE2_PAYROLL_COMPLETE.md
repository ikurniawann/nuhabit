# HRIS FASE 2 - PAYROLL & BENEFITS ✅ COMPLETE

> ⚠️ **SUPERSEDED (2026-07-17) oleh
> [EPIC-008 Payroll Revamp](../epics/EPIC-008-payroll-revamp.md).**
> Implementasi payroll dirombak total: konfigurasi tarif dari DB, integrasi
> shift/absensi v2, kontrak PKWT/PKWTT, pengajuan lembur dua arah, cicilan
> pinjaman + limitasi, slip gaji ESS, FK integritas. Dokumen ini dipertahankan
> sebagai catatan sejarah — jangan dijadikan acuan perilaku sistem saat ini.

**Date Completed:** 2026-05-05  
**Status:** Ready for Testing  
**Compliance:** Indonesia 2026 (PPh 21 ETR, BPJS, THR, Tapera)

---

## 🎯 WHAT WAS BUILT

### 1. Database Schema (8 Tables)

**Migration File:** `database/migrations/20260505_000001_create_payroll_benefits.sql`

| Table | Purpose |
|-------|---------|
| `payroll_settings` | Company-wide payroll config (BPJS rates, PTKP, PPh 21 brackets) |
| `employee_salary` | Salary structure per employee (base, allowances, deductions) |
| `payroll_runs` | Monthly payroll processing runs |
| `payroll_details` | Per-employee calculation details within a run |
| `benefits` | Company benefits catalog (insurance, wellness, pension) |
| `employee_benefits` | Employee enrollment in benefits |
| `loans` | Employee loans & salary advances |
| `payroll_tax_config` | Annual PPh 21 ETR configuration |

**Helper Functions:**
- `calculate_pph21_etr()` — Progressive tax calculation
- `calculate_bpjs_deductions()` — BPJS TK & Kesehatan calculations

**RLS Policies:** Strict access control (HRD/Finance only for sensitive data)

---

### 2. Payroll Calculation Engine

**Location:** `src/lib/payroll/calculator.ts`

**Features:**
- ✅ PPh 21 ETR progressive calculation (5 brackets: 5%, 15%, 25%, 30%, 35%)
- ✅ BPJS Ketenagakerjaan (JHT 2%, JP 1%, JKK 0.24%, JKM 0.30%)
- ✅ BPJS Kesehatan (1% employee, 4% employer)
- ✅ Tapera (2.5% employee, 0.5% employer)
- ✅ THR prorata calculation
- ✅ Overtime calculation (1.5x multiplier)
- ✅ Unpaid leave deduction
- ✅ Cost to Company calculation

**2026 Rates Implemented:**
- PTKP: TK/0=54jt, K/3=72jt
- BPJS caps: TK=10.4jt, Kes=12jt
- PPh 21 brackets: 0-60jt (5%), 60-250jt (15%), 250-500jt (25%), 500jt-5M (30%), >5M (35%)

---

### 3. API Routes (7 Endpoints)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/hris/payroll` | GET, POST | List & create payroll runs |
| `/api/hris/payroll/[id]` | GET, PUT, DELETE | Detail & update payroll run |
| `/api/hris/payroll/[id]/calculate` | POST | Calculate payroll for all employees |
| `/api/hris/payslips` | GET | List payslips |
| `/api/hris/employee-salary` | GET, POST | List & create salary structures |
| `/api/hris/loans` | GET, POST | List & request loans |
| `/api/hris/loans/[id]/approve` | POST | Approve/reject loan |

---

### 4. UI Pages (3 Pages)

| Page | URL | Features |
|------|-----|----------|
| Payroll Dashboard | `/dashboard/hris/payroll` | List runs, create new, calculate, approve, mark paid |
| Payroll Detail | `/dashboard/hris/payroll/[id]` | View details per employee, export CSV, view payslip |
| Salary Structure | `/dashboard/hris/salary` | Manage employee salary configurations |

**Components:**
- `PayslipPDF.tsx` — Professional payslip template (print-ready)

---

## 📊 PAYROLL WORKFLOW

```
1. Create Payroll Run (Draft)
   ↓
2. Calculate Payroll (auto-fetch attendance, leaves, salary)
   ↓
3. Review & Verify (HRD/Finance)
   ↓
4. Approve Payroll (status: completed)
   ↓
5. Mark as Paid (status: paid)
   ↓
6. Generate & Email Payslips
```

---

## 🇮🇩 INDONESIA COMPLIANCE 2026

### PPh 21 ETR (Effective Tax Rate)

**Progressive Brackets:**
| Bracket | Range | Rate |
|---------|-------|------|
| 1 | 0 - 60jt | 5% |
| 2 | 60jt - 250jt | 15% |
| 3 | 250jt - 500jt | 25% |
| 4 | 500jt - 5M | 30% |
| 5 | >5M | 35% |

**PTKP (Penghasilan Tidak Kena Pajak):**
- TK/0: 54jt
- TK/1: 58.5jt
- TK/2: 63jt
- TK/3: 67.5jt
- K/0: 58.5jt
- K/1: 63jt
- K/2: 67.5jt
- K/3: 72jt

### BPJS Rates (2026)

**Ketenagakerjaan:**
- JHT: 2% employee + 3.7% employer
- JP: 1% employee + 2% employer (if salary >= 5M)
- JKK: 0.24% employer
- JKM: 0.30% employer

**Kesehatan:**
- 1% employee + 4% employer
- Cap: 12jt/month

**Tapera:**
- 2.5% employee + 0.5% employer

---

## 📁 FILES CREATED/MODIFIED

### New Files:
```
database/migrations/20260505_000001_create_payroll_benefits.sql (25KB)
src/lib/payroll/calculator.ts (15KB)
src/lib/payroll/index.ts
src/app/api/hris/payroll/route.ts
src/app/api/hris/payroll/[id]/route.ts
src/app/api/hris/payroll/[id]/calculate/route.ts
src/app/api/hris/payslips/route.ts
src/app/api/hris/employee-salary/route.ts
src/app/api/hris/loans/route.ts
src/app/api/hris/loans/[id]/approve/route.ts
src/app/dashboard/(dashboard)/hris/payroll/page.tsx (14KB)
src/app/dashboard/(dashboard)/hris/payroll/[id]/page.tsx (10KB)
src/app/dashboard/(dashboard)/hris/salary/page.tsx (12KB)
src/components/hris/PayslipPDF.tsx (9KB)
HRIS_FASE2_PAYROLL_COMPLETE.md (this file)
```

**Total:** ~100KB new code

---

## 🧪 TESTING CHECKLIST

### Database
- [ ] Run migration: `npm run db:migrate:apply`
- [ ] Verify all 8 tables created
- [ ] Test RLS policies (login as HRD vs regular employee)
- [ ] Test `calculate_pph21_etr()` function with various incomes

### Payroll Calculation
- [ ] Create test employee with salary data
- [ ] Create payroll run for current month
- [ ] Run calculation via API
- [ ] Verify PPh 21 calculation matches manual calculation
- [ ] Verify BPJS deductions match rates
- [ ] Verify THR prorata for mid-year joiner

### UI
- [ ] Create new payroll run from dashboard
- [ ] Calculate payroll
- [ ] View detail page
- [ ] Export CSV
- [ ] View payslip (PDF preview)
- [ ] Update salary structure

### Integration
- [ ] Attendance integration (working days, late days)
- [ ] Leave integration (unpaid leave deduction)
- [ ] Loan deduction from payroll

---

## 🚀 DEPLOYMENT

**Production URL:** https://suluinwounderland.com/arkiv-os

**Access:**
- Login dengan account HRD/Finance
- Navigate to "HRIS Modules" → "Payroll & Benefits"

---

## 📋 NEXT STEPS (TODO)

### Immediate (Before Production)
1. **Test payroll calculation** with real employee data
2. **Verify tax calculations** with finance team
3. **Add email integration** for payslip distribution (Resend)
4. **Add WhatsApp notifications** for payslip ready (Fonnte)

### Phase 2.5 (Enhancements)
- [ ] Bulk payslip PDF generation & email
- [ ] Loan approval workflow UI
- [ ] Benefits enrollment UI
- [ ] Payroll journal entry export (accounting integration)
- [ ] SPT Masa 1721-A1 generation

### Phase 3 (Performance Management)
- KPI setup per jabatan
- Performance reviews
- 360° feedback

---

## 📞 SUPPORT

**Documentation:**
- This file: `/Users/ilham/Desktop/talentpool/HRIS_FASE2_PAYROLL_COMPLETE.md`
- Migration: `database/migrations/20260505_000001_create_payroll_benefits.sql`
- Calculator: `src/lib/payroll/calculator.ts`

**Repository:**
- GitHub: https://github.com/ikurniawann/talentpool
- Branch: main

---

**Built with ❤️ by OpenClaw Agent**  
**Status:** ✅ Ready for Testing
