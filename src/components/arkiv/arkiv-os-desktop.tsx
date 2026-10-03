"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { extractSseData, splitSseEvents } from "@/lib/assistant/sse";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  DesktopMonitorBoard,
  MONITOR_WIDGETS,
  NotificationPopups,
  normalizeWidgetOrder,
  useDesktopOverview,
  usePeriodPreference,
  type MonitorWidgetKey,
} from "./desktop-monitor";
import type { DesktopOverview as DesktopOverviewData } from "@/lib/desktop/overview";
import {
  BUILTIN_WALLPAPERS,
  WALLPAPER_STORAGE_KEY,
  wallpaperBackgroundStyle,
  type WallpaperItem,
} from "@/lib/desktop/wallpapers";
import { brandName, brandOsName } from "@/lib/branding";
import { REPORT_EXPORTS, type ReportExportKey } from "@/lib/pos/report-excel/builders";
import { DriveDataroomBrowser } from "@/features/dataroom/components/drive-browser";
import type { DataroomItem, DataroomListing } from "@/features/dataroom/types";
import { apiGet } from "@/lib/api-client";
import {
  REPORT_PERIOD_LABELS,
  REPORT_PERIOD_SHORTCUTS,
  resolveReportPeriod,
  validateReportRange,
  type ReportPeriodShortcut,
} from "@/lib/pos/report-period";
import { WaNotifSettingsPanel } from "./wa-notif-settings";
import {
  MAX_NOTIFICATION_HISTORY,
  diffOverviewNotifications,
  type ActivityNotification,
} from "@/lib/desktop/notifications";
import type { ComponentType, CSSProperties, FormEvent as ReactFormEvent, MouseEvent as ReactMouseEvent } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSearchable } from "@/lib/desktop/search";
import { statusLabel, type StatusItem, type StatusLevel } from "@/lib/desktop/status";
import type { InboxSection } from "@/lib/desktop/inbox";
import { parseDeepLink } from "@/lib/desktop/deep-link";
import {
  normalizeDesktopPreferences,
  writeLocalPreferences,
  type DesktopPreferences,
} from "@/lib/desktop/preferences";
import {
  MENUBAR_H,
  MIN_WINDOW_H,
  MIN_WINDOW_W,
  SHORTCUT_HINTS,
  WINDOW_GEOMETRY_STORAGE_KEY,
  clampGeometry,
  detectSnapEdge,
  matchDesktopShortcut,
  nextWindowInCycle,
  parseGeometryMap,
  rememberGeometry,
  restoreGeometry,
  snapGeometry,
  type GeometryMap,
  type SnapEdge,
  type WindowGeometry,
} from "@/lib/desktop/window-manager";
import {
  Activity,
  AlertCircle,
  Bell,
  Bot,
  Boxes,
  Dumbbell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  Command,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  Gamepad2,
  GripVertical,
  Grid3X3,
  History,
  Landmark,
  LayoutDashboard,
  Plus,
  Loader2,
  Lock,
  LogIn,
  Plug,
  MessageSquareMore,
  MonitorDot,
  Paperclip,
  Pencil,
  PieChart,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Scale,
  Ticket,
  Trash2,
  Volume2,
  WalletCards,
  VolumeX,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import {
  AI_ASSISTANT_MODELS,
  AI_ASSISTANT_SCOPES,
  AI_ASSISTANT_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_ASSISTANT_SETTINGS,
  type AiAssistantSettings,
  resolveAiAssistantModel,
  resolveAiAssistantScope,
} from "@/lib/ai-assistant-config";

type OsUserAccount = {
  email: string;
  fullName: string;
  role: string;
};

type DesktopModule = {
  name: string;
  subtitle: string;
  description: string;
  loginHref: string;
  dashboardHref: string;
  externalHref?: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
};

type DesktopIconPosition = { left: number; top: number };
type WidgetVisibility = { calendar: boolean } & Record<MonitorWidgetKey, boolean>;

const brandTile = "bg-accent text-accent-foreground";
// Merek instance (multi-perusahaan) — jangan tulis nama langsung di JSX.
const BRAND = brandName();
const BRAND_OS = brandOsName();

const modules: DesktopModule[] = [
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

type SearchGroup = { source: string; label: string; items: Array<{ id: string; title: string; subtitle?: string | null; href: string }> };
/** Jendela yang dibuka dari deep link / hasil Spotlight (bisa banyak sekaligus). */
type PathWindow = { id: string; title: string; path: string };

/**
 * Wallpaper bawaan; unggahan admin ditambahkan dari /api/desktop/wallpapers.
 * Daftarnya ada di @/lib/desktop/wallpapers supaya halaman login memakai
 * sumber yang sama — pilihan di desktop langsung ikut dipakai di login.
 */
const wallpapers = BUILTIN_WALLPAPERS;

const defaultWidgetVisibility: WidgetVisibility = {
  calendar: false,
  omzet: true,
  promo: true,
  tamu: true,
  pulsa: true,
  tim: true,
  keputusan: true,
  stok: true,
  member: true,
};

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short" }).format(date);
}

export default function ArkivOsDesktop() {
  const router = useRouter();
  const desktopRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [previewModule, setPreviewModule] = useState<DesktopModule | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showWaNotif, setShowWaNotif] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showApplicationFolder, setShowApplicationFolder] = useState(false);
  const [comingSoonApp, setComingSoonApp] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [userAccount, setUserAccount] = useState<OsUserAccount | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [openAppModule, setOpenAppModule] = useState<DesktopModule | null>(null);
  const [moduleOpenChoice, setModuleOpenChoice] = useState<DesktopModule | null>(null);
  const [showAssistantShortcut, setShowAssistantShortcut] = useState(false);
  const [assistantShortcutInput, setAssistantShortcutInput] = useState("");
  const [queuedAssistantPrompt, setQueuedAssistantPrompt] = useState<string | null>(null);
  const [assistantShortcutFocused, setAssistantShortcutFocused] = useState(false);
  const [wallpaper, setWallpaper] = useState<WallpaperItem>(wallpapers[0]);
  const [customWallpapers, setCustomWallpapers] = useState<WallpaperItem[]>([]);
  const allWallpapers = useMemo(() => [...wallpapers, ...customWallpapers], [customWallpapers]);
  const [widgetVisibility, setWidgetVisibility] = useState<WidgetVisibility>(defaultWidgetVisibility);
  const [widgetOrder, setWidgetOrder] = useState<MonitorWidgetKey[]>(() => normalizeWidgetOrder(null));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [assistantSettings, setAssistantSettings] = useState<AiAssistantSettings>(DEFAULT_AI_ASSISTANT_SETTINGS);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; module?: DesktopModule; desktop?: boolean } | null>(null);
  const [locked, setLocked] = useState(false);
  const [showToday, setShowToday] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [pathWindows, setPathWindows] = useState<PathWindow[]>([]);
  const assistantShortcutRef = useRef<HTMLFormElement>(null);
  const assistantShortcutInputRef = useRef<HTMLInputElement>(null);

  const motionStyle = {
    "--mouse-x": "50%",
    "--mouse-y": "50%",
    "--float-x": "0px",
    "--float-y": "0px",
    "--float-x-reverse": "0px",
    "--float-y-reverse": "0px",
    "--float-x-panel": "0px",
    "--float-y-panel": "0px",
    "--float-x-note": "0px",
    "--float-y-note": "0px",
  } as CSSProperties;

  const isLoggedIn = Boolean(userAccount);
  const [periode, pilihPeriode] = usePeriodPreference();
  const overview = useDesktopOverview(isLoggedIn, periode);
  // Notifikasi aktivitas: snapshot overview dibandingkan tiap poll; kenaikan
  // melahirkan popup + masuk riwayat Notification Center.
  const [notifHistory, setNotifHistory] = useState<ActivityNotification[]>([]);
  const [notifPopups, setNotifPopups] = useState<ActivityNotification[]>([]);
  const prevOverviewRef = useRef<DesktopOverviewData | null>(null);
  useEffect(() => {
    if (!overview.data) return;
    const fresh = diffOverviewNotifications(prevOverviewRef.current, overview.data);
    prevOverviewRef.current = overview.data;
    if (fresh.length === 0) return;
    setNotifHistory((prev) => [...fresh, ...prev].slice(0, MAX_NOTIFICATION_HISTORY));
    setNotifPopups((prev) => [...prev, ...fresh]);
  }, [overview.data]);
  /* Notifikasi LANGSUNG lewat Server-Sent Events. Polling 60 detik tetap
   * jalan sebagai jaring pengaman bila SSE diputus proxy. */
  useEffect(() => {
    if (!isLoggedIn) return;
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/desktop/stream");
    } catch {
      return;
    }
    const onOverview = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { overview: DesktopOverviewData };
        if (!payload?.overview) return;
        const fresh = diffOverviewNotifications(prevOverviewRef.current, payload.overview);
        prevOverviewRef.current = payload.overview;
        if (fresh.length === 0) return;
        setNotifHistory((prev) => [...fresh, ...prev].slice(0, MAX_NOTIFICATION_HISTORY));
        setNotifPopups((prev) => [...prev, ...fresh]);
      } catch {
        /* payload rusak — biarkan poll berikutnya yang mengoreksi */
      }
    };
    source.addEventListener("overview", onOverview);
    return () => {
      source?.removeEventListener("overview", onOverview);
      source?.close();
    };
  }, [isLoggedIn]);

  const dismissPopup = useCallback((id: string) => {
    setNotifPopups((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const openNotification = useCallback((n: ActivityNotification) => {
    setNotifPopups((prev) => prev.filter((item) => item.id !== n.id));
    router.push(n.href);
  }, [router]);
  const askDoFromWidget = useCallback((prompt: string) => {
    setQueuedAssistantPrompt(prompt);
    setShowAssistant(true);
  }, []);

  const filteredModules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return modules;
    return modules.filter((module) => `${module.name} ${module.subtitle}`.toLowerCase().includes(normalized));
  }, [query]);

  const desktopIcons = useMemo(
    () => [
      { id: "assistant", name: "Do", subtitle: "Super User", icon: Bot, action: "assistant" as const },
      { id: "drive", name: `${BRAND} Drive`, subtitle: "Files", icon: Folder, action: "files" as const },
      { id: "Application", name: "Application", subtitle: "All Modules", icon: Grid3X3, action: "folder" as const },
      {
        id: "userManagement",
        name: "User Management",
        subtitle: "Super Admin",
        icon: ShieldCheck,
        action: "route" as const,
        href: "/dashboard/settings/users",
        loginHref: "/login?redirect=/dashboard/settings/users",
      },
    ],
    [],
  );

  const windowManager = useWindowManager();
  const contextMenuRef = useRef<typeof contextMenu>(null);
  const showCommandRef = useRef(false);
  const showTodayRef = useRef(false);
  useEffect(() => {
    contextMenuRef.current = contextMenu;
    showCommandRef.current = showCommand;
    showTodayRef.current = showToday;
  });
  const { windows: openWindows, order: windowOrder } = windowManager.state;
  const openWindowList = useMemo(
    () => windowOrder.map((id) => ({ id, ...openWindows[id] })).filter((w) => w.title),
    [windowOrder, openWindows]
  );

  /** Ikon dock: sudah terbuka → fokuskan (bukan tutup); belum → buka. */
  const focusOrOpen = useCallback(
    (ids: string[], open: () => void) => {
      const hit = ids.find((id) => openWindows[id]);
      if (hit) {
        windowManager.api.focus(hit);
        return;
      }
      open();
    },
    [openWindows, windowManager.api]
  );
  const anyOpen = useCallback((ids: string[]) => ids.some((id) => Boolean(openWindows[id])), [openWindows]);

  /* Pintasan papan ketik ala desktop. Kombinasi yang dirampas browser
   * (⌘W/⌘M/⌘Tab) sengaja dihindari — lihat matchDesktopShortcut. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchDesktopShortcut(event);
      if (!action) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      // Saat mengetik hanya Escape yang boleh lewat.
      if (typing && action !== "dismiss") return;

      const api = windowManager.api;
      const top = windowManager.topWindowId;

      switch (action) {
        case "search":
          event.preventDefault();
          setShowCommand(true);
          return;
        case "today":
          event.preventDefault();
          setShowToday((value) => !value);
          return;
        case "lock":
          event.preventDefault();
          setLocked(true);
          return;
        case "dismiss": {
          // Urutan tutup: panel Hari Ini → menu konteks → palet → jendela.
          if (showTodayRef.current) {
            setShowToday(false);
            return;
          }
          if (contextMenuRef.current) {
            setContextMenu(null);
            return;
          }
          if (showCommandRef.current) {
            setShowCommand(false);
            return;
          }
          if (top) api.closeById(top);
          return;
        }
        case "close-window":
          if (!top) return;
          event.preventDefault();
          api.closeById(top);
          return;
        case "minimize-window":
          if (!top) return;
          event.preventDefault();
          api.setMinimized(top, true);
          return;
        case "cycle-next":
        case "cycle-prev": {
          const next = nextWindowInCycle(
            windowManager.visibleOrder,
            top,
            action === "cycle-next" ? 1 : -1
          );
          if (!next) return;
          event.preventDefault();
          api.focus(next);
          return;
        }
        default:
          if (!top) return;
          event.preventDefault();
          api.send(top, action as "snap-left" | "snap-right" | "maximize" | "restore");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [windowManager.api, windowManager.topWindowId, windowManager.visibleOrder]);

  /**
   * Buka satu halaman dashboard sebagai jendela. Dipakai hasil Spotlight dan
   * deep link (?open=). Id unik per instans → halaman yang sama boleh dibuka
   * dua kali (mis. dua laporan periode berbeda), seperti desktop sungguhan.
   */
  const openPath = useCallback((path: string, title: string) => {
    setPathWindows((prev) => {
      const existing = prev.find((win) => win.path === path);
      if (existing) {
        windowManager.api.focus(existing.id);
        return prev;
      }
      const id = `path:${path}:${prev.length}:${Math.random().toString(36).slice(2, 7)}`;
      return [...prev, { id, title, path }];
    });
  }, [windowManager.api]);

  const closePathWindow = useCallback((id: string) => {
    setPathWindows((prev) => prev.filter((win) => win.id !== id));
  }, []);

  /* Deep link: /arkiv-os?open=/dashboard/... membuka jendelanya langsung,
   * lalu parameter dibersihkan supaya refresh tidak menumpuk jendela. */
  useEffect(() => {
    const target = parseDeepLink(new URLSearchParams(window.location.search));
    if (!target) return;
    // Dibuka pada frame berikutnya: desktop selesai render dulu, baru jendela.
    const frame = requestAnimationFrame(() => {
      openPath(target.path, target.title);
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      url.searchParams.delete("title");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [openPath]);

  const moduleHref = (module: DesktopModule) => module.externalHref ?? (isLoggedIn ? module.dashboardHref : module.loginHref);

  const openModule = (module: DesktopModule) => {
    if (module.disabled) return;
    setModuleOpenChoice(module);
  };

  const openModuleInArkivOs = (module: DesktopModule) => {
    const href = moduleHref(module);
    if (module.externalHref) {
      window.open(href, "_blank", "noopener,noreferrer");
      setModuleOpenChoice(null);
      return;
    }
    setOpenAppModule(module);
    setModuleOpenChoice(null);
  };

  const openModuleInNewTab = (module: DesktopModule) => {
    window.open(moduleHref(module), "_blank", "noopener,noreferrer");
    setModuleOpenChoice(null);
  };

  const openAssistantFromShortcut = useCallback((event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = assistantShortcutInput.trim();
    if (!message) return;

    setQueuedAssistantPrompt(message);
    setShowAssistant(true);
  }, [assistantShortcutInput]);

  const consumeQueuedAssistantPrompt = useCallback(() => {
    setQueuedAssistantPrompt(null);
  }, []);

  const handleMouseMove = (event: ReactMouseEvent<HTMLElement>) => {
    const element = desktopRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const floatX = (xPercent - 50) * 0.42;
    const floatY = (yPercent - 50) * 0.42;

    element.style.setProperty("--mouse-x", `${xPercent}%`);
    element.style.setProperty("--mouse-y", `${yPercent}%`);
    element.style.setProperty("--float-x", `${floatX}px`);
    element.style.setProperty("--float-y", `${floatY}px`);
    element.style.setProperty("--float-x-reverse", `${floatX * -1}px`);
    element.style.setProperty("--float-y-reverse", `${floatY * -1}px`);
    element.style.setProperty("--float-x-panel", `${floatX * 0.35}px`);
    element.style.setProperty("--float-y-panel", `${floatY * 0.35}px`);
    element.style.setProperty("--float-x-note", `${floatX * -0.25}px`);
    element.style.setProperty("--float-y-note", `${floatY * -0.25}px`);
  };

  const resetMouseMotion = () => {
    const element = desktopRef.current;
    if (!element) return;
    ["--float-x", "--float-y", "--float-x-reverse", "--float-y-reverse", "--float-x-panel", "--float-y-panel", "--float-x-note", "--float-y-note"].forEach((key) =>
      element.style.setProperty(key, "0px"),
    );
    element.style.setProperty("--mouse-x", "50%");
    element.style.setProperty("--mouse-y", "50%");
  };

  const updateWidgetVisibility = (key: keyof WidgetVisibility, value: boolean) => {
    const next = { ...widgetVisibility, [key]: value };
    setWidgetVisibility(next);
    window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(next));
  };

  /** Geser widget monitoring satu langkah ke atas/bawah (Fase C). */
  const simpanUrutan = (next: MonitorWidgetKey[]) => {
    setWidgetOrder(next);
    window.localStorage.setItem("arkiv-widget-order", JSON.stringify(next));
  };

  const moveWidget = (key: MonitorWidgetKey, direction: -1 | 1) => {
    const index = widgetOrder.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= widgetOrder.length) return;
    const next = [...widgetOrder];
    [next[index], next[target]] = [next[target], next[index]];
    simpanUrutan(next);
  };

  /** Pindah satu widget ke posisi baru — dipakai drag & drop di panel Widgets. */
  const reorderWidget = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    if (from >= widgetOrder.length || to >= widgetOrder.length) return;
    const next = [...widgetOrder];
    const [dipindah] = next.splice(from, 1);
    next.splice(to, 0, dipindah);
    simpanUrutan(next);
  };

  const updateSoundEnabled = (value: boolean) => {
    setSoundEnabled(value);
    window.localStorage.setItem("arkiv-sound-enabled", String(value));
  };

  const updateAssistantSettings = (next: Partial<AiAssistantSettings>) => {
    const settings = { ...assistantSettings, ...next };
    setAssistantSettings(settings);
    window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  };

  const playClickSound = () => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 520;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.06);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
      window.setTimeout(() => context.close(), 120);
    } catch {
      // ignore unavailable audio context
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      const savedWallpaper = window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
      const savedWidgets = window.localStorage.getItem("arkiv-widget-visibility");
      const savedOrder = window.localStorage.getItem("arkiv-widget-order");
      if (savedOrder) {
        try {
          setWidgetOrder(normalizeWidgetOrder(JSON.parse(savedOrder)));
        } catch {
          window.localStorage.removeItem("arkiv-widget-order");
        }
      }
      const savedSound = window.localStorage.getItem("arkiv-sound-enabled");
      const savedAssistantSettings = window.localStorage.getItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY);
      if (savedWallpaper) setWallpaper(wallpapers.find((item) => item.id === savedWallpaper) ?? wallpapers[0]);
      if (savedWidgets) {
        const parsedWidgets = JSON.parse(savedWidgets);
        const nextWidgets = { ...defaultWidgetVisibility, ...parsedWidgets };
        setWidgetVisibility(nextWidgets);
        window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(nextWidgets));
      } else {
        window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(defaultWidgetVisibility));
      }
      setSoundEnabled(savedSound === "true");
      if (savedAssistantSettings) {
        try {
          const parsed = JSON.parse(savedAssistantSettings) as Partial<AiAssistantSettings>;
          const nextSettings = {
            model: resolveAiAssistantModel(parsed.model),
            scope: resolveAiAssistantScope(parsed.scope),
          };
          setAssistantSettings(nextSettings);
          window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
        } catch {
          window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_ASSISTANT_SETTINGS));
        }
      } else {
        window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_ASSISTANT_SETTINGS));
      }
    }, 0);
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  /* Wallpaper unggahan admin — publik, jadi pengunjung pun melihat pilihan
   * yang sama. Pilihan tersimpan (localStorage) yang menunjuk wallpaper
   * unggahan baru bisa dipulihkan setelah daftar ini datang. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/desktop/wallpapers")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !Array.isArray(json?.data)) return;
        const items: WallpaperItem[] = json.data.map((item: WallpaperItem) => ({ ...item, custom: true }));
        setCustomWallpapers(items);
        const savedWallpaper = window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
        const match = savedWallpaper ? items.find((item) => item.id === savedWallpaper) : null;
        if (match) setWallpaper(match);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Preferensi desktop ikut AKUN. Server jadi sumber kebenaran; localStorage
   * tinggal cache supaya render pertama tidak berkedip saat ganti perangkat. */
  const prefsReadyRef = useRef(false);
  useEffect(() => {
    if (!userAccount) return;
    let cancelled = false;
    fetch("/api/desktop/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        prefsReadyRef.current = true;
        const server = json?.data ? normalizeDesktopPreferences(json.data) : null;
        if (!server) return;
        if (server.wallpaper) {
          const found = allWallpapers.find((item) => item.id === server.wallpaper);
          if (found) setWallpaper(found);
        }
        if (Object.keys(server.widgetVisibility).length > 0) {
          setWidgetVisibility((prev) => ({ ...prev, ...server.widgetVisibility }) as WidgetVisibility);
        }
        if (server.widgetOrder.length > 0) setWidgetOrder(normalizeWidgetOrder(server.widgetOrder));
        setSoundEnabled(server.soundEnabled);
      })
      .catch(() => {
        // Server tak terjangkau: jangan kunci penyimpanan, pakai pilihan lokal.
        prefsReadyRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [userAccount, allWallpapers]);

  useEffect(() => {
    if (!userAccount || !prefsReadyRef.current) return;
    const prefs: DesktopPreferences = {
      wallpaper: wallpaper.id,
      widgetVisibility: widgetVisibility as unknown as Record<string, boolean>,
      widgetOrder,
      soundEnabled,
      period: null,
    };
    writeLocalPreferences(prefs);
    // Ditunda sebentar: menggeser urutan widget tidak boleh jadi badai request.
    const timer = window.setTimeout(() => {
      void fetch("/api/desktop/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }).catch(() => {});
    }, 900);
    return () => window.clearTimeout(timer);
  }, [userAccount, wallpaper, widgetVisibility, widgetOrder, soundEnabled]);

  useEffect(() => {
    const db = createBrowserClient();

    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setUserAccount(null);
        return;
      }

      const { data: profile } = await db
        .from("users")
        .select("full_name, role")
        .eq("id", data.user.id)
        .single();

      setUserAccount({
        email: data.user.email ?? "",
        fullName: profile?.full_name ?? data.user.email ?? `${BRAND} User`,
        role: profile?.role ?? "authenticated",
      });
    });
  }, []);

  useEffect(() => {
    if (!showAssistantShortcut) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (assistantShortcutRef.current?.contains(target)) return;

      setShowAssistantShortcut(false);
      setAssistantShortcutFocused(false);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [showAssistantShortcut]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommand(true);
      }
      const isAssistantShortcut =
        event.metaKey &&
        event.shiftKey &&
        (event.key.toLowerCase() === "a" || event.code === "KeyA");
      if (isAssistantShortcut) {
        event.preventDefault();
        event.stopPropagation();
        setShowAssistantShortcut(true);
        window.requestAnimationFrame(() => assistantShortcutInputRef.current?.focus());
      }
      if (event.key === "Escape") {
        setShowCommand(false);
        setShowLibrary(false);
        setShowNotifications(false);
        setShowAssistantShortcut(false);
        setAssistantShortcutFocused(false);
        setContextMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  return (
    <WindowApiContext.Provider value={windowManager.api}>
    <WindowStateContext.Provider value={windowManager.state}>
    <main
      ref={desktopRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetMouseMotion}
      onClick={() => setContextMenu(null)}
      onClickCapture={playClickSound}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, desktop: true });
      }}
      style={motionStyle}
      className="relative min-h-dvh overflow-hidden bg-ink text-white"
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={wallpaperBackgroundStyle(wallpaper.src)}
      />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-[0.16] transition-transform duration-500 ease-out [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:80px_80px] [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-cyan-300/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x),var(--float-y),0)]" />
      <div className="pointer-events-none absolute -right-24 bottom-16 size-80 rounded-full bg-pink-400/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/10 to-transparent" />

      <header className="fixed inset-x-0 top-0 z-[75] flex h-9 items-center justify-between border-b border-white/10 bg-black/22 px-3 text-[13px] text-white/90 backdrop-blur-2xl">
        <div className="flex h-full items-center gap-5">
          <button
            type="button"
            onClick={() => setShowAccount(true)}
            className="flex items-center gap-2 font-semibold transition hover:text-white"
            title="Account"
          >
            <span className="grid size-5 place-items-center rounded-md bg-white/15 text-[10px] uppercase">
              {userAccount?.email?.charAt(0) || "A"}
            </span>
            {userAccount?.email || "Tamu"}
          </button>
          {!isLoggedIn && (
            <span className="hidden items-center gap-2 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-100 sm:flex">
              Mode tamu — sebagian aplikasi perlu masuk
              <button
                type="button"
                onClick={() => router.push("/login?redirect=/arkiv-os")}
                className="rounded-full bg-amber-300/90 px-2 py-0.5 text-[11px] font-bold text-amber-950 transition hover:bg-amber-200"
              >
                Masuk
              </button>
            </span>
          )}
          <nav className="hidden items-center gap-4 text-white/72 md:flex">
            <button onClick={() => setShowLibrary(true)}>Applications</button>
            {notifHistory.length > 0 && <button onClick={() => setShowNotifications(true)}>Notifications</button>}
            <button onClick={() => setShowWidgetSettings(true)}>Widgets</button>
            <button onClick={() => setShowCommand(true)}>Search</button>
            {isLoggedIn && <button onClick={() => setShowToday(true)}>Hari Ini</button>}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-white/75">
          <button className="hidden items-center gap-1 rounded-full bg-white/10 px-2 py-1 sm:flex" onClick={() => setShowCommand(true)}>
            <Command className="size-3" /> K
          </button>
          <button type="button" onClick={() => setShowCommand(true)} className="rounded-full p-1 transition hover:bg-white/10" aria-label="Open Spotlight Search" title="Search">
            <Search className="size-4" />
          </button>
          {isLoggedIn && <SystemStatusChip onOpenToday={() => setShowToday(true)} />}
          <Wifi className="size-4" />
          <Cloud className="size-4" />
          <span className="hidden sm:inline">{now ? formatDate(now) : "--"}</span>
          <span>{now ? formatTime(now) : "--:--"}</span>
        </div>
      </header>

      <section className="relative z-10 min-h-dvh px-6 pb-28 pt-14">
        {now && widgetVisibility.calendar && <CalendarWidget date={now} onClose={() => updateWidgetVisibility("calendar", false)} />}
        {isLoggedIn && (
          <DesktopMonitorBoard
            state={overview}
            visibility={widgetVisibility}
            order={widgetOrder}
            onAskDo={askDoFromWidget}
          onOpenInbox={() => setShowToday(true)}
            periode={periode}
            onPilihPeriode={pilihPeriode}
          />
        )}
      </section>

      <nav
        aria-label="Dock"
        className="fixed bottom-3 left-1/2 z-[75] flex max-w-[calc(100vw-12px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[22px] border border-white/10 bg-ink/75 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_24px_60px_rgba(0,0,0,.5)] backdrop-blur-2xl sm:bottom-5 sm:gap-1.5 sm:overflow-visible sm:rounded-[26px] sm:p-2"
      >
        {/* Tombol merek = Launchpad; dulu ada ikon "Apps" terpisah yang membuka panel yang sama. */}
        <button
          type="button"
          aria-label="Applications"
          title="Applications"
          aria-pressed={showLibrary}
          onClick={() => setShowLibrary((value) => !value)}
          className={`group relative grid size-10 shrink-0 place-items-center rounded-xl bg-forest shadow-lg ring-1 transition duration-200 hover:-translate-y-1 sm:size-12 sm:rounded-2xl ${showLibrary ? "ring-accent" : "ring-white/10 hover:ring-accent/60"}`}
        >
          <Image src="/brand/mark-lime.png" alt="" width={28} height={28} className="w-6 transition group-hover:scale-110 sm:w-7" />
          <DockTooltip label="Applications" />
        </button>
        {/* Pintasan per-modul sengaja TIDAK ada di dock: daftar lengkapnya
            sudah di Launchpad / folder Applications, dan 14 ikon membuat dock
            penuh. Jendela yang sedang terbuka tetap muncul sebagai chip di
            ujung dock supaya bisa diraih meski tertimbun. */}
        <DockButton label="Do" icon={Bot} active={showAssistant} running={anyOpen(["Do"])} onClick={() => focusOrOpen(["Do"], () => setShowAssistant(true))} />
        <div className="mx-0.5 h-6 w-px shrink-0 bg-white/12 sm:mx-1 sm:h-8" />
        {notifHistory.length > 0 && (
          <DockButton label={`Notifications (${notifHistory.length})`} icon={Bell} active={showNotifications} onClick={() => setShowNotifications((value) => !value)} />
        )}
        <DockButton label="Files" icon={Folder} active={showFiles} running={anyOpen([`${BRAND} Drive`])} onClick={() => focusOrOpen([`${BRAND} Drive`], () => setShowFiles(true))} />
        <DockButton label="Settings" icon={Settings} active={showSettings} running={anyOpen(["System Settings"])} onClick={() => focusOrOpen(["System Settings"], () => setShowSettings(true))} />
        {openWindowList.length > 0 && (
          <>
            <div className="mx-0.5 h-6 w-px shrink-0 bg-white/12 sm:mx-1 sm:h-8" />
            {/* Daftar jendela terbuka (seperti dock macOS): yang dikecilkan
                diredupkan, yang sedang aktif diberi cincin. */}
            {openWindowList.map((win) => {
              const isActive = windowManager.topWindowId === win.id;
              return (
                <button
                  key={win.id}
                  type="button"
                  title={win.minimized ? `Tampilkan ${win.title}` : `Ke ${win.title}`}
                  aria-label={win.minimized ? `Tampilkan ${win.title}` : `Ke ${win.title}`}
                  onClick={() => windowManager.api.focus(win.id)}
                  className={`group relative grid h-10 shrink-0 place-items-center rounded-xl border px-2.5 text-[11px] font-semibold transition duration-200 hover:-translate-y-1 hover:bg-white/12 sm:h-12 sm:rounded-2xl sm:px-3 ${
                    isActive
                      ? "border-accent/45 bg-white/10 text-white"
                      : win.minimized
                        ? "border-white/6 bg-white/[0.03] text-white/50"
                        : "border-white/8 bg-white/[0.06] text-white/85"
                  }`}
                >
                  <span className="max-w-[92px] truncate">{win.title}</span>
                  {!win.minimized && (
                    <span className={`absolute -bottom-1 h-1 rounded-full transition-all ${isActive ? "w-3 bg-accent" : "w-1 bg-white/55"}`} />
                  )}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {showAssistantShortcut && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[92px]">
          <div className="arkiv-assistant-shortcut-glow absolute bottom-[46px] h-36 w-[min(920px,calc(100vw-24px))] rounded-[48px] bg-gradient-to-r from-pink-300/18 via-pink-200/24 to-pink-400/18 blur-3xl" />
          <form
            ref={assistantShortcutRef}
            onSubmit={openAssistantFromShortcut}
            className="arkiv-assistant-shortcut-shell pointer-events-auto relative flex w-[min(720px,calc(100vw-32px))] items-center gap-3 rounded-[24px] border border-white/22 bg-white/12 px-4 py-3 shadow-[0_26px_90px_rgba(0,0,0,.48)] backdrop-blur-2xl focus-within:border-pink-200/55"
          >
            <div className={`grid size-9 shrink-0 place-items-center rounded-2xl ${brandTile}`}>
              <Bot className="size-5" />
            </div>
            <label className="relative flex min-w-0 flex-1 cursor-text items-center">
              <span className="pointer-events-none min-w-0 truncate text-[15px] font-medium text-white">
                {assistantShortcutInput || "What can I help you with today?"}
              </span>
              {assistantShortcutFocused && (
                <span className="ml-0.5 h-6 w-0.5 shrink-0 animate-pulse rounded-full bg-pink-300" />
              )}
              <input
                ref={assistantShortcutInputRef}
                value={assistantShortcutInput}
                onChange={(event) => setAssistantShortcutInput(event.target.value)}
                onFocus={() => setAssistantShortcutFocused(true)}
                onBlur={() => setAssistantShortcutFocused(false)}
                aria-label="Tanya Do"
                className="arkiv-assistant-shortcut-input absolute inset-0 h-full w-full cursor-text appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
              />
            </label>
            <button
              type="button"
              className="hidden shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white/55 transition hover:bg-white/8 sm:flex"
              onClick={() => {
                setQueuedAssistantPrompt(null);
                setShowAssistant(true);
              }}
            >
              New Chat
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="submit"
              disabled={!assistantShortcutInput.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-lg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
              title="Buka Do"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}

      {previewModule && <ModuleWindow module={previewModule} isLoggedIn={isLoggedIn} onClose={() => setPreviewModule(null)} onOpen={() => openModule(previewModule)} />}
      {showApplicationFolder && <ApplicationFolderModal onClose={() => setShowApplicationFolder(false)} onOpen={openModule} onComingSoon={setComingSoonApp} />} 
      {comingSoonApp && <ComingSoonModal title={comingSoonApp} onClose={() => setComingSoonApp(null)} />}
      {showLibrary && <AppLibrary onClose={() => setShowLibrary(false)} onOpen={openModule} />}
      {showCommand && (
        <CommandPalette
          query={query}
          setQuery={setQuery}
          modules={filteredModules}
          onClose={() => setShowCommand(false)}
          onOpen={openModule}
          onAssistant={() => setShowAssistant(true)}
          onNotifications={() => setShowNotifications(true)}
          onWallpaper={() => setShowWallpaperPicker(true)}
          onWidgets={() => setShowWidgetSettings(true)}
          onFiles={() => setShowFiles(true)}
          onSettings={() => setShowSettings(true)}
          onOpenPath={openPath}
          isLoggedIn={isLoggedIn}
        />
      )}
      {pathWindows.map((win) => (
        <PathWindowFrame key={win.id} window={win} onClose={() => closePathWindow(win.id)} />
      ))}
      {showWaNotif && (
        <WindowShell title="Notifikasi WA" onClose={() => setShowWaNotif(false)} className="left-1/2 top-14 max-h-[calc(100vh-140px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto">
          <WaNotifSettingsPanel />
        </WindowShell>
      )}
      {showNotifications && notifHistory.length > 0 && (
        <NotificationCenter items={notifHistory} onOpen={openNotification} onClear={() => { setNotifHistory([]); setShowNotifications(false); }} onClose={() => setShowNotifications(false)} />
      )}
      <NotificationPopups popups={notifPopups} onDismiss={dismissPopup} onOpen={openNotification} />
      {showFiles && <FileExplorer onClose={() => setShowFiles(false)} isLoggedIn={isLoggedIn} />}
      {showWallpaperPicker && (
        <WallpaperPicker
          items={allWallpapers}
          selected={wallpaper.id}
          canManage={userAccount?.role === "super_admin" || userAccount?.role === "admin"}
          onSelect={(item) => { setWallpaper(item); window.localStorage.setItem(WALLPAPER_STORAGE_KEY, item.id); }}
          onUploaded={(item) => {
            const next = { ...item, custom: true };
            setCustomWallpapers((prev) => [next, ...prev.filter((row) => row.id !== next.id)]);
            setWallpaper(next);
            window.localStorage.setItem(WALLPAPER_STORAGE_KEY, next.id);
          }}
          onDeleted={(id) => {
            setCustomWallpapers((prev) => prev.filter((row) => row.id !== id));
            if (wallpaper.id === id) {
              setWallpaper(wallpapers[0]);
              window.localStorage.setItem(WALLPAPER_STORAGE_KEY, wallpapers[0].id);
            }
          }}
          onClose={() => setShowWallpaperPicker(false)}
        />
      )}
      {showWidgetSettings && <WidgetSettings visibility={widgetVisibility} order={widgetOrder} onChange={updateWidgetVisibility} onMove={moveWidget} onReorder={reorderWidget} onClose={() => setShowWidgetSettings(false)} />}
      {showSettings && (
        <SystemSettings
          onOpenWaNotif={() => { setShowSettings(false); setShowWaNotif(true); }}
          soundEnabled={soundEnabled}
          assistantSettings={assistantSettings}
          onSoundChange={updateSoundEnabled}
          onAssistantSettingsChange={updateAssistantSettings}
          onOpenWallpaper={() => setShowWallpaperPicker(true)}
          onOpenWidgets={() => setShowWidgetSettings(true)}
          onOpenShortcuts={() => setShowShortcuts(true)}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showAbout && <AboutArkiv onClose={() => setShowAbout(false)} />}
      {showAssistant && (
        <AiAssistantWindow
          account={userAccount}
          settings={assistantSettings}
          initialPrompt={queuedAssistantPrompt}
          onInitialPromptConsumed={consumeQueuedAssistantPrompt}
          onClose={() => setShowAssistant(false)}
        />
      )}
      {openAppModule && <ApplicationWindow module={openAppModule} url={moduleHref(openAppModule)} onClose={() => setOpenAppModule(null)} />}
      {moduleOpenChoice && (
        <ModuleOpenChoiceModal
          module={moduleOpenChoice}
          isLoggedIn={isLoggedIn}
          onClose={() => setModuleOpenChoice(null)}
          onOpenInside={() => openModuleInArkivOs(moduleOpenChoice)}
          onOpenNewTab={() => openModuleInNewTab(moduleOpenChoice)}
        />
      )}
      {showAccount && (
        <OsAccountPopup
          account={userAccount}
          onClose={() => setShowAccount(false)}
          onLogin={() => router.push("/login?redirect=/arkiv-os")}
          onDashboard={() => router.push("/dashboard")}
          onLock={() => {
            setShowAccount(false);
            setLocked(true);
          }}
        />
      )}
      {contextMenu?.module && <ContextMenu x={contextMenu.x} y={contextMenu.y} module={contextMenu.module} onOpen={() => openModule(contextMenu.module!)} onInfo={() => setPreviewModule(contextMenu.module!)} />}
      {locked && userAccount && (
        <LockScreen
          account={userAccount}
          onUnlock={() => setLocked(false)}
          onSwitchUser={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login?redirect=/arkiv-os");
          }}
        />
      )}
      {showShortcuts && <ShortcutCheatSheet onClose={() => setShowShortcuts(false)} />}
      {showToday && (
        <TodayPanel
          overview={overview.data}
          onClose={() => setShowToday(false)}
          onOpenPath={(path, title) => {
            setShowToday(false);
            openPath(path, title);
          }}
        />
      )}
      {contextMenu?.desktop && <DesktopContextMenu x={contextMenu.x} y={contextMenu.y} onWallpaper={() => setShowWallpaperPicker(true)} onWidgets={() => setShowWidgetSettings(true)} onApps={() => setShowLibrary(true)} onSettings={() => setShowSettings(true)} onAbout={() => setShowAbout(true)} />}
    </main>
    </WindowStateContext.Provider>
    </WindowApiContext.Provider>
  );
}

function CalendarWidget({ date, onClose }: { date: Date; onClose: () => void }) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
  const weekDays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <WindowShell title="Calendar Widget" onClose={onClose} className="right-5 top-16 hidden w-80 lg:block">
      <div className="p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight capitalize">{monthLabel}</h2>
            <p className="text-xs text-white/55">Monthly view</p>
          </div>
          <div className="rounded-2xl bg-pink-500/25 px-3 py-2 text-center">
            <div className="text-2xl font-bold leading-none">{today}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-pink-100">Today</div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {weekDays.map((day) => (
            <div key={day} className="py-1 text-[11px] font-semibold text-white/45">
              {day}
            </div>
          ))}
          {cells.map((cell, index) => {
            const isToday = cell === today;
            return (
              <div
                key={`${cell ?? "blank"}-${index}`}
                className={`grid aspect-square place-items-center rounded-xl text-sm ${
                  cell ? (isToday ? "bg-accent font-bold text-accent-foreground shadow-lg" : "bg-black/14 text-white/78") : ""
                }`}
              >
                {cell}
              </div>
            );
          })}
        </div>
      </div>
    </WindowShell>
  );
}

