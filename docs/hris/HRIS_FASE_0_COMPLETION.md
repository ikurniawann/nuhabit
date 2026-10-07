# ✅ FASE 0 - HRIS Foundation (COMPLETED)

**Tanggal Completion**: 3 Mei 2026  
**Status**: ✅ Database Migration + API Routes + Components Selesai

---

## 📦 Yang Sudah Diimplementasi

### 1. Database Schema (Migration 007_hris_foundation_v2.sql)

#### **Tabel Baru:**
- ✅ `departments` - Struktur organisasi (department/divisi)
- ✅ `employees` - Master data karyawan (menggantikan/mengextend `staff`)

#### **Kolom Baru:**
- ✅ `candidates.promoted_to_employee_id` - Link ke employee untuk integrasi Talent Pool → Employee
- ✅ `candidates.promotion_date` - Timestamp promosi

#### **Functions:**
- ✅ `generate_nip()` - Auto-generate NIP format EMP-YYYY-XXXXX
- ✅ `set_employee_nip()` - Trigger auto-set NIP before insert
- ✅ `promote_candidate_to_employee()` - Promote kandidat jadi employee (1-call integration)
- ✅ `is_hrd()`, `is_manager()`, `current_employee_id()` - RLS helper functions

#### **RLS Policies:**
- ✅ HRD: Full access ke semua employees & departments
- ✅ Manager: Read access (simplified)
- ✅ Employee: Read own data only

#### **Indexes:**
- ✅ 15+ indexes untuk performa (nip, email, department_id, reporting_to, dll)

---

### 2. TypeScript Types (`types/hris.ts`)

```typescript
// Enums
- EmploymentStatus (probation, contract, permanent, internship, resigned, terminated, suspended)
- GenderType (male, female)
- MaritalStatusType (single, married, divorced, widowed)

// Interfaces
- Employee (complete employee data)
- EmployeeWithRelations (dengan joins ke department, section, manager, dll)
- Department
- Section (dari existing staff module)
- PromotionRequest/PromotionResponse
- EmployeeListFilters, EmployeeCreateData, EmployeeUpdateData
- EmployeeFormData, PromoteCandidateFormData

// Helpers
- EMPLOYMENT_STATUS_LABELS
- EMPLOYMENT_STATUS_COLORS
- formatNIP()
- calculateTenure()
```

---

### 3. API Routes

#### **`/api/hris/employees`**
- ✅ `GET` - List employees dengan filter & pagination
  - Query params: search, department_id, section_id, employment_status, is_active, page, limit, sort_by, sort_order
  - Returns: PaginatedResponse<Employee>
  
- ✅ `POST` - Create new employee
  - Body: EmployeeCreateData
  - Auto-generate NIP jika tidak disediakan
  - Validation: required fields, duplicate email/NIP check

#### **`/api/hris/employees/[id]`**
- ✅ `GET` - Get employee detail dengan relations (department, section, manager, direct_reports)
- ✅ `PUT` - Update employee
- ✅ `DELETE` - Soft delete (set is_active = false, end_date = now)

#### **`/api/hris/promote`**
- ✅ `POST` - Promote candidate to employee
  - Body: { candidate_id, join_date?, employment_status?, department_id?, reporting_to? }
  - Calls DB function: `promote_candidate_to_employee()`
  - Returns: Employee + NIP + candidate info

---

### 4. Components (`components/hris/`)

#### **`EmployeeTable.tsx`**
- ✅ Table dengan sorting, filtering, pagination
- ✅ Filters: search, employment status, active/inactive
- ✅ Badges untuk employment status dengan warna
- ✅ Links ke detail employee

#### **`PromoteCandidateButton.tsx`**
- ✅ Button untuk promote candidate → employee
- ✅ Dialog modal dengan form:
  - Candidate info (read-only)
  - Join date picker
  - Employment status selector
- ✅ Auto-generate NIP
- ✅ Success handling dengan alert
- ✅ Disable jika sudah promoted atau status tidak eligible

---

### 5. Helper Functions (`@/lib/hris/client-api.ts`)

