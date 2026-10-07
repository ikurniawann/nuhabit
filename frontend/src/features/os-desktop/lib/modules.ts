import type { ComponentType } from "react";
import {
  BriefcaseBusiness,
  Building2,
  Boxes,
  CalendarDays,
  Dumbbell,
  Folder,
  LayoutDashboard,
  MessageSquareMore,
  PieChart,
  Plug,
  Settings,
  ShoppingCart,
  Ticket,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { OS_PATH } from "@/lib/desktop/deep-link";

/** Login lalu kembali ke desktop. */
export const OS_LOGIN_HREF = `/login?redirect=${OS_PATH}`;

/** Modul dashboard yang bisa dibuka dari Launchpad / Spotlight. */
export type DesktopModule = {
  name: string;
  subtitle: string;
  description: string;
  loginHref: string;
  dashboardHref: string;
  icon: ComponentType<{ className?: string }>;
};

export const DESKTOP_MODULES: DesktopModule[] = [
  {
    name: "Beranda",
    subtitle: "Dashboard Utama",
    description: "Ringkasan omzet, tim, stok, dan keputusan yang menunggu dalam tampilan dashboard klasik.",
    loginHref: "/login?redirect=/dashboard&module=dashboard",
    dashboardHref: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Gym & Kelas",
    subtitle: "HYROX & Membership",
    description: "Jadwal kelas, booking, check-in member, paket kredit, coach, dan latihan HYROX.",
    loginHref: "/login?redirect=/dashboard/gym/schedule&module=gym",
    dashboardHref: "/dashboard/gym/schedule",
    icon: Dumbbell,
  },
  {
    name: "Area Karyawan",
    subtitle: "Self Service",
    description: "Absensi, pengajuan cuti, lembur, slip gaji, dan data pribadi karyawan.",
    loginHref: "/login?redirect=/dashboard/me&module=ess",
    dashboardHref: "/dashboard/me",
    icon: CalendarDays,
  },
  {
    name: "HRIS",
    subtitle: "Human Resources",
    description: "Talent pool, employee lifecycle, attendance, payroll, KPI, dan performance review.",
    loginHref: "/login?redirect=/dashboard/hris&module=hris",
    dashboardHref: "/dashboard/hris",
    icon: UsersRound,
  },
  {
    name: "Items",
    subtitle: "Bahan Baku & Produk",
    description: "Bahan baku, produk jadi, BOM, stok, gudang, produksi internal, dan laporan persediaan.",
    loginHref: "/login?redirect=/dashboard/items&module=items",
    dashboardHref: "/dashboard/items",
    icon: Boxes,
  },
  {
    name: "Procurement",
    subtitle: "Purchasing Control",
    description: "PR, PO, suppliers, GRN, QC, return, stock control, dan purchasing analytics.",
    loginHref: "/login?redirect=/dashboard/purchasing&module=purchasing",
    dashboardHref: "/dashboard/purchasing",
    icon: BriefcaseBusiness,
  },
  {
    name: "Accounting",
    subtitle: "Finance & Ledger",
    description: "Jurnal, buku besar, hutang & piutang, kas/bank, periode fiskal, dan laporan keuangan.",
    loginHref: "/login?redirect=/dashboard/accounting/reports&module=accounting",
    dashboardHref: "/dashboard/accounting/reports",
    icon: WalletCards,
  },
  {
    name: "POS",
    subtitle: "Point of Sales",
    description: "Cashier, order, reservation, customer, product, dan outlet sales operation.",
    loginHref: "/login?redirect=/dashboard/pos&module=pos",
    dashboardHref: "/dashboard/pos",
    icon: ShoppingCart,
  },
  {
    name: "CRM",
    subtitle: "Membership & Loyalty",
    description: "Customer profile, membership tier, XP, reward, avatar collectible, dan loyalty analytics.",
    loginHref: "/login?redirect=/dashboard/crm&module=crm",
    dashboardHref: "/dashboard/crm",
    icon: MessageSquareMore,
  },
  {
    name: "Sales Funneling",
    subtitle: "Pipeline B2B",
    description: "Leads, deals, aktivitas, quotation, invoice, dan analitik pipeline penjualan korporat.",
    loginHref: "/login?redirect=/dashboard/sales-funnel/leads&module=sales-funnel",
    dashboardHref: "/dashboard/sales-funnel/leads",
    icon: PieChart,
  },
  {
    name: "Ticketing",
    subtitle: "Tiket & Kunjungan",
    description: "Master tiket, booking, loket, gate, gelang NFC, season pass, dan tab kunjungan.",
    loginHref: "/login?redirect=/dashboard/ticketing/tickets&module=ticketing",
    dashboardHref: "/dashboard/ticketing/tickets",
    icon: Ticket,
  },
  {
    name: "Dataroom",
    subtitle: "Berkas & Berbagi",
    description: "Folder, subfolder, unggah berkas, berbagi publik atau per email dengan PIN dan watermark.",
    loginHref: "/login?redirect=/dashboard/dataroom&module=dataroom",
    dashboardHref: "/dashboard/dataroom",
    icon: Folder,
  },
  {
    name: "Resort",
    subtitle: "Akomodasi & Front Office",
    description: "Reservasi kamar, ketersediaan, check-in/check-out, folio tamu, dan status housekeeping.",
    loginHref: "/login?redirect=/dashboard/resort/reservations&module=resort",
    dashboardHref: "/dashboard/resort/reservations",
    icon: Building2,
  },
  {
    name: "Integration",
    subtitle: "Settings Center",
    description: "Konfigurasi integrasi Game, Photobox, Payment Gateway, API, webhook, dan automation.",
    loginHref: "/login?redirect=/dashboard/settings/integrations&module=integration",
    dashboardHref: "/dashboard/settings/integrations",
    icon: Plug,
  },
  {
    name: "Settings",
    subtitle: "Konfigurasi Sistem",
    description: "Perusahaan, cabang, outlet, pengguna, peran & hak akses IAM, dan preferensi sistem.",
    loginHref: "/login?redirect=/dashboard/settings/business&module=settings",
    dashboardHref: "/dashboard/settings/business",
    icon: Settings,
  },
];

/** Modul "Integration" tampil sebagai panel native, bukan iframe dashboard. */
export const NATIVE_INTEGRATION_MODULE = "Integration";

/** Tamu diarahkan ke login dulu; yang sudah masuk langsung ke dashboard modul. */
export function moduleHref(module: DesktopModule, isLoggedIn: boolean): string {
  return isLoggedIn ? module.dashboardHref : module.loginHref;
}

export function filterModules(modules: DesktopModule[], query: string): DesktopModule[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return modules;
  return modules.filter((module) => `${module.name} ${module.subtitle}`.toLowerCase().includes(normalized));
}
