# HRIS Fase 3 - KPI & Performance Management

## 📋 Overview
Sistem manajemen KPI dan performance review untuk evaluasi kinerja karyawan secara periodik.

## ✅ Completed (Mei 5, 2026)

### Database Schema
- [x] Tabel `kpi_templates` - Template KPI reusable
- [x] Tabel `kpi_template_mappings` - Mapping ke department/position
- [x] Tabel `employee_kpis` - KPI individual per karyawan
- [x] Tabel `kpi_progress_updates` - Tracking progress bulanan
- [x] Tabel `performance_reviews` - Performance review periodik
- [x] RLS policies untuk semua tabel
- [x] Indexes untuk query optimization
- [x] Seed data 30 predefined KPI templates

### Predefined KPI Templates (30 total)
**Sales (5):** Target Penjualan, Pelanggan Baru, Nilai Kontrak, Conversion Rate, Retensi
**Operations (5):** Efisiensi Produksi, Waktu Order, Error Rate, Kepatuhan SOP, Utilisasi
**Customer Service (4):** CSAT, Response Time, Ticket Resolution, NPS
**Finance (4):** Laporan Keuangan, Penghematan, Akurasi Proyeksi, Penagihan Piutang
**HR (4):** Retensi Karyawan, Waktu Rekrutmen, Kehadiran, Pelatihan
**Technical (4):** Uptime, Bug Resolution, Deploy Frequency, Test Coverage
**Marketing (4):** Traffic Growth, CPA, Engagement Rate, ROAS

### Pages Implemented
- [x] `/dashboard/hris/performance/dashboard` - Dashboard overview
- [x] `/dashboard/hris/performance/kpi-templates` - List & manage templates
- [x] `/dashboard/hris/performance/kpi-templates/new` - Create new template
- [x] `/dashboard/hris/performance/kpi-templates/[id]/edit` - Edit template
- [x] `/dashboard/hris/performance/employee-kpis` - Employee KPI list
- [x] `/dashboard/hris/performance/employee-kpis/new` - Assign KPI to employee
- [x] `/dashboard/hris/performance/reviews` - Performance review list
- [x] `/dashboard/hris/performance/reviews/new` - Create new review

### API Routes
- [x] `POST /api/hris/kpi-templates` - Create template
- [x] `GET /api/hris/kpi-templates` - List templates
- [x] `PUT /api/hris/kpi-templates/[id]` - Update template
- [x] `DELETE /api/hris/kpi-templates/[id]` - Delete template
- [x] `POST /api/hris/employee-kpis` - Assign KPI
- [x] `GET /api/hris/employee-kpis` - List employee KPIs
- [x] `PUT /api/hris/employee-kpis/[id]` - Update KPI
- [x] `DELETE /api/hris/employee-kpis/[id]` - Remove KPI
- [x] `POST /api/hris/performance-reviews` - Create review
- [x] `GET /api/hris/performance-reviews` - List reviews
- [x] `PUT /api/hris/performance-reviews/[id]` - Update review
- [x] `DELETE /api/hris/performance-reviews/[id]` - Delete review

---

## 🚧 In Progress / TODO

### 1. KPI Progress Tracking
- [ ] Halaman detail employee KPI dengan progress chart
- [ ] Form update progress bulanan (input actual value + evidence)
- [ ] Auto-calculate achievement percentage
- [ ] Visual progress bar per KPI
- [ ] API endpoint `POST /api/hris/employee-kpis/[id]/progress`

### 2. Performance Review Workflow
- [ ] Approval workflow untuk performance review
- [ ] Self-assessment form untuk karyawan
- [ ] Manager assessment form
- [ ] Calibration meeting notes
- [ ] Final review document generation (PDF)

### 3. Dashboard & Analytics
- [ ] Company-wide performance dashboard
- [ ] Department performance comparison
- [ ] KPI achievement trends (line chart)
- [ ] Top performers leaderboard
- [ ] Low performers alert

### 4. Integration Features
- [ ] Link KPI achievement dengan payroll (bonus calculation)
- [ ] Promotion recommendation based on performance
- [ ] Training recommendation untuk skill gaps
- [ ] Notification system untuk review deadlines

### 5. Advanced Features
- [ ] 360-degree feedback (peer, subordinate, manager)
- [ ] OKR (Objectives and Key Results) support
- [ ] Competency framework integration
- [ ] Performance improvement plan (PIP) tracking

---

## 🎯 Priority Next Steps

### Immediate (Hari ini):
1. **KPI Progress Tracking Page** - Halaman untuk update progress bulanan
2. **Employee KPI Detail Page** - View detail KPI dengan progress history
3. **Achievement Calculation** - Auto-calculate % achievement di backend

### Short Term (Minggu ini):
1. **Performance Review Detail** - Halaman lengkap untuk conduct review
2. **Dashboard Charts** - Visualisasi performance metrics
3. **Notifications** - Reminder untuk progress update & review deadlines

---

## 📊 Data Flow

```
KPI Templates → Assign to Employee → Monthly Progress Updates → Performance Review
     ↓                ↓                      ↓                        ↓
  Predefined      Individual            Track actual              Evaluate
  templates       assignment            vs target                 overall
```

---

## 🔗 Related Files
- Migration: `database/migrations/20260507_000001_create_kpi_performance.sql`
- Pages: `src/app/dashboard/(dashboard)/hris/performance/`
- API: `src/app/api/hris/kpi-templates|employee-kpis|performance-reviews/`