function DockButton({ label, icon: Icon, onClick, active = false, running = false }: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void; active?: boolean; running?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`group relative grid size-10 shrink-0 place-items-center rounded-xl transition duration-200 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none sm:size-12 sm:rounded-2xl ${
        active
          ? "bg-accent text-accent-foreground shadow-[0_8px_24px_rgba(218,255,89,.28)]"
          : "border border-white/8 bg-white/[0.06] text-white/80 hover:bg-white/12 hover:text-white"
      }`}
    >
      <Icon className="size-4 transition group-hover:scale-110 sm:size-5" />
      <DockTooltip label={label} />
      {/* Titik = jendelanya terbuka (running) tapi tidak sedang aktif. */}
      {running && !active && <span className="absolute -bottom-1 size-1 rounded-full bg-white/60" />}
    </button>
  );
}

/** Label di atas ikon saat hover/fokus (sm+; di ponsel dock bisa digulir dan memotongnya). */
function DockTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute -top-10 left-1/2 hidden -translate-x-1/2 translate-y-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/10 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block">
      {label}
    </span>
  );
}

/**
 * Manajer jendela ala desktop sungguhan: urutan fokus, minimize ke dock,
 * snap ke tepi, dan ingatan posisi/ukuran per jendela. Logika murninya ada di
 * `@/lib/desktop/window-manager` (teruji); di sini hanya perekatan ke React.
 */
