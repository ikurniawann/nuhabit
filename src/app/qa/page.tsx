import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Layers3,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react";

type ModuleSummary = {
  module: string;
  area: string;
  status: "Passed with Notes" | "Prototype Ready";
};

type Scenario = {
  id: string;
  module: string;
  scenario: string;
  actual: string;
  status: "Passed with Notes" | "Not Tested";
  notes: string;
};

type Issue = {
  id: string;
  severity: "High" | "Medium" | "Low";
  module: string;
  issue: string;
  resolution: string;
};

type Gap = {
  id: string;
  area: string;
  gap: string;
  priority: "High" | "Medium";
  recommendation: string;
};

const moduleSummary: ModuleSummary[] = [
  { module: "CRM", area: "Members, rewards, avatars, XP concept", status: "Passed with Notes" },
  { module: "POS F&B", area: "Cashier, dine-in table modal, customer add/search, product autocomplete", status: "Passed with Notes" },
  { module: "POS Open Bills", area: "Table order masuk open bill, pindah meja, bayar bill", status: "Passed with Notes" },
  { module: "POS KDS", area: "Pending/open bill masuk KDS, station flow", status: "Passed with Notes" },
  { module: "Table Ordering", area: "Customer scan QR table, pilih menu, varian, cart, payment option, order status", status: "Passed with Notes" },
  { module: "Photobooth POS", area: "Self-service UI draft", status: "Prototype Ready" },
  { module: "Purchasing Master Data", area: "Supplier, raw material, price list, products", status: "Passed with Notes" },
  { module: "Purchase Order", area: "Create PO, PO dari shortage production, link ke barang masuk", status: "Passed with Notes" },
  { module: "Barang Masuk", area: "Delivery + receiving workspace, input penerimaan, status penerimaan", status: "Passed with Notes" },
  { module: "Recipe/BOM", area: "BOM product/WIP, UX relocation ke Recipe/BOM", status: "Passed with Notes" },
  { module: "Production Order", area: "Material requirement, shortage, create PO, recheck stock", status: "Passed with Notes" },
];

