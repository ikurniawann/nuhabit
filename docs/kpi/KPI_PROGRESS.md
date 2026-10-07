# KPI Performance Management - Progress Tracking

> Modul KPI baru sesuai format Excel (Format KPI.xlsx)
> Dibuat: Mei 2026
> Status: **85% Selesai** ⏸️

---

## 📋 Ringkasan Modul

Modul KPI Performance Management yang baru dibuat dari nol untuk menggantikan modul lama. Mengikuti format Excel dengan struktur:
- **Cover** — Data karyawan, periode, reviewer
- **RKK (Rencana Kerja Karyawan)** — 5 KPI dengan bobot total 70%
- **Realisasi & Skala 1-5** — Quality, Quantity, Timeliness
- **Values 5C** — Caring, Credible, Competent, Competitive, Customer Delight (bobot 20%)
- **Hasil Penilaian** — Total score 500, kategori Outstanding/Exceed/Meet/Need Improvement/Unacceptable
- **Development Plan** — Rencana pengembangan karyawan
- **Tanda Tangan** — Reviewee, Reviewer, Employee HR

---

## ✅ Sudah Selesai (85%)

### 1. Database Migration
- **File**: `database/migrations/20260514_000002_kpi_performance_v2.sql`
- **Status**: ✅ Siap dijalankan
- **Tabel Baru**:
  - `behavioral_assessments` — Penilaian Values 5C
  - `development_plans` — Rencana pengembangan
  - `project_assignments` — Penilaian proyek
  - `behavioral_standards` — Definisi standar perilaku 5C
  - `score_scales` — Skala 1-5 dengan deskripsi
  - `performance_categories` — Kategori hasil (Outstanding, dll)
- **Update Tabel Existing**:
  - `employee_kpis` — Kolom score, score_label, actual_quality, actual_quantity, actual_timeliness
  - `performance_reviews` — Kolom total_work_result_score, total_behavioral_score, grand_total_score, category, signature dates

### 2. API Backend (6 Endpoint)
| Endpoint | Method | Status |
|----------|--------|--------|
| `/api/hris/performance/reviews` | GET, POST | ✅ |
| `/api/hris/performance/reviews/[id]` | GET, PUT, DELETE | ✅ |
| `/api/hris/performance/employee-kpis` | GET, POST, PUT, DELETE | ✅ |
| `/api/hris/performance/behavioral` | GET, POST | ✅ |
| `/api/hris/performance/development-plans` | GET, POST | ✅ |
| `/api/hris/performance/score-scales` | GET | ✅ |

### 3. Frontend Pages
| Halaman | Path | Status | Keterangan |
|---------|------|--------|------------|
| **List Performance Review** | `/dashboard/hris/performance` | ✅ | Tabel + filter + statistik kartu |
| **Wizard Review Baru** | `/dashboard/hris/performance/new` | ✅ | 6 Step sesuai Excel |
| **Detail Review** | `/dashboard/hris/performance/[id]` | ⚠️ | Summary + tanda tangan (perlu tab) |
| **Edit Review** | `/dashboard/hris/performance/[id]/edit` | ❌ | Belum dibuat |

### 4. Navigasi
- **File**: `src/app/dashboard/(dashboard)/layout.tsx`
- **Status**: ✅ Menu "KPI & Performance" sudah update di sidebar

### 5. Build Fixes
| Error Type | Files Fixed | Status |
|------------|-------------|--------|
| `items=` prop di Select | `employees/new/page.tsx` (5 tempat) | ✅ |
| `CardDescription` tidak ada | `offboarding/page.tsx`, `onboarding/page.tsx` | ✅ |
| `SelectValue` dengan children | `sections/page.tsx`, `talent-pool/page.tsx`, `page.tsx` | ✅ |
| Icon mapping | `sidebar-client.tsx` (circle-stack, document-text, clipboard-document-check) | ✅ |
| Toast destructuring | Purchasing files (delivery, grn, suppliers) | ✅ |

---

## ⏸️ Belum Selesai (15%)