const WINDOW_Z_BASE = 40;

type WindowCommand = "snap-left" | "snap-right" | "maximize" | "restore";
type WindowRecord = { title: string; minimized: boolean };

type WindowApi = {
  register: (id: string, title: string, onClose: () => void) => void;
  release: (id: string) => void;
  focus: (id: string) => void;
  setMinimized: (id: string, value: boolean) => void;
  closeById: (id: string) => void;
  send: (id: string, kind: WindowCommand) => void;
};

type WindowManagerState = {
  order: string[];
  windows: Record<string, WindowRecord>;
  command: { id: string; kind: WindowCommand; nonce: number } | null;
};

const WindowApiContext = createContext<WindowApi | null>(null);
const WindowStateContext = createContext<WindowManagerState>({
  order: [],
  windows: {},
  command: null,
});

function loadGeometryMap(): GeometryMap {
  try {
    return parseGeometryMap(window.localStorage.getItem(WINDOW_GEOMETRY_STORAGE_KEY));
  } catch {
    return {};
  }
}

function persistGeometry(id: string, geo: WindowGeometry) {
  try {
    const next = rememberGeometry(loadGeometryMap(), id, geo);
    window.localStorage.setItem(WINDOW_GEOMETRY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* penyimpanan terkunci (mode privat) — jendela tetap jalan tanpa ingatan */
  }
}

function useWindowManager() {
  const [order, setOrder] = useState<string[]>([]);
  const [windows, setWindows] = useState<Record<string, WindowRecord>>({});
  const [command, setCommand] = useState<WindowManagerState["command"]>(null);
  const closers = useRef<Record<string, () => void>>({});
  const nonce = useRef(0);

  const focus = useCallback((id: string) => {
    setOrder((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((item) => item !== id), id]));
    // Fokus selalu memunculkan kembali jendela yang dikecilkan (klik ikon dock).
    setWindows((prev) =>
      prev[id]?.minimized ? { ...prev, [id]: { ...prev[id], minimized: false } } : prev
    );
  }, []);

  const register = useCallback(
    (id: string, title: string, onClose: () => void) => {
      closers.current[id] = onClose;
      setWindows((prev) => ({ ...prev, [id]: { title, minimized: prev[id]?.minimized ?? false } }));
      focus(id);
    },
    [focus]
  );

  const release = useCallback((id: string) => {
    delete closers.current[id];
    setOrder((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : prev));
    setWindows((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setMinimized = useCallback((id: string, value: boolean) => {
    setWindows((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], minimized: value } } : prev));
    // Dikecilkan = tidak lagi paling depan; jendela di bawahnya mengambil alih.
    if (value) setOrder((prev) => (prev[prev.length - 1] === id ? [id, ...prev.filter((i) => i !== id)] : prev));
  }, []);

  const closeById = useCallback((id: string) => {
    closers.current[id]?.();
  }, []);

  const send = useCallback((id: string, kind: WindowCommand) => {
    nonce.current += 1;
    setCommand({ id, kind, nonce: nonce.current });
  }, []);

  const api = useMemo<WindowApi>(
    () => ({ register, release, focus, setMinimized, closeById, send }),
    [register, release, focus, setMinimized, closeById, send]
  );
  const state = useMemo<WindowManagerState>(() => ({ order, windows, command }), [order, windows, command]);

  /** Jendela paling depan yang benar-benar terlihat (bukan yang dikecilkan). */
  const topWindowId = useMemo(() => {
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (windows[id] && !windows[id].minimized) return id;
    }
    return null;
  }, [order, windows]);

  const visibleOrder = useMemo(
    () => order.filter((id) => windows[id] && !windows[id].minimized),
    [order, windows]
  );

  return { api, state, topWindowId, visibleOrder, windows };
}