const scenarios: Scenario[] = [
  { id: "QA-CRM-001", module: "CRM", scenario: "Buka dashboard CRM", actual: "Dashboard tampil", status: "Passed with Notes", notes: "Data masih dummy/test" },
  { id: "QA-CRM-002", module: "CRM", scenario: "Buka list member", actual: "List member tampil", status: "Passed with Notes", notes: "Detail member sudah dipindah ke page sendiri" },
  { id: "QA-CRM-003", module: "CRM", scenario: "Buka rewards dan avatars", actual: "Rewards dan avatar list tampil", status: "Passed with Notes", notes: "Perlu redemption dan ownership avatar lanjutan" },
  { id: "QA-POS-001", module: "POS F&B", scenario: "Buka POS cashier", actual: "POS cashier tampil", status: "Passed with Notes", notes: "UI sudah beberapa kali dirapikan" },
  { id: "QA-POS-002", module: "POS F&B", scenario: "Dine-in table selector", actual: "Modal pilih meja tampil", status: "Passed with Notes", notes: "Data meja diarahkan ke real table" },
  { id: "QA-POS-003", module: "POS F&B", scenario: "Cari produk autocomplete", actual: "Flow dibuat", status: "Passed with Notes", notes: "Enter membuka varian atau masuk cart" },
  { id: "QA-POS-004", module: "POS F&B", scenario: "Tambah customer/member baru", actual: "Flow dibuat", status: "Passed with Notes", notes: "Terhubung ke CRM concept" },
  { id: "QA-OB-001", module: "Open Bills", scenario: "Order meja masuk open bill", actual: "Muncul", status: "Passed with Notes", notes: "Sudah QA end-to-end" },
  { id: "QA-OB-002", module: "Open Bills", scenario: "Pindah meja dan bayar bill", actual: "Berjalan", status: "Passed with Notes", notes: "Perlu audit history nanti" },
  { id: "QA-KDS-001", module: "KDS", scenario: "Pending order masuk KDS", actual: "Gap ditemukan lalu diperbaiki", status: "Passed with Notes", notes: "Flow kitchen/bar station perlu QA lanjutan" },
  { id: "QA-TBL-001", module: "Table Ordering", scenario: "Buka QR table order T-01", actual: "Tampil", status: "Passed with Notes", notes: "Dine-in otomatis dari table ID" },
  { id: "QA-TBL-002", module: "Table Ordering", scenario: "Add to cart dengan varian", actual: "Modal varian tampil", status: "Passed with Notes", notes: "Flow dibuat lebih sederhana" },
  { id: "QA-TBL-003", module: "Table Ordering", scenario: "Submit order dan order lagi", actual: "Berjalan", status: "Passed with Notes", notes: "Perlu regression multi-order" },
  { id: "QA-PUR-MD-001", module: "Purchasing Master Data", scenario: "Supplier CRUD", actual: "Distabilkan", status: "Passed with Notes", notes: "Data test boleh berubah" },
  { id: "QA-PUR-MD-002", module: "Purchasing Master Data", scenario: "Raw material dan price list", actual: "Distabilkan", status: "Passed with Notes", notes: "Ditambahkan sample raw material" },
  { id: "QA-PO-001", module: "Purchase Order", scenario: "Create PO dari production shortage", actual: "Berjalan", status: "Passed with Notes", notes: "Current flow PO dulu, PR menyusul" },
  { id: "QA-GRN-001", module: "Barang Masuk", scenario: "Workspace Barang Masuk", actual: "Delivery dan penerimaan satu workspace", status: "Passed with Notes", notes: "Menu diganti menjadi Barang Masuk" },
  { id: "QA-GRN-002", module: "Barang Masuk", scenario: "Input penerimaan dan action colors", actual: "Diperbaiki", status: "Passed with Notes", notes: "Nested button error diperbaiki" },
  { id: "QA-BOM-001", module: "Recipe/BOM", scenario: "Add BOM item", actual: "Error 400 ditemukan lalu diperbaiki", status: "Passed with Notes", notes: "UX dipindah ke area lebih proper" },
  { id: "QA-BOM-002", module: "Recipe/BOM", scenario: "BOM untuk WIP", actual: "Didukung secara konsep/schema", status: "Passed with Notes", notes: "Perlu QA produksi WIP end-to-end" },
  { id: "QA-PROD-001", module: "Production Order", scenario: "Production detail shortage", actual: "Material shortage tampil", status: "Passed with Notes", notes: "QA order PROD-202605-0004" },
  { id: "QA-PROD-002", module: "Production Order", scenario: "Create PO dari shortage", actual: "Redirect ke PO", status: "Passed with Notes", notes: "Item shortage terbawa di query" },
  { id: "QA-PROD-003", module: "Production Order", scenario: "Recheck stock", actual: "Berhasil", status: "Passed with Notes", notes: "Muncul pesan masih ada 3 bahan kurang" },
  { id: "QA-PROD-004", module: "Production Order", scenario: "Complete production backend", actual: "Logic backend tersedia", status: "Not Tested", notes: "Perlu UI complete dan QA end-to-end" },
];