### 1. Build Verification
- **Status**: ⚠️ Perlu dicek ulang
- **Last Check**: Masih ada beberapa error TypeScript minor
- **Action**: Jalankan `npm run build` dan fix error yang tersisa

### 2. Halaman Edit Review
- **File**: `src/app/dashboard/(dashboard)/hris/performance/[id]/edit/page.tsx`
- **Status**: ❌ Belum dibuat
- **Kebutuhan**:
  - Copy struktur dari `new/page.tsx`
  - Fetch data existing dari API saat load
  - Pre-fill semua form fields
  - Update API calls dari POST ke PUT
  - Tombol hapus per KPI/behavioral/development

### 3. Halaman Detail dengan Tab
- **File**: `src/app/dashboard/(dashboard)/hris/performance/[id]/page.tsx`
- **Status**: ⚠️ Partial (hanya summary)
- **Kebutuhan**:
  - Tab "RKK Detail" — tampilkan tabel KPI dengan skor
  - Tab "Values 5C" — tampilkan 5C values dengan skor dan notes
  - Tab "Development Plan" — tampilkan list development plans
  - Pastikan API `reviews/[id]/route.ts` return data lengkap (kpis, behavioral, developments)

### 4. Migration Execution
- **File**: `database/migrations/20260514_000002_kpi_performance_v2.sql`
- **Status**: ❌ Belum dijalankan ke PostgreSQL
- **Action**: User akan jalankan manual via psql atau SQL client

---

## 🚀 Next Steps (Prioritas)

1. **Build Verification** — Pastikan build bersih
2. **Buat Halaman Edit** — File `[id]/edit/page.tsx`
3. **Lengkapi Detail Page** — Tambah tab RKK/5C/DevPlan
4. **Jalankan Migration** — Execute SQL ke PostgreSQL
5. **Test End-to-End** — Create review baru, edit, lihat detail

---

## 📁 File-File Penting

### Migration
```
database/migrations/20260514_000002_kpi_performance_v2.sql
```

### API Routes
```
src/app/api/hris/performance/
├── reviews/
│   ├── route.ts
│   └── [id]/route.ts
├── employee-kpis/route.ts
├── behavioral/route.ts
├── development-plans/route.ts
└── score-scales/route.ts
```

### Frontend Pages
```
src/app/dashboard/(dashboard)/hris/performance/
├── page.tsx (List)
├── new/page.tsx (Wizard Baru)
├── [id]/page.tsx (Detail)
└── [id]/edit/page.tsx (Edit) — ❌ BELUM ADA
```

---

## 📝 Catatan Teknis

### Skala Penilaian (1-5)
| Score | Label | Min % | Max % | Deskripsi |
|-------|-------|-------|-------|-----------|
| 5 | Outstanding | 130.01 | 999.99 | Jauh melampaui standar |
| 4 | Exceed Expectation | 115.01 | 130.00 | Melampaui standar |
| 3 | Meet Expectation | 95.01 | 115.00 | Memenuhi standar |
| 2 | Need Improvement | 70.01 | 95.00 | Perlu perbaikan |
| 1 | Unacceptable | 0.00 | 70.00 | Tidak memenuhi standar |

### Kategori Hasil
| Kategori | Min Score | Max Score | Deskripsi |
|----------|-----------|-----------|-----------|
| Outstanding | 441 | 500 | Kinerja luar biasa |
| Exceed Expectation | 351 | 440.99 | Kinerja sangat baik |
| Meet Expectation | 251 | 350.99 | Kinerja memenuhi standar |
| Need Improvement | 161 | 250.99 | Kinerja perlu perbaikan |
| Unacceptable | 0 | 160.99 | Kinerja tidak memenuhi standar |

### Formula Scoring
```
Hasil Kerja (70%) = Σ(score × weight / 100) × 500 / 100
Perilaku (20%) = Σ(score × weight) / total_weight × 100
Project (10%) = Σ(actual_score × weight / 100)
─────────────────────────────────────────────────────
Grand Total = Hasil Kerja + Perilaku + Project (Max 500)
```

---

**Last Updated**: Mei 2026
**Next Action**: Build verification → Buat halaman Edit → Lengkapi Detail page