function WindowShell({
  title,
  children,
  onClose,
  className = "",
  windowId: windowIdProp,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  /** Id unik bila satu judul bisa terbuka lebih dari satu (deep link / multi-instance). */
  windowId?: string;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const onCloseRef = useRef(onClose);
  const [rect, setRect] = useState<WindowGeometry | null>(() => {
    if (typeof window === "undefined") return null;
    return restoreGeometry(loadGeometryMap(), windowIdProp ?? title, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
  const [snapped, setSnapped] = useState<SnapEdge | null>(null);
  const [snapHint, setSnapHint] = useState<SnapEdge | null>(null);
  const preSnapRect = useRef<WindowGeometry | null>(null);
  const windowApi = useContext(WindowApiContext);
  const { order, windows, command } = useContext(WindowStateContext);
  const windowId = windowIdProp ?? title;
  const minimized = windows[windowId]?.minimized ?? false;
  const orderIndex = order.indexOf(windowId);
  // Dibatasi agar tumpukan jendela tidak pernah menyusul dock/menubar (z-75).
  const zIndex = WINDOW_Z_BASE + Math.min(Math.max(0, orderIndex), 29);
  const visible = order.filter((id) => windows[id] && !windows[id].minimized);
  const isActive = !minimized && visible[visible.length - 1] === windowId;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Daftarkan jendela ke manajer (dock + pintasan), lalu lepas saat ditutup. */
  useEffect(() => {
    windowApi?.register(windowId, title, () => onCloseRef.current());
    return () => windowApi?.release(windowId);
  }, [windowApi, windowId, title]);

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  const captureRect = useCallback(() => {
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return null;
    const next = { left: box.left, top: box.top, width: box.width, height: box.height };
    setRect(next);
    return next;
  }, []);

  const applySnap = useCallback(
    (edge: SnapEdge) => {
      const current = rect ?? captureRect();
      if (current && !snapped) preSnapRect.current = current;
      const geo = snapGeometry(edge, viewport());
      setRect(geo);
      setSnapped(edge);
      persistGeometry(windowId, geo);
    },
    [captureRect, rect, snapped, windowId]
  );

  const restoreSnap = useCallback(() => {
    const previous = preSnapRect.current;
    setSnapped(null);
    if (previous) {
      const geo = clampGeometry(previous, viewport());
      setRect(geo);
      persistGeometry(windowId, geo);
    }
  }, [windowId]);

  /* Perintah dari pintasan papan ketik / menu (⌘←, ⌘↑, dst). */
  useEffect(() => {
    if (!command || command.id !== windowId) return;
    const kind = command.kind;
    const frame = requestAnimationFrame(() => {
      if (kind === "restore") restoreSnap();
      else applySnap(kind === "maximize" ? "maximize" : kind === "snap-left" ? "left" : "right");
    });
    return () => cancelAnimationFrame(frame);
  }, [command, windowId, applySnap, restoreSnap]);

  const focusWindow = () => windowApi?.focus(windowId);

  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    focusWindow();
    const current = rect ?? captureRect();
    if (!current) return;
    dragRef.current = {
      offsetX: event.clientX - current.left,
      offsetY: event.clientY - current.top,
    };
    event.preventDefault();
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const resize = resizeRef.current;
      if (drag) {
        // Seret ke tepi layar = pratinjau snap (Aero Snap / Rectangle).
        setSnapHint(detectSnapEdge({ x: event.clientX, y: event.clientY }, { width: window.innerWidth, height: window.innerHeight }));
        setRect((current) => {
          if (!current) return current;
          return {
            ...current,
            left: Math.max(8, Math.min(window.innerWidth - current.width - 8, event.clientX - drag.offsetX)),
            top: Math.max(MENUBAR_H, Math.min(window.innerHeight - 56, event.clientY - drag.offsetY)),
          };
        });
      }
      if (resize) {
        setRect((current) => {
          if (!current) return current;
          return {
            ...current,
            width: Math.max(MIN_WINDOW_W, Math.min(window.innerWidth - current.left - 8, resize.width + event.clientX - resize.startX)),
            height: Math.max(MIN_WINDOW_H, Math.min(window.innerHeight - current.top - 72, resize.height + event.clientY - resize.startY)),
          };
        });
      }
    };
    const handleUp = (event: MouseEvent) => {
      const wasDragging = Boolean(dragRef.current);
      const wasResizing = Boolean(resizeRef.current);
      dragRef.current = null;
      resizeRef.current = null;
      if (!wasDragging && !wasResizing) return;
      const edge = wasDragging
        ? detectSnapEdge({ x: event.clientX, y: event.clientY }, { width: window.innerWidth, height: window.innerHeight })
        : null;
      setSnapHint(null);
      if (edge) {
        applySnap(edge);
        return;
      }
      if (wasDragging) setSnapped(null);
      setRect((current) => {
        if (current) persistGeometry(windowId, current);
        return current;
      });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [applySnap, windowId]);

  const floatingStyle: CSSProperties | undefined = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : undefined;

  const activeClassName = rect ? "" : className;

  return (
    <>
      {snapHint ? (
        <div
          aria-hidden
          style={{ ...snapGeometry(snapHint, { width: typeof window === "undefined" ? 1440 : window.innerWidth, height: typeof window === "undefined" ? 900 : window.innerHeight }), zIndex: WINDOW_Z_BASE - 1 }}
          className="pointer-events-none fixed rounded-3xl border-2 border-pink-200/50 bg-pink-200/10 backdrop-blur-sm transition-all"
        />
      ) : null}
      <div
        ref={windowRef}
        style={{ ...floatingStyle, zIndex, display: minimized ? "none" : undefined }}
        onMouseDown={focusWindow}
        className={`fixed overflow-hidden rounded-3xl border bg-slate-950/55 shadow-2xl backdrop-blur-2xl max-sm:inset-x-2! max-sm:top-11! max-sm:bottom-[72px]! max-sm:h-auto! max-sm:max-h-none! max-sm:w-auto! max-sm:translate-x-0! max-sm:translate-y-0! max-sm:rounded-2xl! ${isActive ? "border-pink-200/35 ring-1 ring-pink-300/20" : "border-white/18"} ${activeClassName}`}
      >
        <div className="flex h-11 cursor-move items-center justify-between border-b border-white/10 px-4" onMouseDown={startDrag} onDoubleClick={() => (snapped ? restoreSnap() : applySnap("maximize"))}>
          <div className="flex items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
            <button className="size-3 rounded-full bg-red-400 transition hover:scale-125" onClick={onClose} aria-label="Close" title="Tutup" />
            <button
              className="size-3 rounded-full bg-amber-300 transition hover:scale-125"
              onClick={() => {
                if (!rect) captureRect();
                windowApi?.setMinimized(windowId, true);
              }}
              aria-label="Minimize"
              title="Kecilkan ke dock"
            />
            <button
              className="size-3 rounded-full bg-emerald-400 transition hover:scale-125"
              onClick={() => (snapped ? restoreSnap() : applySnap("maximize"))}
              aria-label="Maximize"
              title={snapped ? "Pulihkan ukuran" : "Layar penuh"}
            />
          </div>
          <span className="select-none text-xs font-medium text-white/65">{title}</span>
          <button onClick={onClose} onMouseDown={(event) => event.stopPropagation()}><X className="size-4 text-white/60" /></button>
        </div>
        <div className="h-[calc(100%-44px)] overflow-auto">{children}</div>
        {!snapped && (
          <button
            aria-label="Resize"
            title="Ubah ukuran"
            className="absolute bottom-2 right-2 size-4 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-white/35"
            onMouseDown={(event) => {
              event.stopPropagation();
              focusWindow();
              const current = rect ?? captureRect();
              if (!current) return;
              resizeRef.current = { startX: event.clientX, startY: event.clientY, width: current.width, height: current.height };
            }}
          />
        )}
      </div>
    </>
  );
}

function ModuleWindow({ module, isLoggedIn, onClose, onOpen }: { module: DesktopModule; isLoggedIn: boolean; onClose: () => void; onOpen: () => void }) {
  const Icon = module.icon;
  return (
    <WindowShell title={`${module.name} Preview`} onClose={onClose} className="left-1/2 top-1/2 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2">
      <div className="p-6">
        <div className="mb-5 flex items-center gap-4">
          <div className="relative grid size-16 place-items-center rounded-[22px] border border-white/25 bg-white/15">
            <div className={`absolute inset-1 rounded-[18px] ${brandTile}`} />
            <Icon className="relative size-8 text-accent-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{module.name}</h2>
            <p className="text-sm text-white/55">{module.subtitle}</p>
          </div>
        </div>
        <p className="text-sm leading-6 text-white/70">{module.description}</p>
        <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/8 p-3 text-sm text-white/65">
          <span>Status</span>
          <span>{module.disabled ? "Coming soon" : isLoggedIn ? "Ready to open" : "Login required"}</span>
        </div>
        <button disabled={module.disabled} onClick={onOpen} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50">
          <LogIn className="size-4" /> {isLoggedIn ? "Open Workspace" : "Login & Open"}
        </button>
      </div>
    </WindowShell>
  );
}

function ModuleOpenChoiceModal({
  module,
  isLoggedIn,
  onClose,
  onOpenInside,
  onOpenNewTab,
}: {
  module: DesktopModule;
  isLoggedIn: boolean;
  onClose: () => void;
  onOpenInside: () => void;
  onOpenNewTab: () => void;
}) {
  const Icon = module.icon;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xl" onClick={onClose}>
      <div
        className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-[28px] border border-white/18 bg-slate-950/88 shadow-[0_28px_90px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-5">
          <div className="flex items-center gap-4">
            <div className="relative grid size-14 place-items-center rounded-2xl border border-white/25 bg-white/12">
              <div className={`absolute inset-1 rounded-[18px] ${brandTile}`} />
              <Icon className="relative size-7 text-accent-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{module.name}</h2>
              <p className="text-xs text-white/50">{isLoggedIn ? module.subtitle : "Login required"}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/18 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <button
            type="button"
            onClick={onOpenInside}
            className="group flex w-full items-center gap-4 rounded-2xl border border-pink-300/30 bg-pink-500/16 p-4 text-left transition hover:border-pink-200/50 hover:bg-pink-500/24"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-lg">
              <MonitorDot className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Buka di {BRAND_OS}</div>
              <div className="mt-1 text-xs leading-5 text-white/55">Module tampil sebagai window di desktop {BRAND_OS}.</div>
            </div>
            <ChevronRight className="size-4 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
          </button>

          <button
            type="button"
            onClick={onOpenNewTab}
            className="group flex w-full items-center gap-4 rounded-2xl border border-white/12 bg-white/8 p-4 text-left transition hover:border-white/24 hover:bg-white/12"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/12 text-white">
              <ExternalLink className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Open New Tab</div>
              <div className="mt-1 text-xs leading-5 text-white/55">Module dibuka di tab browser baru.</div>
            </div>
            <ChevronRight className="size-4 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({
  query,
  setQuery,
  modules,
  onClose,
  onOpen,
  onAssistant,
  onNotifications,
  onWallpaper,
  onWidgets,
  onFiles,
  onSettings,
  onOpenPath,
  isLoggedIn,
}: {
  query: string;
  setQuery: (value: string) => void;
  modules: DesktopModule[];
  onClose: () => void;
  onOpen: (module: DesktopModule) => void;
  onOpenPath: (path: string, title: string) => void;
  isLoggedIn: boolean;
  onAssistant: () => void;
  onNotifications: () => void;
  onWallpaper: () => void;
  onWidgets: () => void;
  onFiles: () => void;
  onSettings: () => void;
}) {
  const actions = [
    { label: "System Settings", subtitle: "Theme, widgets, sound, account", icon: Settings, run: onSettings },
    { label: `${BRAND} Drive`, subtitle: "Open file explorer", icon: Folder, run: onFiles },
    { label: "Tanya Do", subtitle: "Buka asisten Do", icon: Bot, run: onAssistant },
    { label: "Notification Center", subtitle: "Review alerts and approvals", icon: Bell, run: onNotifications },
    { label: "Widgets", subtitle: "Turn desktop widgets on or off", icon: Activity, run: onWidgets },
    { label: "Change Wallpaper", subtitle: "Open Desktop settings", icon: MonitorDot, run: onWallpaper },
  ].filter((action) => `${action.label} ${action.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()) || !query.trim());

  const runAction = (run: () => void) => {
    run();
    onClose();
  };

  /* Spotlight juga mencari DATA (transaksi, member, produk, karyawan,
   * dokumen) lewat /api/desktop/search — dibatasi menu IAM pengguna. */
  const [hits, setHits] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // Diketik cepat → hanya kueri terakhir yang benar-benar dikirim.
    const timer = window.setTimeout(() => {
      if (!isLoggedIn || !isSearchable(query)) {
        setHits([]);
        return;
      }
      setSearching(true);
      fetch(`/api/desktop/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => setHits(Array.isArray(json?.data?.groups) ? json.data.groups : []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, isLoggedIn]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto mt-20 max-w-xl overflow-hidden rounded-3xl border border-white/18 bg-slate-950/80 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search className="size-5 text-white/50" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari aplikasi, transaksi, member, produk, karyawan…" className="w-full rounded-xl bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-gray-600" />
          <kbd className="rounded-md bg-white/10 px-2 py-1 text-[10px] text-white/50">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {searching && <div className="px-3 pt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">Mencari data…</div>}
          {hits.map((group) => (
            <div key={group.source}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={`${group.source}-${item.id}`}
                  onClick={() => runAction(() => onOpenPath(item.href, `${group.label}: ${item.title}`))}
                  className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    {item.subtitle ? <span className="block truncate text-xs text-white/45">{item.subtitle}</span> : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-white/35" />
                </button>
              ))}
            </div>
          ))}
          {actions.length > 0 && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Quick Actions</div>}
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} onClick={() => runAction(action.run)} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-white/10">
                <span className="flex items-center gap-3"><Icon className="size-5 text-pink-200" /><span><span className="block text-sm font-medium">{action.label}</span><span className="text-xs text-white/45">{action.subtitle}</span></span></span>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
          <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Applications</div>
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button key={module.name} onClick={() => !module.disabled && runAction(() => onOpen(module))} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-white/10 disabled:opacity-50" disabled={module.disabled}>
                <span className="flex items-center gap-3"><Icon className="size-5 text-pink-200" /><span><span className="block text-sm font-medium">{module.name}</span><span className="text-xs text-white/45">{module.subtitle}</span></span></span>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppLibrary({ onClose, onOpen }: { onClose: () => void; onOpen: (module: DesktopModule) => void }) {
  return (
    <WindowShell title="Applications" onClose={onClose} className="left-1/2 top-20 w-[min(620px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <button key={module.name} disabled={module.disabled} onClick={() => onOpen(module)} className="rounded-3xl bg-white/8 p-4 text-center transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-60">
              <div className={`mx-auto mb-3 grid size-14 place-items-center rounded-2xl ${brandTile}`}><Icon className="size-7" /></div>
              <div className="text-sm font-medium">{module.name}</div>
              <div className="text-[11px] text-white/45">{module.subtitle}</div>
            </button>
          );
        })}
      </div>
    </WindowShell>
  );
}