const issues: Issue[] = [
  { id: "BUG-001", severity: "High", module: "KDS/POS", issue: "Order pending dari Simpan/Buka bill tidak muncul di KDS", resolution: "Flow pending/open bill dihubungkan ke KDS" },
  { id: "BUG-002", severity: "High", module: "Production BOM", issue: "Add BOM gagal dengan response 400 Validasi gagal", resolution: "API/UX BOM diperbaiki dan konsep dipindah ke Recipe/BOM" },
  { id: "BUG-003", severity: "Medium", module: "Production DB View", issue: "Migration gagal karena rename kolom view", resolution: "Migration disesuaikan dan berhasil diterapkan" },
  { id: "BUG-004", severity: "Medium", module: "Barang Masuk", issue: "Nested button menyebabkan hydration error", resolution: "Trigger popover/dropdown diperbaiki" },
  { id: "BUG-005", severity: "Medium", module: "Barang Masuk", issue: "Warna tombol action tetap pink semua", resolution: "Button action dibuat custom color sesuai action" },
  { id: "BUG-006", severity: "Low", module: "Barang Masuk", issue: "Istilah GRN kurang umum untuk user", resolution: "UI diganti ke Penerimaan/Barang Masuk" },
  { id: "BUG-007", severity: "Low", module: "Global UI", issue: "Clickable element kurang terasa bisa diklik", resolution: "Global cursor pointer ditambahkan untuk action elements" },
  { id: "BUG-008", severity: "Medium", module: "POS Cashier", issue: "Table modal terlalu sempit dan kurang jelas", resolution: "Modal/card table beberapa kali disesuaikan" },
  { id: "BUG-009", severity: "Medium", module: "POS Product Search", issue: "Search produk belum autocomplete dan enter behavior belum jelas", resolution: "Autocomplete dan enter behavior ditambahkan" },
];

const gaps: Gap[] = [
  { id: "GAP-001", area: "Production", gap: "Production complete end-to-end dari UI belum dites", priority: "High", recommendation: "Buat Production Complete UI lalu QA end-to-end" },
  { id: "GAP-002", area: "Production", gap: "Actual material consumption dan waste/susut belum tersedia di UI", priority: "High", recommendation: "Masukkan field actual consumption dan waste pada complete production" },
  { id: "GAP-003", area: "Inventory", gap: "Inventory stock card per raw material/WIP/product belum ada", priority: "High", recommendation: "Buat halaman kartu stok dengan saldo dan movement history" },
  { id: "GAP-004", area: "WIP", gap: "WIP production end-to-end belum dites", priority: "High", recommendation: "QA produksi WIP sampai dipakai sebagai BOM produk final" },
  { id: "GAP-005", area: "Purchase Order", gap: "Multi-supplier PO dari shortage belum ada", priority: "Medium", recommendation: "Group shortage by supplier dan generate beberapa PO jika perlu" },
  { id: "GAP-006", area: "Payment", gap: "Payment real QRIS/VA/Ark Coin belum diverifikasi", priority: "High", recommendation: "Lakukan integrasi dan QA payment end-to-end" },
  { id: "GAP-007", area: "Permission", gap: "Permission matrix per role belum dites formal", priority: "Medium", recommendation: "Buat checklist akses per role dan jalankan regression" },
  { id: "GAP-008", area: "Printing", gap: "Print kitchen/bar dan printer queue belum dites production-like", priority: "Medium", recommendation: "QA printer queue dengan sample station kitchen/bar" },
];

const recommendations = [
  "Buat Production Complete UI",
  "Tambahkan Production Movement History",
  "Buat Inventory Stock Card",
  "QA WIP end-to-end",
  "Lakukan QA regression formal Purchasing + Production",
];

const statusStyles = {
  "Passed with Notes": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Prototype Ready": "border-sky-200 bg-sky-50 text-sky-700",
  "Not Tested": "border-amber-200 bg-amber-50 text-amber-700",
};

const severityStyles = {
  High: "border-red-200 bg-red-50 text-red-700",
  Medium: "border-amber-200 bg-amber-50 text-amber-700",
  Low: "border-slate-200 bg-slate-50 text-slate-700",
};

const priorityStyles = {
  High: "border-red-200 bg-red-50 text-red-700",
  Medium: "border-amber-200 bg-amber-50 text-amber-700",
};

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: typeof ClipboardCheck;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-pink-200 bg-white px-3 py-1 text-xs font-semibold uppercase text-pink-700 shadow-sm">
          <Icon className="size-3.5" />
          {eyebrow}
        </div>
        <h2 className="text-2xl font-semibold text-slate-950 md:text-3xl">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">{description}</p>
      </div>
    </div>
  );
}