```typescript
- getEmployees(filters) - Fetch employees dengan filter
- getEmployee(id) - Fetch employee by ID
- createEmployee(data) - Create employee
- updateEmployee(id, data) - Update employee
- deleteEmployee(id) - Soft delete
- promoteCandidate(candidateId, options) - Promote candidate
- formatNIP(nip) - Format NIP display
- calculateTenure(joinDate) - Hitung masa kerja
- getEmploymentStatusLabel(status) - Label Bahasa Indonesia
- getEmploymentStatusColor(status) - Tailwind color class
```

---

### 6. Folder Structure

```
src/
├── app/
│   ├── (dashboard)/
│   │   └── hris/                    ✅ MODUL HRIS BARU
│   │       ├── employees/
│   │       │   └── page.tsx         ✅ List employees
│   │       ├── organization/
│   │       │   └── departments/     ✅ (ready untuk org chart)
│   │       └── onboarding/          ✅ (ready untuk onboarding)
│   └── api/
│       └── hris/
│           ├── employees/
│           │   ├── route.ts         ✅ GET, POST
│           │   └── [id]/
│           │       └── route.ts     ✅ GET, PUT, DELETE
│           └── promote/
│               └── route.ts         ✅ POST
├── components/
│   └── hris/
│       ├── EmployeeTable.tsx        ✅
│       └── PromoteCandidateButton.tsx ✅
└── lib/
    └── @/lib/pg/
        └── hris.ts                  ✅ Helper functions

types/
├── hris.ts                          ✅ HRIS types
└── index.ts                         ✅ Re-export hris types
```

---

## 🧪 Testing Checklist

### Database
- [x] Migration run successfully
- [x] Tables created: `employees`, `departments`
- [x] Function `generate_nip()` tested → EMP-2026-00001
- [x] Test employee inserted (1 row)
- [ ] Test `promote_candidate_to_employee()` function
- [ ] Test RLS policies (HRD vs Manager vs Employee)

### API
- [ ] GET `/api/hris/employees` - List employees
- [ ] POST `/api/hris/employees` - Create employee
- [ ] GET `/api/hris/employees/[id]` - Get detail
- [ ] PUT `/api/hris/employees/[id]` - Update employee
- [ ] DELETE `/api/hris/employees/[id]` - Soft delete
- [ ] POST `/api/hris/promote` - Promote candidate

### UI Components
- [ ] EmployeeTable rendering
- [ ] EmployeeTable filters & pagination
- [ ] PromoteCandidateButton dialog
- [ ] PromoteCandidateButton success flow

---

## 📋 Next Steps (Fase 0 Completion)

1. **Test API endpoints** dengan Postman/curl
2. **Test Promote Flow** dari Candidates page
3. **Buat Employee Detail Page** (`/dashboard/hris/employees/[id]/page.tsx`)
4. **Buat Employee Form** (Create/Edit)
5. **Integrate PromoteCandidateButton** ke Candidates page
6. **Add sidebar menu** untuk HRIS module

---

## 🎯 Integration Points

### Talent Pool → Employee
```typescript
// Di candidates/[id]/page.tsx atau talent-pool/page.tsx
import { PromoteCandidateButton } from '@/components/hris/PromoteCandidateButton';

<PromoteCandidateButton 
  candidate={candidate} 
  onSuccess={() => {
    // Refresh candidate data
    router.refresh();
  }} 
/>
```

### Fetch Employees
```typescript
import { getEmployees } from '@/@/lib/hris/client-api';

const { data, total, page, per_page } = await getEmployees({
  search: 'John',
  employment_status: 'permanent',
  page: 1,
  limit: 20,
});
```

---

## 📝 Notes

- **NIP Format**: EMP-YYYY-XXXXX (auto-generated, unique per year)
- **Soft Delete**: Set `is_active = false` instead of hard delete
- **RLS**: HRD full access, Manager read-only, Employee read self
- **Employment Status**: probation, contract, permanent, internship, resigned, terminated, suspended
- **Migration File**: `database/migrations/007_hris_foundation_v2.sql`

---

**Fase 0 Status**: ✅ **FOUNDATION READY**  
**Ready for**: Fase 1 - Core HR Operations (Attendance, Leave, On/Offboarding)