function ApplicationFolderModal({ onClose, onOpen, onComingSoon }: { onClose: () => void; onOpen: (module: DesktopModule) => void; onComingSoon: (name: string) => void }) {
  const activeModules = modules.filter((m) => !m.disabled);
  const comingSoonApps = [
    { name: "Finance", subtitle: "Accounting & Budget", icon: WalletCards },
    { name: "Legal", subtitle: "Contract & Compliance", icon: Scale },
    { name: "HAKI", subtitle: "IP Rights", icon: Landmark },
    { name: "Business", subtitle: "Planning & Strategy", icon: Building2 },
  ];
  
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop dengan blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />
      
      {/* Modal Window - macOS Liquid Glass Style */}
      <div 
        className="relative z-10 w-[min(680px,calc(100vw-48px))] overflow-hidden rounded-3xl bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-2xl backdrop-blur-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Module Grid - macOS Launchpad style - Liquid Glass */}
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
          {activeModules.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.name}
                onClick={() => {
                  onOpen(module);
                  onClose();
                }}
                className="group flex flex-col items-center gap-3 rounded-3xl p-4 transition-all duration-200 hover:bg-white/10 hover:shadow-xl hover:shadow-pink-500/20"
              >
                {/* Icon dengan shadow dan gradient */}
                <div className="relative grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-lg transition-all duration-200 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-pink-500/40">
                  <Icon className="size-8" />
                </div>
                
                {/* Label */}
                <div className="text-center">
                  <div className="text-sm font-medium text-white">{module.name}</div>
                  <div className="mt-1 text-[11px] text-white/60">{module.subtitle}</div>
                </div>
              </button>
            );
          })}
          {comingSoonApps.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.name}
                onClick={() => {
                  onComingSoon(app.name);
                  onClose();
                }}
                className="group flex flex-col items-center gap-3 rounded-3xl p-4 transition-all duration-200 hover:bg-white/10 hover:shadow-xl hover:shadow-pink-500/20"
              >
                <div className="relative grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-lg transition-all duration-200 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-pink-500/40">
                  <Icon className="size-8" />
                  <span className="absolute -right-1 -top-1 rounded-full border border-white/40 bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">Soon</span>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-white">{app.name}</div>
                  <div className="mt-1 text-[11px] text-white/60">{app.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ComingSoonModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <WindowShell title="Coming Soon" onClose={onClose} className="right-5 top-14 w-[min(390px,calc(100vw-32px))]">
      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-white/45">Application module</div>
            </div>
            <span className="rounded-full bg-pink-500/20 px-3 py-1 text-xs font-semibold text-pink-100">Coming Soon</span>
          </div>
        </div>
        <div className="block w-full rounded-3xl border border-white/10 bg-white/8 p-3 text-left text-sm text-white/72">
          <div className="flex gap-3">
            <div className="mt-0.5 size-2.5 rounded-full bg-pink-300" />
            <div>
              <div>Module {title} sedang disiapkan dan akan tersedia pada update berikutnya.</div>
              <div className="mt-1 text-xs text-white/40">{BRAND_OS} · Coming Soon</div>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-full rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500">
          Tutup
        </button>
      </div>
    </WindowShell>
  );
}

function IntegrationSettingsNative() {
  const folders = [
    { label: "Game", icon: Gamepad2, active: true },
    { label: "Photobox", icon: Camera },
    { label: "Payment Gateway", icon: CreditCard },
    { label: "API & Webhook", icon: Plug },
    { label: "Security", icon: ShieldCheck },
    { label: "Keys & Tokens", icon: Command },
  ];

  const integrations = [
    { name: "Game", note: "Arcade machine, topup credit, game session, dan status device", icon: Gamepad2, status: "Not connected" },
    { name: "Photobox", note: "Booking, payment, print queue, dan laporan penjualan photobox", icon: Camera, status: "Not connected" },
    { name: "Payment Gateway", note: "QRIS, kartu kredit, settlement, virtual account, dan webhook", icon: CreditCard, status: "Draft" },
    { name: "API & Webhook", note: "Endpoint callback, event subscription, dan automation trigger", icon: Plug, status: "Draft" },
  ];

  const settings = [
    "Auto Sync · Off",
    "Realtime Events · Off",
    "Webhook Security · Enabled",
    "Sandbox Server · Enabled",
  ];

  return (
    <div className="flex h-full min-h-[420px]">
      <aside className="w-56 border-r border-white/10 bg-black/12 p-3">
        <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Integration</div>
        {folders.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${item.active ? "bg-white/14 text-white" : "text-white/65"}`}
            >
              <Icon className="size-4 text-pink-200" /> {item.label}
            </button>
          );
        })}
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-white/50">
          Native {BRAND_OS} settings untuk koneksi Game, Photobox, Payment Gateway, API, dan webhook.
        </div>
      </aside>

      <section className="min-w-0 flex-1 p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Integration Center</h2>
            <p className="text-xs text-white/45">{BRAND_OS} · native settings</p>
          </div>
          <button className="rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/12">Add Integration</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {integrations.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}><Icon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{item.name}</div>
                  <div className="mt-1 text-xs text-white/45">{item.note}</div>
                </div>
                <div className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/45 lg:block">{item.status}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-4 text-sm leading-6 text-white/55">
          <div className="mb-3 text-sm font-semibold text-white">System Settings</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {settings.map((setting) => (
              <div key={setting} className="rounded-2xl bg-black/12 px-3 py-2 text-xs text-white/55">{setting}</div>
            ))}
          </div>
          <div className="mt-4 text-xs leading-5 text-white/45">
            Next phase: connect real credentials, sandbox/production endpoints, device status monitoring, and webhook logs.
          </div>
        </div>
      </section>
    </div>
  );
}

function ApplicationWindow({ module, url, onClose }: { module: DesktopModule; url: string; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const isNativeIntegration = module.name === "Integration";

  return (
    <WindowShell title={module.name} onClose={onClose} className="left-1/2 top-16 h-[min(700px,calc(100vh-120px))] w-[min(1200px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex h-full flex-col">
        {isNativeIntegration ? (
          <IntegrationSettingsNative />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-red-500/10 p-4">
              <AlertCircle className="size-8 text-red-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900">Failed to load</h3>
              <p className="text-sm text-gray-500">Unable to load the application</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-500"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Loading Overlay */}
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-xl">
                  <Loader2 className="size-8 animate-spin" />
                </div>
                <p className="text-sm font-medium text-gray-600">Loading {module.name}...</p>
              </div>
            )}

            {/* Iframe Content */}
            <iframe
              src={url}
              className="h-full w-full bg-white"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setError(true);
                setIsLoading(false);
              }}
              title={module.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </>
        )}
      </div>
    </WindowShell>
  );
}

/**
 * Jendela untuk satu halaman dashboard (hasil Spotlight / deep link).
 * windowId unik supaya beberapa instans bisa hidup berdampingan.
 */
function PathWindowFrame({ window: win, onClose }: { window: PathWindow; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  return (
    <WindowShell
      windowId={win.id}
      title={win.title}
      onClose={onClose}
      className="left-1/2 top-16 h-[min(700px,calc(100vh-120px))] w-[min(1200px,calc(100vw-32px))] -translate-x-1/2"
    >
      <div className="relative flex h-full flex-col">
        {isLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-100">
            <Loader2 className="size-8 animate-spin text-pink-500" />
          </div>
        )}
        <iframe
          src={win.path}
          className="h-full w-full bg-white"
          onLoad={() => setIsLoading(false)}
          title={win.title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </WindowShell>
  );
}

type DriveLocation = { kind: "folder"; folder: DataroomItem } | { kind: "reports" };

/**
 * Jendela Drive (owner 2026-09-05): lokasi = folder departemen di Dataroom
 * (root /dashboard/dataroom, sudah difilter hak akses departemen) + Reports.
 * Klik departemen → isi Dataroom 1:1 dengan dashboard.
 */
function FileExplorer({ onClose, isLoggedIn }: { onClose: () => void; isLoggedIn: boolean }) {
  const [roots, setRoots] = useState<DataroomItem[] | null>(null);
  const [rootsError, setRootsError] = useState<string | null>(null);
  const [location, setLocation] = useState<DriveLocation>({ kind: "reports" });

  useEffect(() => {
    if (!isLoggedIn) return;
    apiGet<{ data: DataroomListing }>("/api/dataroom/nodes")
      .then((res) => {
        const folders = res.data.items.filter((i) => i.kind === "folder");
        setRoots(folders);
        setRootsError(null);
        if (folders[0]) setLocation({ kind: "folder", folder: folders[0] });
      })
      .catch((err) => { setRoots([]); setRootsError(err instanceof Error ? err.message : "Gagal memuat Dataroom"); });
  }, [isLoggedIn]);

  const title = location.kind === "reports" ? "Reports" : location.folder.name;
  const subtitle = location.kind === "reports"
    ? "Laporan POS · unduh Excel per rentang tanggal"
    : "Dataroom · isi sama dengan Dashboard → Dataroom";
  const locButton = (active: boolean, label: string, onClick: () => void, key: string, lock?: boolean) => (
    <button key={key} onClick={onClick} className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${active ? "bg-white/14 text-white" : "text-white/65"}`}>
      <Folder className="size-4 shrink-0 text-pink-200" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {lock ? <Lock className="size-3 shrink-0 text-amber-200/70" /> : null}
    </button>
  );

  return (
    <WindowShell title={`${BRAND} Drive`} onClose={onClose} className="left-1/2 top-16 h-[min(620px,calc(100vh-120px))] w-[min(860px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex h-full min-h-[420px]">
        <aside className="flex w-56 flex-col border-r border-white/10 bg-black/12 p-3">
          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Locations</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!isLoggedIn ? (
              <p className="px-3 py-2 text-xs text-white/45">Login untuk melihat folder departemen.</p>
            ) : roots === null ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-white/45"><Loader2 className="size-3 animate-spin" /> Memuat…</p>
            ) : rootsError ? (
              <p className="px-3 py-2 text-xs text-rose-200/80">{rootsError}</p>
            ) : roots.length === 0 ? (
              <p className="px-3 py-2 text-xs text-white/45">Belum ada folder di Dataroom.</p>
            ) : (
              roots.map((f) => locButton(location.kind === "folder" && location.folder.id === f.id, f.name, () => setLocation({ kind: "folder", folder: f }), f.id, Boolean(f.departments?.length)))
            )}
            <div className="my-2 h-px bg-white/10" />
            {locButton(location.kind === "reports", "Reports", () => setLocation({ kind: "reports" }), "reports")}
          </div>
          <div className="mt-3 rounded-3xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-white/50">
            {isLoggedIn ? `Connected to ${BRAND} workspace.` : "Login required to open or download real files."}
          </div>
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-xs text-white/45">{subtitle}</p>
          </div>
          {location.kind === "reports" ? (
            <ReportsExplorer isLoggedIn={isLoggedIn} />
          ) : (
            <DriveDataroomBrowser key={location.folder.id} rootId={location.folder.id} rootName={location.folder.name} />
          )}
        </section>
      </div>
    </WindowShell>
  );
}

/**
 * Drive → Reports (owner 2026-09-05): klik laporan → pilih rentang tanggal
 * (pintasan Hari ini / Minggu ini / Bulan ini / Tahun ini) → unduh Excel
 * rapi dari /api/pos/reports/export. Butuh login (sesi dashboard).
 */