export default function QaReportPage() {
  const passedWithNotes = moduleSummary.filter((item) => item.status === "Passed with Notes").length;
  const notTested = scenarios.filter((item) => item.status === "Not Tested").length;
  const highGaps = gaps.filter((item) => item.priority === "High").length;
  const highIssues = issues.filter((item) => item.severity === "High").length;

  return (
    <main className="min-h-screen bg-[#f4f6fe] text-slate-950">
      <section className="relative overflow-hidden border-b border-pink-100 bg-[#f2f6fe]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(219,39,119,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(219,39,119,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 lg:grid-cols-[1fr_380px] lg:py-12">
          <div className="flex flex-col justify-between gap-8">
            <nav className="flex items-center justify-between">
              <Link href="/arkiv-os" className="inline-flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm">
                  <Image src="/brand/nuhabit-icon-180.png" alt="NüHabit" width={30} height={30} className="h-8 w-auto object-contain" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-slate-950">BCD Coffee OS</span>
                  <span className="text-xs font-medium text-slate-500">Quality Assurance Report</span>
                </span>
              </Link>
              <Link
                href="/dashboard/purchasing/grn"
                className="hidden h-10 items-center gap-2 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm shadow-pink-500/20 transition hover:bg-pink-700 sm:inline-flex"
              >
                Buka Barang Masuk
                <ArrowRight className="size-4" />
              </Link>
            </nav>

            <div className="max-w-4xl">
              <Badge className="border-pink-200 bg-white text-pink-700">Progress QA berjalan · 24 Mei 2026</Badge>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-tight text-slate-950 md:text-6xl">
                QA progress dashboard untuk BCD Coffee OS development
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 md:text-lg">
                Ringkasan testing yang sudah dilakukan selama development CRM, POS, Purchasing, Barang Masuk, Recipe/BOM, dan Production Order.
                Halaman ini dibuat sebagai template presentasi sementara untuk review progress.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Module Covered", value: moduleSummary.length, icon: Layers3, tone: "text-pink-700 bg-pink-100" },
                { label: "Passed with Notes", value: passedWithNotes, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-100" },
                { label: "Issues Resolved", value: issues.length, icon: ShieldCheck, tone: "text-sky-700 bg-sky-100" },
                { label: "High Priority Gaps", value: highGaps, icon: AlertTriangle, tone: "text-red-700 bg-red-100" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                  <div className={`mb-4 flex size-10 items-center justify-center rounded-lg ${item.tone}`}>
                    <item.icon className="size-5" />
                  </div>
                  <div className="text-3xl font-semibold text-slate-950">{item.value}</div>
                  <div className="mt-1 text-sm font-medium text-slate-500">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-white/80 bg-white/80 p-5 shadow-xl shadow-pink-200/40 backdrop-blur">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-pink-600 text-white">
                <FileSpreadsheet className="size-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">QA Snapshot</h2>
                <p className="text-sm text-slate-500">Local development · main</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                ["Overall status", "Passed with Notes"],
                ["Prototype area", "Photobooth POS"],
                ["Backend verified", "Production recheck stock"],
                ["Current risk", `${notTested} scenario not tested`],
                ["High issue found", `${highIssues} resolved`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                  <span className="text-sm text-slate-500">{label}</span>
                  <span className="text-right text-sm font-semibold text-slate-900">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-pink-100 bg-pink-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-pink-700">
                <Sparkles className="size-4" />
                Presentation Notes
              </div>
              <p className="text-sm leading-6 text-slate-600">
                Struktur halaman ini bisa langsung dipecah menjadi slide: coverage, scenario, issues resolved, QA gaps, dan recommended next phase.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <SectionHeader
          icon={BarChart3}
          eyebrow="Coverage"
          title="Module QA Coverage"
          description="Area yang sudah disentuh selama development dan status testing sementara berdasarkan QA lokal."
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {moduleSummary.map((item) => (
            <article key={item.module} className="rounded-xl border border-pink-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-950">{item.module}</h3>
                <Badge className={statusStyles[item.status]}>{item.status}</Badge>
              </div>
              <p className="text-sm leading-6 text-slate-600">{item.area}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <SectionHeader
          icon={TestTube2}
          eyebrow="Scenarios"
          title="Detailed Test Scenarios"
          description="Daftar scenario utama yang sudah dicoba, termasuk area yang masih perlu QA formal berikutnya."
        />
        <div className="overflow-hidden rounded-xl border border-pink-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-pink-50 text-xs uppercase text-pink-800">
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Module</th>
                  <th className="px-4 py-3 font-semibold">Scenario</th>
                  <th className="px-4 py-3 font-semibold">Actual Result</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scenarios.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-pink-50/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-pink-700">{item.id}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.module}</td>
                    <td className="px-4 py-3 text-slate-700">{item.scenario}</td>
                    <td className="px-4 py-3 text-slate-600">{item.actual}</td>
                    <td className="px-4 py-3">
                      <Badge className={statusStyles[item.status]}>{item.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{item.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-8 md:px-8 lg:grid-cols-[1fr_420px]">
        <div>
          <SectionHeader
            icon={ShieldCheck}
            eyebrow="Resolved"
            title="Issues Found & Resolved"
            description="Bug dan UX issue yang ditemukan selama QA, lalu sudah ditangani selama proses development."
          />
          <div className="space-y-3">
            {issues.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-500">{item.id}</span>
                  <Badge className={severityStyles[item.severity]}>{item.severity}</Badge>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{item.module}</span>
                </div>
                <h3 className="font-semibold text-slate-950">{item.issue}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.resolution}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="lg:pt-[92px]">
          <div className="sticky top-6 rounded-2xl border border-pink-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-pink-100 text-pink-700">
                <Database className="size-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-950">Backend & Database Checks</h3>
                <p className="text-sm text-slate-500">Verifikasi yang sudah tercatat</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              {[
                "Production recheck stock mengembalikan pesan shortage",
                "Workspace Barang Masuk menggabungkan delivery dan penerimaan",
                "Table order submit bisa terkirim",
                "Pending/open bill masuk KDS setelah gap diperbaiki",
                "PO dari production shortage membawa item shortage",
                "Production complete backend tersedia, UI end-to-end belum dites",
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <span className="leading-6 text-slate-600">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <SectionHeader
          icon={AlertTriangle}
          eyebrow="Gaps"
          title="Remaining QA Gaps"
          description="Area yang perlu ditutup sebelum modul Purchasing dan Production dianggap stabil untuk release lebih besar."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {gaps.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-slate-500">{item.id}</span>
                <Badge className={priorityStyles[item.priority]}>{item.priority}</Badge>
              </div>
              <h3 className="text-base font-semibold text-slate-950">{item.gap}</h3>
              <p className="mt-2 text-sm text-pink-700">{item.area}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.recommendation}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 pb-12 md:px-8">
        <div className="rounded-2xl border border-pink-100 bg-slate-950 p-6 text-white shadow-xl shadow-pink-200/40 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_520px]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase text-pink-100">
                <ClipboardCheck className="size-3.5" />
                Recommended Next Phase
              </div>
              <h2 className="text-3xl font-semibold">Prioritas QA dan development berikutnya</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Urutan ini menjaga flow utama tetap rapi: produksi diselesaikan dulu, stok bisa diaudit, baru masuk WIP dan regression formal.
              </p>
            </div>
            <div className="space-y-3">
              {recommendations.map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/10 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pink-500 text-sm font-bold">{index + 1}</span>
                  <span className="font-semibold text-white">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