function ReportsExplorer({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [selected, setSelected] = useState<ReportExportKey | null>(null);
  const [shortcut, setShortcut] = useState<ReportPeriodShortcut | null>("month");
  const [range, setRange] = useState(() => resolveReportPeriod("month"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Panel tanggal ada di bawah daftar laporan → gulirkan ke panel saat laporan dipilih.
  useEffect(() => {
    if (selected) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  const pickShortcut = (key: ReportPeriodShortcut) => {
    setShortcut(key);
    setRange(resolveReportPeriod(key));
    setMessage(null);
  };
  const setManual = (patch: Partial<{ date_from: string; date_to: string }>) => {
    setShortcut(null);
    setRange((prev) => ({ ...prev, ...patch }));
    setMessage(null);
  };

  const download = async () => {
    if (!selected || busy) return;
    const invalid = validateReportRange(range.date_from, range.date_to);
    if (invalid) { setMessage({ kind: "error", text: invalid }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ report: selected, date_from: range.date_from, date_to: range.date_to });
      const res = await fetch(`/api/pos/reports/export?${qs.toString()}`);
      if (!res.ok || (res.headers.get("content-type") || "").includes("json")) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Gagal (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `${selected}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage({ kind: "ok", text: `${name} terunduh` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Gagal mengunduh" });
    } finally {
      setBusy(false);
    }
  };

  const keys = Object.keys(REPORT_EXPORTS) as ReportExportKey[];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((key) => {
          const meta = REPORT_EXPORTS[key];
          const active = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => { setSelected(key); setMessage(null); }}
              className={`flex items-center gap-3 rounded-3xl border p-4 text-left transition ${active ? "border-pink-300/70 bg-pink-500/20 ring-1 ring-pink-300/60" : "border-white/10 bg-white/8 hover:bg-white/12"}`}
            >
              <div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${brandTile}`}><FileSpreadsheet className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{meta.label}</div>
                <div className="mt-1 line-clamp-2 text-xs text-white/45">{meta.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div ref={panelRef} className="arkiv-drive-filter rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-pink-200" /> Rentang tanggal — {REPORT_EXPORTS[selected].label}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {REPORT_PERIOD_SHORTCUTS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => pickShortcut(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${shortcut === key ? "border-pink-300/70 bg-pink-500/30 text-white" : "border-white/10 bg-white/8 text-white/70 hover:bg-white/12"}`}
              >
                {REPORT_PERIOD_LABELS[key]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-white/60">
              Dari
              <input type="date" value={range.date_from} max={range.date_to} onChange={(e) => setManual({ date_from: e.target.value })} className="arkiv-drive-date mt-1 block rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold outline-none focus:border-pink-300/70" />
            </label>
            <label className="text-xs text-white/60">
              Sampai
              <input type="date" value={range.date_to} min={range.date_from} onChange={(e) => setManual({ date_to: e.target.value })} className="arkiv-drive-date mt-1 block rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold outline-none focus:border-pink-300/70" />
            </label>
            <button
              type="button"
              onClick={download}
              disabled={!isLoggedIn || busy}
              className={`inline-flex items-center gap-2 rounded-2xl ${brandTile} px-4 py-2.5 text-sm font-semibold shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {busy ? "Menyiapkan Excel…" : "Download Excel"}
            </button>
          </div>
          <p className={`mt-3 text-xs ${message?.kind === "error" ? "text-rose-300" : message ? "text-emerald-300" : "text-white/45"}`}>
            {message?.text ?? (isLoggedIn ? "File Excel rapi: judul, ringkasan, tabel berkepala, format Rupiah, beberapa sheet." : "Login dulu untuk mengunduh laporan.")}
          </p>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-white/55">
          Pilih laporan di atas, tentukan rentang tanggal, lalu unduh sebagai Excel.
        </div>
      )}
    </div>
  );
}

function NotificationCenter({
  items,
  onOpen,
  onClear,
  onClose,
}: {
  items: ActivityNotification[];
  onOpen: (n: ActivityNotification) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <WindowShell title="Notification Center" onClose={onClose} className="right-5 top-14 w-[min(390px,calc(100vw-32px))]">
      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Aktivitas</div>
              <div className="text-xs text-white/45">Kejadian terbaru di bisnis Anda</div>
            </div>
            <button
              onClick={onClear}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/16 hover:text-white"
            >
              Bersihkan
            </button>
          </div>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => onOpen(n)}
              className="block w-full rounded-3xl border border-white/10 bg-white/8 p-3 text-left text-sm text-white/72 transition hover:bg-white/12"
            >
              <div>{n.text}</div>
              <div className="mt-1 text-xs text-white/40">
                {new Date(n.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · klik untuk membuka
              </div>
            </button>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

function AiAssistantWindow({
  account,
  settings,
  initialPrompt,
  onInitialPromptConsumed,
  onClose,
}: {
  account: OsUserAccount | null;
  settings: AiAssistantSettings;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  onClose: () => void;
}) {
  /** Usulan aksi tulis Do yang menunggu tombol konfirmasi (EPIC-017 Fase E). */
  type PendingAction = {
    id: string;
    name: string;
    summary: string;
    status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
    result_note?: string;
  };
  type AssistantMessage = {
    role: "user" | "assistant";
    content: string;
    meta?: { status?: string; model?: string; scope?: string; fallbackReason?: string; pending_action?: PendingAction };
  };

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<"ready" | "live" | "fallback">("ready");
  const [statusNote, setStatusNote] = useState("Do siap. Kirim pesan untuk mulai.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState<"landing" | "chat">("landing");
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  /** id aksi yang sedang diproses endpoint konfirmasi (disable tombol kartu). */
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  type Attachment = { name: string; text: string; method: string; truncated: boolean; chars: number };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Auto-scroll hanya saat user memang sedang di dasar percakapan; kalau ia
   *  menggulir ke atas untuk membaca jawaban lama, jangan disentak turun. */
  const stickToBottomRef = useRef(true);
  const skipSessionRestoreRef = useRef(Boolean(initialPrompt?.trim()));
  const initialPromptSentRef = useRef(false);
  // Do terbuka untuk semua yang login. Yang dibatasi bukan ORANGNYA, tapi
  // ALAT-nya: server hanya menawarkan alat sesuai menu IAM (tool-scope.ts),
  // jadi kasir bisa bertanya stok tanpa bisa menarik data HRIS.
  const isAllowed = Boolean(account);
  const activeScope = AI_ASSISTANT_SCOPES.find((item) => item.id === settings.scope) ?? AI_ASSISTANT_SCOPES[0];
  const activeModel = AI_ASSISTANT_MODELS.find((item) => item.id === settings.model) ?? AI_ASSISTANT_MODELS[0];

  const refreshSessions = useCallback(() => {
    fetch("/api/ai/assistant?list=true")
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => {});
  }, []);

  const applyAssistantMeta = useCallback((meta?: AssistantMessage["meta"]) => {
    if (meta?.status === "live" && meta.model === activeModel.id) {
      setAssistantStatus("live");
      setStatusNote(`Live: ${activeModel.label}`);
      return;
    }

    setAssistantStatus("ready");
    setStatusNote(`Do siap · ${activeModel.label}`);
  }, [activeModel.id]);

  // On mount: fetch sessions + restore active session if any
  useEffect(() => {
    if (!isAllowed) return;
    refreshSessions();

    if (skipSessionRestoreRef.current) {
      return;
    }

    const saved = typeof window !== "undefined" ? localStorage.getItem("arkiv-ai-session") : null;
    if (saved) {
      setSessionId(saved);
      fetch(`/api/ai/assistant?session_id=${saved}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.messages?.length) {
            const mapped = data.messages
              .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
              .map((m: AssistantMessage) => ({ role: m.role, content: m.content, meta: m.meta }));
            setMessages(mapped);
            applyAssistantMeta(mapped.filter((m: AssistantMessage) => m.role === "assistant").at(-1)?.meta);
            setView("chat");
          }
        })
        .catch(() => {});
    }
  }, [applyAssistantMeta, isAllowed, refreshSessions]);

  useEffect(() => {
    if (assistantStatus === "ready") {
      setStatusNote(`Do siap · ${activeModel.label}`);
    }
  }, [activeModel.id, assistantStatus]);

  const enterLanding = () => {
    setView("landing");
    refreshSessions();
  };

  const startNewChat = () => {
    setSessionId(null);
    setMessages([
      {
        role: "assistant",
        content: `Halo, saya Do. Mode aktif: ${activeScope.label}. Tingkat: ${activeModel.label}.`,
      },
    ]);
    setAssistantStatus("ready");
    setStatusNote(`Do siap · ${activeModel.label}`);
    setView("chat");
    if (typeof window !== "undefined") localStorage.removeItem("arkiv-ai-session");
  };

  const loadSession = async (id: string) => {
    setSessionId(id);
    if (typeof window !== "undefined") localStorage.setItem("arkiv-ai-session", id);
    const res = await fetch(`/api/ai/assistant?session_id=${id}`);
    const data = await res.json();
    if (data.messages?.length) {
      const mapped = data.messages
        .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
        .map((m: AssistantMessage) => ({ role: m.role, content: m.content, meta: m.meta }));
      setMessages(mapped);
      applyAssistantMeta(mapped.filter((m: AssistantMessage) => m.role === "assistant").at(-1)?.meta);
    } else {
      setMessages([]);
      setAssistantStatus("ready");
      setStatusNote("Do siap. Kirim pesan untuk mulai.");
    }
    setView("chat");
  };

  const renameSession = async (id: string, currentTitle: string) => {
    if (typeof window === "undefined") return;
    const next = window.prompt("Judul baru untuk chat ini:", currentTitle || "");
    if (next === null) return;
    const title = next.trim();
    if (!title || title === currentTitle) return;

    // Optimistic: judul langsung berubah di daftar, dikembalikan bila gagal.
    const before = sessions;
    setSessions((prev) => prev.map((item) => (item.id === id ? { ...item, title } : item)));
    try {
      const response = await fetch(`/api/ai/assistant?session_id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error("gagal");
    } catch {
      setSessions(before);
    }
  };

  const deleteSession = async (id: string) => {
    const confirmed = typeof window === "undefined" || window.confirm("Hapus session chat ini?");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/ai/assistant?session_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error || "Gagal menghapus session");

      setSessions((prev) => prev.filter((session) => session.id !== id));
      if (sessionId === id) {
        setSessionId(null);
        setMessages([]);
        setAssistantStatus("ready");
        setStatusNote(`Do siap · ${activeModel.label}`);
        setView("landing");
        if (typeof window !== "undefined") localStorage.removeItem("arkiv-ai-session");
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Gagal menghapus session");
    }
  };

  const sendMessage = useCallback(async (text = input) => {
    const message = text.trim();
    if (!message || loading) return;

    // User baru saja menekan Enter: apa pun posisi scroll-nya, tarik ke bawah.
    stickToBottomRef.current = true;
    // Lampiran ikut pesan ini saja, lalu dikosongkan — pertanyaan berikutnya
    // tidak diam-diam membawa dokumen lama.
    const attachmentsToSend = attachments;
    const label = attachmentsToSend.length
      ? `${message}\n\n[Lampiran: ${attachmentsToSend.map((a) => a.name).join(", ")}]`
      : message;
    setMessages((prev) => [...prev, { role: "user", content: label }]);
    setInput("");
    setAttachments([]);
    setUploadError(null);
    setLoading(true);

    try {
      const history = messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .slice(-8);
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          session_id: sessionId,
          model: settings.model,
          scope: settings.scope,
          stream: true,
          attachments: attachmentsToSend.map((item) => ({ name: item.name, text: item.text })),
        }),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failure.error || "Do gagal merespons");
      }

      const applyResult = (payload: { session_id?: string; answer?: string; meta?: AssistantMessage["meta"] }) => {
        if (payload.session_id) {
          setSessionId(payload.session_id);
          if (typeof window !== "undefined") localStorage.setItem("arkiv-ai-session", payload.session_id);
        }
        const live = payload.meta?.status === "live";
        setAssistantStatus(live ? "live" : "fallback");
        setStatusNote(live ? `Live: ${activeModel.label}` : payload.meta?.fallbackReason ?? "Fallback aktif");
      };

      const isStream = response.headers.get("content-type")?.includes("text/event-stream");

      if (!isStream || !response.body) {
        // Server menjawab sekali-jadi (mis. jalur lama atau proxy menolak SSE).
        const json = await response.json();
        applyResult(json);
        setMessages((prev) => [...prev, { role: "assistant", content: json.answer, meta: json.meta }]);
        refreshSessions();
        return;
      }

      // Placeholder kosong yang isinya tumbuh seiring token berdatangan.
      let streamed = "";
      let placeholderAdded = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const pushDelta = (piece: string) => {
        streamed += piece;
        setMessages((prev) => {
          const next = [...prev];
          if (!placeholderAdded) {
            placeholderAdded = true;
            next.push({ role: "assistant", content: streamed });
            return next;
          }
          next[next.length - 1] = { ...next[next.length - 1], content: streamed };
          return next;
        });
        // Token pertama sudah tiba: sembunyikan indikator "Memproses...".
        setLoading(false);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;

        for (const event of events) {
          for (const raw of extractSseData(event)) {
            let payload: { type?: string; text?: string; answer?: string; error?: string; session_id?: string; meta?: AssistantMessage["meta"] };
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }
            if (payload.type === "delta" && payload.text) {
              pushDelta(payload.text);
            } else if (payload.type === "done") {
              applyResult(payload);
              // Teks final dari server dipakai apa adanya — hasil rakitan klien
              // bisa berbeda bila ada event yang terlewat.
              setMessages((prev) => {
                const next = [...prev];
                const finalMessage = { role: "assistant" as const, content: payload.answer ?? streamed, meta: payload.meta };
                if (placeholderAdded) next[next.length - 1] = finalMessage;
                else next.push(finalMessage);
                return next;
              });
              placeholderAdded = true;
            } else if (payload.type === "error") {
              throw new Error(payload.error || "Do gagal merespons");
            }
          }
        }
      }

      refreshSessions();
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: error instanceof Error ? error.message : "Terjadi kesalahan." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [attachments, input, loading, messages, refreshSessions, sessionId, settings.model, settings.scope]);

  /**
   * Keputusan user atas usulan aksi tulis. Eksekusi nyata terjadi di server
   * (endpoint konfirmasi memverifikasi kepemilikan, status pending, dan TTL) —
   * klik ganda atau kartu basi hanya menghasilkan pesan status, bukan aksi ganda.
   */
  const decideAction = useCallback(
    async (messageIndex: number, actionId: string, decision: "confirm" | "cancel") => {
      setActionBusyId(actionId);
      try {
        const res = await fetch("/api/ai/assistant/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_id: actionId, decision }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          action?: { status?: PendingAction["status"] };
          message?: string;
          error?: string;
        };
        const status = json.action?.status ?? "failed";
        const note = json.message ?? json.error ?? (res.ok ? "" : "Gagal memproses aksi");
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== messageIndex || !m.meta?.pending_action) return m;
            return {
              ...m,
              meta: { ...m.meta, pending_action: { ...m.meta.pending_action, status, result_note: note } },
            };
          })
        );
      } catch {
        // Jaringan putus: biarkan tetap pending supaya user bisa mencoba lagi.
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== messageIndex || !m.meta?.pending_action) return m;
            return {
              ...m,
              meta: {
                ...m.meta,
                pending_action: { ...m.meta.pending_action, result_note: "Jaringan bermasalah, coba lagi." },
              },
            };
          })
        );
      } finally {
        setActionBusyId(null);
      }
    },
    []
  );

  // Tinggi textarea mengikuti jumlah baris; direset dulu agar bisa mengecil lagi
  // saat teks dihapus.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleAttach = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/ai/assistant/attachment", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Gagal membaca ${file.name}`);
        setAttachments((prev) => [...prev.slice(-4), json.data as Attachment]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Gagal membaca lampiran");
    } finally {
      setUploading(false);
      // Reset input supaya file yang sama bisa dipilih lagi setelah dihapus.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const copyMessage = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1800);
    } catch {
      // clipboard diblokir (mis. konteks non-HTTPS) — diamkan, tombol tetap ada
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleMessageListScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Pesan baru & indikator "Memproses..." sama-sama menambah tinggi konten,
  // jadi keduanya perlu memicu scroll.
  useEffect(() => {
    if (view !== "chat") return;
    if (!stickToBottomRef.current) return;
    const id = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(id);
  }, [messages, loading, view, scrollToBottom]);

  // Masuk ke sebuah chat: langsung tampilkan bagian terbawah tanpa animasi.
  useEffect(() => {
    if (view !== "chat") return;
    stickToBottomRef.current = true;
    const id = requestAnimationFrame(() => scrollToBottom("auto"));
    return () => cancelAnimationFrame(id);
  }, [view, sessionId, scrollToBottom]);

  /** Buang jawaban terakhir lalu kirim ulang pertanyaan yang sama. */
  const regenerateLastAnswer = useCallback(() => {
    if (loading) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Jawaban lama dibuang dari state supaya tidak ada dua jawaban berdampingan;
    // riwayat di server tetap utuh sebagai jejak.
    setMessages((prev) => {
      const next = [...prev];
      while (next.length && next[next.length - 1].role === "assistant") next.pop();
      return next.filter((m) => m !== lastUser);
    });
    sendMessage(lastUser.content);
  }, [loading, messages, sendMessage]);

  useEffect(() => {
    const message = initialPrompt?.trim();
    if (!message) return;
    if (initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    skipSessionRestoreRef.current = true;
    onInitialPromptConsumed?.();

    if (!isAllowed) {
      return;
    }

    setView("chat");
    void sendMessage(message);
  }, [initialPrompt, isAllowed, onInitialPromptConsumed, sendMessage]);

  return (
    <WindowShell title="Do" onClose={onClose} className="right-5 top-14 flex h-[min(760px,calc(100vh-86px))] w-[min(780px,calc(100vw-32px))] flex-col">
      <div className="flex h-full overflow-hidden">
        {/* Sidebar: Chat history */}
        {showHistory && (
          <div className="flex w-56 flex-col border-r border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Chat History</span>
              <button onClick={startNewChat} className="grid size-6 place-items-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20" title="New chat">
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group flex w-full items-center rounded-xl text-xs transition ${sessionId === s.id ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
                >
                  <button
                    onClick={() => { setShowHistory(false); loadSession(s.id); }}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquareMore className="size-3.5 shrink-0" />
                      <span className="truncate">{s.title || "Chat session"}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/35">
                      {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </div>
                  </button>
                  <button
                    onClick={() => renameSession(s.id, s.title)}
                    className="grid size-7 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/12 hover:text-white/80"
                    title="Ganti nama session"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => deleteSession(s.id)}
                    className="mr-1 grid size-7 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-rose-500/16 hover:text-rose-200"
                    title="Hapus session"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="px-2 py-4 text-center text-[10px] text-white/30">Belum ada riwayat chat</div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-3">
              <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}>
                <Bot className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Do</div>
                <div className="truncate text-xs text-white/50">
                  {isAllowed ? `${activeScope.label} · ${activeModel.label}` : "Masuk dulu untuk memakai Do"}
                </div>
              </div>
              {view === "chat" && (
                <button
                  onClick={enterLanding}
                  className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/55 transition hover:bg-white/15"
                  title="Kembali ke daftar session"
                >
                  <ChevronLeft className="size-3" />
                  Sessions
                </button>
              )}
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${showHistory ? "bg-pink-600 text-white" : "bg-white/10 text-white/55 hover:bg-white/15"}`}
                title="Toggle history sidebar"
              >
                <History className="mr-1 inline size-3" />
                History
              </button>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${assistantStatus === "live" ? "bg-emerald-400/15 text-emerald-200" : assistantStatus === "fallback" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/55"}`} title={statusNote}>
                {assistantStatus === "live" ? "Do Live" : assistantStatus === "fallback" ? "Fallback" : "Ready"}
              </div>
            </div>
          </div>

          {!isAllowed ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Bot className="mb-4 size-12 text-pink-200" />
              <h3 className="text-lg font-semibold">Akses dibatasi</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">Masuk dulu untuk memakai Do. Data yang bisa dibacakan Do mengikuti hak akses menu Anda.</p>
              <Link href="/login?redirect=/arkiv-os" className="mt-5 rounded-2xl bg-pink-600 px-5 py-3 text-sm font-semibold hover:bg-pink-500">
                Login Super User
              </Link>
            </div>
          ) : view === "landing" ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground shadow-xl">
                <Bot className="size-8" />
              </div>
              <h3 className="text-xl font-bold text-white/90">Do</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/55">
                Asisten operasional BCD. Data yang bisa diakses mengikuti hak menu Anda. Mode {activeScope.label} memakai {activeModel.label}.
              </p>
              <button
                onClick={startNewChat}
                className="mt-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-700 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-pink-400 hover:to-pink-600"
              >
                <Plus className="size-4" />
                Start New Chat
              </button>

              {sessions.length > 0 && (
                <div className="mt-8 w-full max-w-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-white/40">Previous Sessions</span>
                  </div>
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex w-full items-center rounded-xl bg-white/5 text-left text-xs text-white/60 transition hover:bg-white/10"
                      >
                        <button
                          onClick={() => loadSession(s.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <MessageSquareMore className="size-3.5 shrink-0 text-white/40" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{s.title || "Chat session"}</div>
                            <div className="mt-0.5 text-[10px] text-white/30">
                              {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} · {new Date(s.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          <ChevronRight className="size-3 text-white/30" />
                        </button>
                        <button
                          onClick={() => renameSession(s.id, s.title)}
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/12 hover:text-white/80"
                          title="Ganti nama session"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => deleteSession(s.id)}
                          className="mr-2 grid size-8 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-rose-500/16 hover:text-rose-200"
                          title="Hapus session"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sessions.length === 0 && (
                <p className="mt-4 text-xs text-white/30">No previous sessions found. Start a new chat above.</p>
              )}
            </div>
          ) : (
            <>
              <div
                ref={messageListRef}
                onScroll={handleMessageListScroll}
                className="flex-1 space-y-3 overflow-y-auto p-4"
              >
                {messages.map((message, index) => {
                  const isAssistant = message.role === "assistant";
                  // Regenerate hanya untuk jawaban terakhir: mengulang jawaban di
                  // tengah percakapan akan membuat sisa riwayat tidak nyambung.
                  const canRegenerate = isAssistant && index === messages.length - 1 && !loading;
                  return (
                    <div key={index} className={`group flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm font-normal leading-6 ${message.role === "user" ? "bg-pink-600 text-white" : "bg-white/10 text-white/78"}`}>
                        {formatPlainChatText(message.content)}
                      </div>
                      {isAssistant && message.meta?.pending_action && (
                        <div className="mt-2 max-w-[85%] rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
                            <ShieldCheck className="size-3.5" /> Konfirmasi aksi
                          </div>
                          <p className="mt-1.5 leading-6 text-white/80">{message.meta.pending_action.summary}</p>
                          {message.meta.pending_action.status === "pending" ? (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={actionBusyId === message.meta.pending_action.id}
                                onClick={() => decideAction(index, message.meta!.pending_action!.id, "confirm")}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-pink-500 disabled:opacity-50"
                              >
                                {actionBusyId === message.meta.pending_action.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Check className="size-3.5" />
                                )}
                                Jalankan aksi
                              </button>
                              <button
                                type="button"
                                disabled={actionBusyId === message.meta.pending_action.id}
                                onClick={() => decideAction(index, message.meta!.pending_action!.id, "cancel")}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/15 disabled:opacity-50"
                              >
                                <X className="size-3.5" /> Batalkan
                              </button>
                              {message.meta.pending_action.result_note && (
                                <span className="text-[11px] text-amber-200/80">{message.meta.pending_action.result_note}</span>
                              )}
                            </div>
                          ) : (
                            <p className="mt-2 text-[12px] text-white/60">
                              {message.meta.pending_action.result_note ||
                                (message.meta.pending_action.status === "confirmed"
                                  ? "Aksi sudah dijalankan."
                                  : message.meta.pending_action.status === "cancelled"
                                    ? "Aksi dibatalkan."
                                    : message.meta.pending_action.status === "expired"
                                      ? "Aksi kedaluwarsa tanpa dikonfirmasi."
                                      : "Aksi gagal dijalankan.")}
                            </p>
                          )}
                        </div>
                      )}
                      {isAssistant && (
                        <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => copyMessage(message.content, index)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
                            title="Salin jawaban"
                          >
                            {copiedIndex === index ? <Check className="size-3" /> : <Copy className="size-3" />}
                            {copiedIndex === index ? "Tersalin" : "Salin"}
                          </button>
                          {canRegenerate && (
                            <button
                              type="button"
                              onClick={regenerateLastAnswer}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
                              title="Minta jawaban ulang"
                            >
                              <RefreshCw className="size-3" /> Ulangi
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {loading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
                      <Loader2 className="size-4 animate-spin" /> Memproses...
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="truncate rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/55">
                    {statusNote}
                  </div>
                  {sessionId && (
                    <button onClick={enterLanding} className="ml-2 shrink-0 rounded-xl bg-white/8 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/12">
                      Back to Sessions
                    </button>
                  )}
                </div>
                {(attachments.length > 0 || uploadError) && (
                  <div className="mb-2 space-y-1">
                    {attachments.map((item, index) => (
                      <div
                        key={`${item.name}-${index}`}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/70"
                      >
                        <Paperclip className="size-3 shrink-0 text-white/40" />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="shrink-0 text-white/35">
                          {item.method === "ocr" ? "OCR" : item.method === "spreadsheet" ? "tabel" : item.method}
                          {item.truncated ? " · dipotong" : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                          className="shrink-0 rounded-md p-0.5 text-white/35 transition hover:bg-white/10 hover:text-white/80"
                          aria-label={`Hapus lampiran ${item.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                    {uploadError && <p className="px-1 text-[11px] text-rose-300">{uploadError}</p>}
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                  className="flex gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.xlsx,.xls,.xlsm,.csv,.txt,.md,.tsv"
                    className="hidden"
                    onChange={(event) => handleAttach(event.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Lampirkan file (PDF, gambar, Excel, CSV)"
                    className="grid size-10 shrink-0 place-items-center self-end rounded-xl border border-white/20 bg-white/8 text-white/60 transition hover:bg-white/14 hover:text-white disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  </button>
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter mengirim; Shift+Enter menyisipkan baris baru.
                      // IME (mis. mengetik aksara) memakai Enter untuk memilih
                      // kandidat, jadi jangan kirim saat composing.
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={settings.scope === "general" ? "Tanyakan apapun... (Shift+Enter untuk baris baru)" : "Tanyakan data Talentpool atau hal umum... (Shift+Enter untuk baris baru)"}
                    className="min-h-[40px] max-h-40 min-w-0 flex-1 resize-none rounded-xl border border-white/20 bg-white px-3 py-2 text-sm leading-6 text-black outline-none placeholder:text-gray-600 focus:border-pink-300/70"
                  />
                  <button disabled={loading || !input.trim()} className="grid size-10 shrink-0 place-items-center self-end rounded-xl bg-pink-600 transition hover:bg-pink-500 disabled:opacity-50">
                    <Send className="size-4" />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </WindowShell>
  );
}

function formatPlainChatText(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function OsAccountPopup({
  account,
  onClose,
  onLogin,
  onDashboard,
  onLock,
}: {
  account: OsUserAccount | null;
  onClose: () => void;
  onLogin: () => void;
  onDashboard: () => void;
  onLock: () => void;
}) {
  const isLoggedIn = Boolean(account);

  const handleLogout = async () => {
    const db = createBrowserClient();
    await db.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-white/18 bg-slate-950/75 text-white shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Account</h2>
            <p className="text-xs text-white/50">{BRAND_OS} session</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="rounded-3xl border border-white/10 bg-white/8 p-4 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-accent text-accent-foreground text-lg font-bold shadow-lg">
              {isLoggedIn ? account?.fullName.slice(0, 1).toUpperCase() : "G"}
            </div>
            <div className="font-semibold">{isLoggedIn ? account?.fullName : "Guest"}</div>
            <div className="mt-1 text-sm text-white/55">{isLoggedIn ? account?.email : "Not logged in"}</div>
            <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold capitalize text-pink-100">
              {isLoggedIn ? account?.role.replace("_", " ") : "public access"}
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {isLoggedIn ? (
              <>
                <button onClick={onDashboard} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                  Go to Dashboard
                </button>
                <button onClick={onLock} className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/12">
                  Kunci Layar <span className="text-white/45">⌘⇧L</span>
                </button>
                <button onClick={handleLogout} className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/12">
                  Keluar / Ganti user
                </button>
              </>
            ) : (
              <button onClick={onLogin} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                Log In to {BRAND_OS}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WallpaperPicker({
  items,
  selected,
  canManage,
  onSelect,
  onUploaded,
  onDeleted,
  onClose,
}: {
  items: WallpaperItem[];
  selected: string;
  canManage: boolean;
  onSelect: (wallpaper: WallpaperItem) => void;
  onUploaded: (wallpaper: WallpaperItem) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/desktop/wallpapers", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? "Upload gagal");
      onUploaded(json.data as WallpaperItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (item: WallpaperItem) => {
    if (!window.confirm(`Hapus wallpaper "${item.name}"? Berkasnya ikut dihapus dari server.`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/desktop/wallpapers?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? "Gagal menghapus");
      onDeleted(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <WindowShell title="Desktop & Wallpaper" onClose={onClose} className="left-1/2 top-20 w-[min(720px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-5">
        {canManage && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Wallpaper sendiri</div>
              <div className="text-xs text-white/50">JPG / PNG / WebP, maks 8 MB. Tampil untuk semua pengguna desktop.</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl bg-white/15 px-4 py-2 text-sm font-semibold transition hover:bg-white/25 disabled:opacity-50"
            >
              {uploading ? "Mengunggah…" : "Unggah wallpaper"}
            </button>
          </div>
        )}
        {error && <div className="mb-3 rounded-2xl border border-red-300/40 bg-red-500/15 px-4 py-2 text-xs text-red-100">{error}</div>}
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`group relative rounded-3xl border p-3 text-left transition hover:bg-white/10 ${selected === item.id ? "border-pink-200/60 bg-white/14" : "border-white/10 bg-white/8"}`}
            >
              <button type="button" onClick={() => onSelect(item)} className="block w-full text-left">
                <div className="mb-3 h-24 rounded-2xl bg-cover bg-center" style={item.src.startsWith("/") ? { backgroundImage: `url('${item.src}')` } : { background: item.src }} />
                <div className="truncate text-sm font-semibold">{item.name}</div>
                <div className="text-xs text-white/45">{item.custom ? "Wallpaper unggahan" : "Mac-style desktop wallpaper"}</div>
              </button>
              {canManage && item.custom && (
                <button
                  type="button"
                  disabled={deletingId === item.id}
                  onClick={() => void remove(item)}
                  className="absolute right-5 top-5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/90 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/80 disabled:opacity-50"
                >
                  {deletingId === item.id ? "…" : "Hapus"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative h-7 w-12 rounded-full border transition ${enabled ? "border-pink-200/50 bg-pink-500" : "border-white/15 bg-white/10"}`}
      aria-label={label}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition ${enabled ? "left-6" : "left-1"}`} />
    </button>
  );
}

function LlmModelLogo({
  model,
  className = "size-8",
  imageClassName = "size-6",
}: {
  model: (typeof AI_ASSISTANT_MODELS)[number];
  className?: string;
  imageClassName?: string;
}) {
  return (
    <span className={`grid ${className} shrink-0 place-items-center overflow-hidden rounded-xl border border-white/12 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,.34)]`}>
      {model.logoSrc ? (
        <Image src={model.logoSrc} alt={`${model.label} logo`} width={28} height={28} className={`${imageClassName} object-contain`} />
      ) : (
        <span className={`grid h-full w-full place-items-center bg-gradient-to-br ${model.logoClassName} text-[10px] font-black`}>
          {model.logo}
        </span>
      )}
    </span>
  );
}

function SystemSettings({
  soundEnabled,
  assistantSettings,
  onSoundChange,
  onAssistantSettingsChange,
  onOpenWallpaper,
  onOpenWidgets,
  onOpenWaNotif,
  onOpenShortcuts,
  onClose,
}: {
  soundEnabled: boolean;
  assistantSettings: AiAssistantSettings;
  onSoundChange: (value: boolean) => void;
  onAssistantSettingsChange: (next: Partial<AiAssistantSettings>) => void;
  onOpenWallpaper: () => void;
  onOpenWidgets: () => void;
  onOpenWaNotif: () => void;
  onOpenShortcuts: () => void;
  onClose: () => void;
}) {
  const settings = [
    { title: "Desktop & Wallpaper", description: `Pilih wallpaper ${BRAND_OS}.`, icon: MonitorDot, action: onOpenWallpaper },
    { title: "Widgets", description: "Atur Calendar dan System Widgets.", icon: Activity, action: onOpenWidgets },
    { title: "Notifikasi WA", description: "Kabar penting bisnis dikirim otomatis ke WhatsApp.", icon: Bell, action: onOpenWaNotif },
    { title: "Pintasan Papan Ketik", description: "Tutup, kecilkan, pindah, dan tempel jendela tanpa mouse.", icon: Command, action: onOpenShortcuts },
  ];
  const SoundIcon = soundEnabled ? Volume2 : VolumeX;
  const [showModelMenu, setShowModelMenu] = useState(false);
  const activeModel = AI_ASSISTANT_MODELS.find((model) => model.id === assistantSettings.model) ?? AI_ASSISTANT_MODELS[0];

  return (
    <WindowShell title="System Settings" onClose={onClose} className="left-1/2 top-16 w-[min(760px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className={`mb-4 grid size-12 place-items-center rounded-2xl ${brandTile}`}><Settings className="size-6" /></div>
          <div className="font-semibold">{BRAND_OS} Settings</div>
          <div className="mt-1 text-xs leading-5 text-white/50">Theme, widgets, sound, Do, dan desktop preferences.</div>
        </aside>
        <section className="space-y-3">
          <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}><Bot className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Do</div>
                <div className="truncate text-xs leading-5 text-white/45">{assistantSettings.model}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/40">Context</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {AI_ASSISTANT_SCOPES.map((scope) => (
                  <button
                    key={scope.id}
                    onClick={() => onAssistantSettingsChange({ scope: scope.id })}
                    className={`min-h-11 rounded-2xl border px-3 py-2 text-center text-xs font-semibold transition ${assistantSettings.scope === scope.id ? "border-pink-300/60 bg-pink-500/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14)]" : "border-white/10 bg-black/15 text-white/60 hover:bg-white/10"}`}
                    title={scope.description}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">LLM Model</div>
              <button
                type="button"
                onClick={() => setShowModelMenu((value) => !value)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/12 bg-zinc-950/45 px-3 py-3 text-left text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_32px_rgba(0,0,0,.24)] outline-none transition hover:border-white/20 hover:bg-zinc-900/60 active:bg-zinc-950/80 focus-visible:bg-zinc-950/70 focus-visible:ring-2 focus-visible:ring-white/16"
                aria-haspopup="listbox"
                aria-expanded={showModelMenu}
              >
                <LlmModelLogo model={activeModel} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{activeModel.label}</div>
                  <div className="truncate text-[11px] text-white/55">{activeModel.description}</div>
                </div>
                <ChevronDown className={`size-4 text-white/55 transition ${showModelMenu ? "rotate-180" : ""}`} />
              </button>

              {showModelMenu && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[90] overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/95 p-1.5 text-white shadow-[0_24px_70px_rgba(0,0,0,.46)] backdrop-blur-2xl ring-1 ring-black/30" role="listbox" data-arkiv-ai-listbox="true">
                  {AI_ASSISTANT_MODELS.map((model) => {
                    const selected = assistantSettings.model === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onAssistantSettingsChange({ model: resolveAiAssistantModel(model.id) });
                          setShowModelMenu(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition active:bg-zinc-800/80 focus-visible:bg-zinc-800/70 focus-visible:outline-none ${selected ? "bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" : "text-white/72 hover:bg-white/[0.08] hover:text-white"}`}
                        role="option"
                        aria-selected={selected}
                      >
                        <LlmModelLogo model={model} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{model.label}</span>
                          <span className="block truncate text-[11px] text-white/52">{model.description}</span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-white/75" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {settings.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} onClick={item.action} className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}><Icon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-xs leading-5 text-white/45">{item.description}</div>
                </div>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
          <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}><SoundIcon className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Sound Effects</div>
              <div className="text-xs leading-5 text-white/45">Subtle click sound ala desktop OS. Default off.</div>
            </div>
            <ToggleSwitch enabled={soundEnabled} onChange={onSoundChange} label="Toggle sound effects" />
          </div>
        </section>
      </div>
    </WindowShell>
  );
}

function WidgetSettings({
  visibility,
  order,
  onChange,
  onMove,
  onReorder,
  onClose,
}: {
  visibility: WidgetVisibility;
  order: MonitorWidgetKey[];
  onChange: (key: keyof WidgetVisibility, value: boolean) => void;
  onMove: (key: MonitorWidgetKey, direction: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onClose: () => void;
}) {
  // Baris widget monitoring mengikuti urutan pilihan user (Fase C); Calendar
  // adalah window mengambang, bukan bagian papan, jadi tanpa kontrol urutan.
  const monitorItems = order
    .map((key) => MONITOR_WIDGETS.find((w) => w.key === key))
    .filter((w): w is (typeof MONITOR_WIDGETS)[number] => Boolean(w));
  const calendar = { key: "calendar" as const, title: "Calendar Widget", description: "Kalender bulanan yang bisa dipindahkan dan di-resize." };

  return (
    /* Dipusatkan lewat `inset-x-0 mx-auto`, BUKAN `left-1/2 -translate-x-1/2`.
       @hello-pangea/dnd menghitung posisi drag relatif terhadap containing
       block; `transform` pada leluhur membuat item yang diseret melompat atau
       tidak mengikuti kursor sama sekali. Panel ini memuat daftar drag & drop,
       jadi transform tidak boleh dipakai untuk memusatkannya. */
    <WindowShell title="Widgets" onClose={onClose} className="inset-x-0 top-24 mx-auto w-[min(460px,calc(100vw-32px))]">
      <div className="space-y-3 p-5">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="text-sm font-semibold">Desktop Widgets</div>
          <div className="mt-1 text-xs leading-5 text-white/50">Calendar Widget aktif secara default. Widget monitoring bisa diaktifkan dan diatur urutannya dengan tombol panah — urutan tersimpan di perangkat ini.</div>
        </div>
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className={`grid size-11 place-items-center rounded-2xl ${brandTile}`}><CalendarDays className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{calendar.title}</div>
            <div className="text-xs leading-5 text-white/45">{calendar.description}</div>
          </div>
          <ToggleSwitch enabled={visibility.calendar} onChange={(value) => onChange("calendar", value)} label={`Toggle ${calendar.title}`} />
        </div>
        {/* Drag & drop untuk mouse, tombol panah tetap ada untuk keyboard dan
            penyesuaian presisi. Handle dipisah dari baris: baris ini memuat
            toggle dan dua tombol panah, dan menjadikan seluruh baris draggable
            membuat klik pada tombol-tombol itu tertelan oleh gestur drag. */}
        <DragDropContext
          onDragEnd={(hasil: DropResult) => {
            if (!hasil.destination) return;
            onReorder(hasil.source.index, hasil.destination.index);
          }}
        >
          <Droppable droppableId="widget-monitoring">
            {(dropProvided) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className="space-y-3"
              >
                {monitorItems.map((item, index) => (
                  <Draggable draggableId={item.key} index={index} key={item.key}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 ${
                          dragSnapshot.isDragging ? "border-white/30 shadow-2xl" : ""
                        }`}
                      >
                        <div
                          {...dragProvided.dragHandleProps}
                          aria-label={`Seret untuk memindahkan ${item.title}`}
                          className="shrink-0 cursor-grab rounded-lg p-1 text-white/35 transition hover:text-white active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </div>
                        <div className="flex shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => onMove(item.key, -1)}
                            aria-label={`Naikkan urutan ${item.title}`}
                            className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          >
                            <ChevronUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === monitorItems.length - 1}
                            onClick={() => onMove(item.key, 1)}
                            aria-label={`Turunkan urutan ${item.title}`}
                            className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>
                        <div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${brandTile}`}><Activity className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{item.title}</div>
                          <div className="text-xs leading-5 text-white/45">{item.description}</div>
                        </div>
                        <ToggleSwitch enabled={visibility[item.key]} onChange={(value) => onChange(item.key, value)} label={`Toggle ${item.title}`} />
                      </div>
                    )}
                  </Draggable>
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </WindowShell>
  );
}

/**
 * Lampu status operasional di menubar: database, antrian cetak, WhatsApp.
 * Sekali lihat kasir/owner tahu ada layanan yang mati sebelum pelanggan
 * yang memberi tahu.
 */
function SystemStatusChip({ onOpenToday }: { onOpenToday: () => void }) {
  const [status, setStatus] = useState<{ items: StatusItem[]; level: StatusLevel } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/desktop/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!cancelled && json?.data) setStatus(json.data);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const level = status?.level ?? "unknown";
  const tone =
    level === "ok"
      ? "bg-emerald-400"
      : level === "warn"
        ? "bg-amber-300"
        : level === "down"
          ? "bg-rose-400"
          : "bg-white/40";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={statusLabel(level)}
        aria-label={statusLabel(level)}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 transition hover:bg-white/10"
      >
        <span className={`size-2 rounded-full ${tone}`} />
        <span className="hidden text-[11px] text-white/70 lg:inline">Status</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[90] w-64 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 p-1.5 text-left shadow-2xl backdrop-blur-2xl">
          {(status?.items ?? []).map((item) => (
            <div key={item.key} className="flex items-start gap-2 rounded-xl px-2.5 py-2">
              <span
                className={`mt-1 size-2 shrink-0 rounded-full ${
                  item.level === "ok"
                    ? "bg-emerald-400"
                    : item.level === "warn"
                      ? "bg-amber-300"
                      : item.level === "down"
                        ? "bg-rose-400"
                        : "bg-white/40"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="block text-[11px] text-white/45">{item.detail ?? "—"}</span>
              </span>
            </div>
          ))}
          {!status && <div className="px-2.5 py-2 text-[11px] text-white/45">Memeriksa layanan…</div>}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenToday();
            }}
            className="mt-1 w-full rounded-xl bg-white/10 px-2.5 py-2 text-xs font-semibold transition hover:bg-white/18"
          >
            Buka panel Hari Ini
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Panel "Hari Ini" (⌘⇧J): ringkasan operasional + KOTAK KEPUTUSAN yang bisa
 * langsung ditindaklanjuti. Cuti disetujui di tempat lewat API approval resmi
 * (potong kuota + notifikasi); PO dan stok membuka halaman yang tepat karena
 * keputusannya butuh konteks penuh.
 */
function TodayPanel({
  overview,
  onClose,
  onOpenPath,
}: {
  overview: DesktopOverviewData | null;
  onClose: () => void;
  onOpenPath: (path: string, title: string) => void;
}) {
  const [sections, setSections] = useState<InboxSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Tidak menyalakan `loading` di awal: nilai awalnya sudah true, dan
  // memanggil setState serentak dari effect memicu render berantai.
  const load = useCallback(() => {
    fetch("/api/desktop/inbox")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setSections(Array.isArray(json?.data?.sections) ? json.data.sections : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decideLeave = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      const res = await fetch("/api/hris/leaves/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_id: id,
          action,
          ...(action === "reject" ? { rejection_reason: "Ditolak dari panel Hari Ini" } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Gagal memproses");
      }
      load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Gagal memproses");
    } finally {
      setBusyId(null);
    }
  };

  const pulsa = overview?.pulsaBisnis;
  const tim = overview?.timHariIni;
  const tamu = overview?.tamuDiMeja;

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="h-full w-[min(420px,100vw)] overflow-y-auto border-l border-white/12 bg-slate-950/90 p-5 text-white shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Hari Ini</h2>
            <p className="text-xs text-white/45">Ringkasan operasional & keputusan yang menunggu</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Omzet", value: pulsa ? `Rp ${Math.round(pulsa.hariIni.omzet).toLocaleString("id-ID")}` : "–" },
            { label: "Pesanan", value: pulsa ? String(pulsa.hariIni.pesanan) : "–" },
            { label: "Tamu duduk", value: tamu ? String(tamu.tamu) : "–" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/6 p-3">
              <div className="text-[10px] uppercase tracking-wide text-white/45">{stat.label}</div>
              <div className="mt-1 truncate text-sm font-bold">{stat.value}</div>
            </div>
          ))}
        </div>
        {tim && (
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/6 p-3 text-xs text-white/70">
            Tim: {tim.hadir} hadir · {tim.terlambat} terlambat · {tim.cuti} cuti
          </div>
        )}

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Perlu keputusan</h3>
        {loading && <div className="rounded-2xl bg-white/6 p-4 text-xs text-white/50">Memuat…</div>}
        {!loading && sections.length === 0 && (
          <div className="rounded-2xl bg-white/6 p-4 text-xs text-white/50">
            Tidak ada yang menunggu keputusan Anda. 🎉
          </div>
        )}
        {sections.map((section) => (
          <div key={section.key} className="mb-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-white/75">{section.label}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold">{section.total}</span>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/6 p-3">
                  <div className="truncate text-sm font-semibold">{item.title}</div>
                  {item.subtitle && <div className="truncate text-[11px] text-white/45">{item.subtitle}</div>}
                  <div className="mt-2 flex gap-1.5">
                    {item.actionable ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void decideLeave(item.id, "approve")}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {busyId === item.id ? "…" : "Setujui"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void decideLeave(item.id, "reject")}
                          className="rounded-lg bg-rose-700 px-3 py-1.5 text-[11px] font-bold transition hover:bg-rose-600 disabled:opacity-50"
                        >
                          Tolak
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onOpenPath(item.href, section.label)}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-semibold transition hover:bg-white/18"
                    >
                      Buka
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

/**
 * Kunci layar — perangkat kasir/tablet sering dipakai bergantian. Membuka
 * kunci = login ulang ke server (bukan sekadar cocokkan string di klien),
 * jadi sesi yang sudah kedaluwarsa ikut ketahuan di sini.
 */
function LockScreen({
  account,
  onUnlock,
  onSwitchUser,
}: {
  account: OsUserAccount;
  onUnlock: () => void;
  onSwitchUser: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password }),
      });
      if (!res.ok) throw new Error("Kata sandi salah");
      setPassword("");
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kata sandi salah");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/80 backdrop-blur-2xl">
      <div className="w-[min(380px,calc(100vw-32px))] text-center text-white">
        <div className="mx-auto mb-4 grid size-20 place-items-center rounded-full bg-accent text-accent-foreground text-2xl font-bold shadow-2xl">
          {account.fullName.slice(0, 1).toUpperCase()}
        </div>
        <div className="text-lg font-semibold">{account.fullName}</div>
        <div className="mt-1 text-sm text-white/55">{account.email}</div>
        <form onSubmit={submit} className="mt-6">
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Kata sandi"
            className="h-12 w-full rounded-2xl border border-white/18 bg-white/10 px-4 text-center text-base outline-none placeholder:text-white/40 focus:border-pink-200/60"
          />
          {error && <div className="mt-2 text-sm text-rose-300">{error}</div>}
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-3 h-12 w-full rounded-2xl bg-pink-600 text-sm font-semibold transition hover:bg-pink-500 disabled:opacity-50"
          >
            {busy ? "Membuka…" : "Buka Kunci"}
          </button>
        </form>
        <button
          type="button"
          onClick={onSwitchUser}
          className="mt-4 text-sm text-white/55 underline-offset-4 transition hover:text-white hover:underline"
        >
          Ganti user
        </button>
      </div>
    </div>
  );
}

function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <WindowShell title="Pintasan Papan Ketik" onClose={onClose} className="left-1/2 top-24 w-[min(460px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-5">
        <p className="mb-3 text-xs text-white/50">
          Kombinasi sengaja menghindari pintasan yang dipakai browser (⌘W menutup tab, ⌘Tab pindah aplikasi).
        </p>
        <div className="space-y-1.5">
          {SHORTCUT_HINTS.map((hint) => (
            <div key={hint.combo} className="flex items-center justify-between rounded-xl bg-white/6 px-3 py-2 text-sm">
              <span className="text-white/75">{hint.label}</span>
              <kbd className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono text-xs">{hint.combo}</kbd>
            </div>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

function AboutArkiv({ onClose }: { onClose: () => void }) {
  return (
    <WindowShell title={`About ${BRAND}`} onClose={onClose} className="left-1/2 top-24 w-[min(420px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-6 text-center">
        <div className={`mx-auto mb-4 grid size-16 place-items-center rounded-3xl ${brandTile}`}><MonitorDot className="size-8" /></div>
        <h2 className="text-xl font-semibold">{BRAND}</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">Desktop portal untuk HRIS, Procurement, POS, CRM, dan Do.</p>
        <div className="mt-5 rounded-2xl bg-white/8 p-3 text-xs text-white/50">Version 1.0 · macOS-inspired shell</div>
      </div>
    </WindowShell>
  );
}

function DesktopContextMenu({ x, y, onWallpaper, onWidgets, onApps, onSettings, onAbout }: { x: number; y: number; onWallpaper: () => void; onWidgets: () => void; onApps: () => void; onSettings: () => void; onAbout: () => void }) {
  return (
    <div className="fixed z-[80] w-52 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 p-1 text-sm shadow-2xl backdrop-blur-xl" style={{ left: x, top: y }}>
      <button onClick={onApps} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Open Launchpad</button>
      <button onClick={onWidgets} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Widgets</button>
      <button onClick={onSettings} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">System Settings</button>
      <button onClick={onWallpaper} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Change Wallpaper</button>
      <button onClick={onAbout} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">About {BRAND_OS}</button>
    </div>
  );
}

function ContextMenu({ x, y, module, onOpen, onInfo }: { x: number; y: number; module: DesktopModule; onOpen: () => void; onInfo: () => void }) {
  return (
    <div className="fixed z-[80] w-44 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 p-1 text-sm shadow-2xl backdrop-blur-xl" style={{ left: x, top: y }}>
      <button disabled={module.disabled} onClick={onOpen} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50">Open</button>
      <button onClick={onInfo} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">View Info</button>
      <button className="block w-full rounded-xl px-3 py-2 text-left text-white/45">Pin to Dock</button>
    </div>
  );
}
