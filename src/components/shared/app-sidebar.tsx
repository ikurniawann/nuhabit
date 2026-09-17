"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Moon, Monitor, Sun } from "lucide-react";
import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  BuildingStorefrontIcon,
  ChevronDownIcon,
  ComputerDesktopIcon,
  KeyIcon,
  UserCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { ActivityLogBell } from "@/components/layout/ActivityLogBell";
import { NotificationBell } from "@/components/hris/NotificationBell";
import { useThemeOrNull } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  CanUseCentralCashierProvider,
  useConfirmAndSwitchStall,
} from "@/components/pos/confirm-stall-switch-dialog";
import { PosNfcShell } from "@/features/pos/nfc";
import { isPosImmersiveShell } from "@/features/pos/tablet-mode";
import { PosTabletManifestLink } from "@/features/pos/components/pos-tablet-manifest-link";
import type { NavItem } from "@/lib/iam/types";
import { isEssOnlyRole } from "@/lib/iam/access";
import AppSidebarNav from "./app-sidebar-nav";
import { DashboardBreadcrumbs } from "./dashboard-breadcrumbs";

export interface SidebarUser {
  full_name: string;
  role: string;
  email?: string;
  company_name?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  warehouse_name?: string | null;
  active_stall_id?: string | null;
  can_switch_stall?: boolean;
  can_central_checkout?: boolean;
  has_central_cashier_menu?: boolean;
}

export interface AppSidebarProps {
  user: SidebarUser;
  navItems: NavItem[];
  /** Kebijakan ESS-only hasil resolusi IAM di server; fallback ke role kode. */
  essOnly?: boolean;
  children: React.ReactNode;
}

/** Tinggi bar atas desktop — sidebar header & navbar utama harus sama agar border sejajar */
const DESKTOP_TOP_BAR_HEIGHT = "lg:h-[4.75rem]";

function AppSidebarContent({
  user,
  navItems,
  children,
  posImmersive,
  essOnly: essOnlyProp,
}: AppSidebarProps & { posImmersive: boolean }) {
  const pathname = usePathname();
  // ESS-only: sembunyikan seluruh jalan menuju desktop BCD Coffee OS.
  // Nilai dari server (IAM) diutamakan; fallback kebijakan role di kode.
  const essOnly = essOnlyProp ?? isEssOnlyRole(user.role);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const useActivityNotification = pathname.startsWith("/dashboard/purchasing");
  const canUseCentralCashier =
    user.has_central_cashier_menu === true && user.can_central_checkout === true;

  const closeMobile = () => setMobileOpen(false);

  if (posImmersive) {
    return (
      <CanUseCentralCashierProvider value={canUseCentralCashier}>
        <PosNfcShell>
          <PosTabletManifestLink />
          <div
            className="arkiv-dashboard-theme min-h-screen"
            style={{ background: "var(--page-mesh)" }}
          >
            <main className="min-h-[100dvh] overflow-auto p-2 sm:p-3 md:p-4">{children}</main>
          </div>
        </PosNfcShell>
      </CanUseCentralCashierProvider>
    );
  }

  return (
    <CanUseCentralCashierProvider value={canUseCentralCashier}>
    <PosNfcShell>
    <div
      className="arkiv-dashboard-theme flex min-h-screen print:block print:min-h-0 print:bg-white"
      style={{ background: "var(--page-mesh)" }}
    >
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={closeMobile}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex transform flex-col shadow-xl transition-all duration-200 ease-in-out print:hidden lg:relative lg:z-0 lg:flex lg:shrink-0 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-20" : "lg:w-64"}`}
        style={{
          background: "var(--sidebar-background)",
          color: "var(--sidebar-foreground)",
          borderRight: "1px solid var(--sidebar-border)",
        }}
      >
        <SidebarHeader
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
          companyName={user.company_name}
          branchName={user.branch_name}
          warehouseName={user.warehouse_name}
          canSwitchStall={user.can_switch_stall === true}
          canUseCentralCashier={canUseCentralCashier}
          activeStallId={user.active_stall_id ?? null}
        />

        <AppSidebarNav navItems={navItems} collapsed={collapsed} onNavigate={closeMobile} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <MobileHeader
          navItems={navItems}
          onMenuClick={() => setMobileOpen(true)}
          userName={user.full_name}
          onAccountClick={() => setAccountOpen(true)}
          essOnly={essOnly}
        />

        <div
          className={`hidden items-center justify-between gap-4 px-6 py-3 backdrop-blur-sm print:hidden lg:flex ${DESKTOP_TOP_BAR_HEIGHT} lg:py-0`}
          style={{
            background: "var(--navbar-background)",
            color: "var(--navbar-foreground)",
            borderBottom: "1px solid var(--navbar-border)",
          }}
        >
          <DashboardBreadcrumbs navItems={navItems} className="max-w-[55%]" />
          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            {useActivityNotification ? <ActivityLogBell /> : <NotificationBell />}
            <div className="h-6 w-px bg-gray-200" />
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-primary/20 bg-card px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
              title="Klik untuk melihat akun login"
              aria-label="Buka popup akun login"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {user.full_name?.slice(0, 1).toUpperCase() || "A"}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-700">{user.full_name}</span>
                {user.email && (
                  <span className="block truncate text-xs text-gray-500">{user.email}</span>
                )}
              </span>
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-auto p-4 transition-all duration-200 print:block print:overflow-visible print:p-0 lg:p-6">{children}</main>

        {accountOpen && (
          <AccountPopup
            user={user}
            essOnly={essOnly}
            onClose={() => setAccountOpen(false)}
          />
        )}
      </div>
    </div>
    </PosNfcShell>
    </CanUseCentralCashierProvider>
  );
}

function AppSidebarWithSearch(props: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posImmersive = isPosImmersiveShell(pathname, searchParams);

  return <AppSidebarContent {...props} posImmersive={posImmersive} />;
}

export default function AppSidebar(props: AppSidebarProps) {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-dvh w-full"
          style={{ background: "var(--page-mesh)" }}
          aria-hidden
        />
      }
    >
      <AppSidebarWithSearch {...props} />
    </Suspense>
  );
}

function SidebarHeader({
  collapsed,
  onToggleCollapse,
  companyName,
  branchName,
  warehouseName,
  canSwitchStall,
  canUseCentralCashier,
  activeStallId,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  companyName?: string | null;
  branchName?: string | null;
  warehouseName?: string | null;
  canSwitchStall: boolean;
  canUseCentralCashier: boolean;
  activeStallId: string | null;
}) {
  return (
    <div
      className={`group/header relative flex shrink-0 items-center backdrop-blur-sm ${
        collapsed ? "justify-center px-2 py-3.5" : "px-3 py-4"
      } ${DESKTOP_TOP_BAR_HEIGHT} lg:py-0`}
      style={{ borderBottom: "1px solid var(--sidebar-border)" }}
    >

      {collapsed ? (
        <div className="flex w-full flex-col items-center justify-center gap-1">
          <img
            src="/logos/logo.png?v=bcd"
            alt="BCD Coffee OS"
            className="h-9 w-9 object-contain"
          />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:block"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronDownIcon className="h-4 w-4 rotate-90" />
          </button>
        </div>
      ) : (
        <div className="flex w-full items-center gap-3">
          <img
            src="/logos/logo.png?v=bcd"
            alt="BCD Coffee OS"
            className="h-16 w-auto max-w-[10rem] shrink-0 object-contain object-left"
          />
          <div className="min-w-0 flex-1 leading-tight">
            {canSwitchStall ? (
              <StallSwitcher
                activeStallId={activeStallId}
                canUseCentralCashier={canUseCentralCashier}
              >
                <UserScopeLines
                  companyName={companyName}
                  branchName={branchName}
                  warehouseName={warehouseName}
                  variant="header"
                />
              </StallSwitcher>
            ) : (
              <UserScopeLines
                companyName={companyName}
                branchName={branchName}
                warehouseName={warehouseName}
                variant="header"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileHeader({
  navItems,
  onMenuClick,
  userName,
  onAccountClick,
  essOnly,
}: {
  navItems: NavItem[];
  onMenuClick: () => void;
  userName: string;
  onAccountClick: () => void;
  essOnly: boolean;
}) {
  return (
    <header className="border-b border-gray-200 bg-white print:hidden lg:hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button onClick={onMenuClick} className="shrink-0 rounded-lg p-2 hover:bg-gray-100">
          <Bars3Icon className="h-6 w-6 text-gray-700" />
        </button>
        <button
          onClick={onAccountClick}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-pink-50"
        >
          {userName}
        </button>
        <ThemeToggle />
        {!essOnly && (
          <Link href="/arkiv-os" className="shrink-0 font-semibold text-pink-600">
            Desktop
          </Link>
        )}
      </div>
      <div className="border-t border-gray-100 px-4 py-2">
        <DashboardBreadcrumbs navItems={navItems} />
      </div>
    </header>
  );
}

const THEME_MODES = [
  { value: "light" as const, icon: Sun, label: "Terang" },
  { value: "dark" as const, icon: Moon, label: "Gelap" },
  { value: "auto" as const, icon: Monitor, label: "Auto" },
];

function ThemeToggle() {
  const theme = useThemeOrNull();
  if (!theme) return null;
  const { state, setMode } = theme;
  const currentIdx = THEME_MODES.findIndex((m) => m.value === state.mode);
  const current = THEME_MODES[currentIdx] ?? THEME_MODES[0];
  const next = THEME_MODES[(currentIdx + 1) % THEME_MODES.length];
  const Icon = current.icon;

  return (
    <button
      type="button"
      className="arkiv-theme-toggle rounded-full p-2 text-gray-500 transition-colors hover:bg-pink-50 hover:text-gray-700"
      title={`Tema: ${current.label} — klik untuk ganti`}
      aria-label={`Tema: ${current.label} — klik untuk ganti`}
      onClick={() => setMode(next.value)}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

type StallOption = { id: string; name: string; code: string };

/**
 * Switcher stall di header sidebar — khusus super_admin & admin. Pilihan
 * dibatasi penempatan user (Main Storage = bebas semua stall), disimpan
 * sebagai cookie via /api/auth/active-stall lalu halaman di-reload agar
 * seluruh scope server mengikuti stall terpilih.
 */
function StallSwitcher({
  activeStallId,
  canUseCentralCashier,
  children,
}: {
  activeStallId: string | null;
  canUseCentralCashier: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideAllStallsOption =
    (pathname.includes("/cashier") || pathname.includes("/restaurant")) &&
    !canUseCentralCashier;
  const [stalls, setStalls] = useState<StallOption[] | null>(null);
  const [allAccess, setAllAccess] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const { confirmAndSwitchStall, switching, dialogOpen, dialog } =
    useConfirmAndSwitchStall();
  const stallBusy = switching || dialogOpen;

  async function loadStalls() {
    if (stalls !== null) return;
    try {
      // Pilihan berbasis penempatan user (Main Storage = bebas semua stall).
      const res = await fetch("/api/auth/stall-options");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load stalls");
      setAllAccess(json.data?.all_access !== false);
      setStalls(
        ((json.data?.stalls ?? []) as StallOption[]).map(({ id, name, code }) => ({
          id,
          name,
          code,
        }))
      );
    } catch {
      setLoadFailed(true);
      setStalls([]);
    }
  }

  async function selectStall(warehouseId: string | null) {
    if (stallBusy || warehouseId === activeStallId) return;
    await confirmAndSwitchStall(warehouseId);
  }

  return (
    <>
    <DropdownMenu onOpenChange={(open) => open && loadStalls()}>
      <DropdownMenuTrigger
        className="flex w-full min-w-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-pink-50/80"
        aria-label="Switch stall"
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={36}
        className="!w-64 overflow-hidden rounded-xl p-1.5 shadow-xl"
      >
        {/* Scroll di wrapper dalam (bukan popup) agar radius sudut tidak terpotong scrollbar */}
        <div className="max-h-[min(24rem,calc(100vh-96px))] overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pb-1.5 pt-1 text-xs font-medium text-gray-400">
            Stall
          </DropdownMenuLabel>
          {allAccess && !hideAllStallsOption && (
            <DropdownMenuItem
              disabled={stallBusy}
              onClick={() => selectStall(null)}
              className="gap-2.5 rounded-lg px-2 py-1.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200/70 bg-gray-50 text-gray-500">
                <BuildingStorefrontIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                Semua Stall
              </span>
              {activeStallId === null && <Check className="h-4 w-4 shrink-0 text-pink-600" />}
            </DropdownMenuItem>
          )}
          {hideAllStallsOption && (
            <p className="px-2 pb-1.5 text-[11px] leading-snug text-amber-700/90">
              Di kasir/restaurant wajib pilih satu stall (bukan Semua Stall).
            </p>
          )}
          {stalls === null ? (
            <div className="flex justify-center py-3">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-pink-500" />
            </div>
          ) : loadFailed ? (
            <p className="px-2 py-2 text-xs text-gray-400">Gagal memuat daftar stall</p>
          ) : (
            stalls.map((stall) => (
              <DropdownMenuItem
                key={stall.id}
                disabled={stallBusy}
                onClick={() => selectStall(stall.id)}
                className="gap-2.5 rounded-lg px-2 py-1.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200/70 bg-gray-50 text-gray-500">
                  <BuildingStorefrontIcon className="h-4 w-4" />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800"
                  title={`${stall.name} (${stall.code})`}
                >
                  {stall.name}
                </span>
                {activeStallId === stall.id && (
                  <Check className="h-4 w-4 shrink-0 text-pink-600" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    {dialog}
    </>
  );
}

function UserScopeLines({
  companyName,
  branchName,
  warehouseName,
  compact = false,
  variant = "default",
}: {
  companyName?: string | null;
  branchName?: string | null;
  warehouseName?: string | null;
  compact?: boolean;
  variant?: "default" | "header";
}) {
  // Baris utama: branch; fallback ke company (mis. super_admin tanpa branch).
  const primary = branchName?.trim() || companyName?.trim() || "—";
  const warehouse = warehouseName?.trim() || null;

  if (compact) {
    return (
      <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
        {warehouse ? `${primary} · ${warehouse}` : primary}
      </span>
    );
  }

  if (variant === "header") {
    return (
      <div className="space-y-1">
        <p className="truncate text-[15px] font-bold tracking-tight text-gray-900">
          {primary}
        </p>
        {warehouse && (
          <p className="truncate text-xs font-medium text-gray-600" title={warehouse}>
            {warehouse}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="truncate text-sm font-semibold text-gray-900">{primary}</p>
      {warehouse && (
        <p className="truncate text-xs text-gray-600" title={warehouse}>
          {warehouse}
        </p>
      )}
    </div>
  );
}

function AccountPopup({
  user,
  essOnly,
  onClose,
}: {
  user: SidebarUser;
  essOnly: boolean;
  onClose: () => void;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setLoggingOut(false);
      toast.error("Failed to log out. Please try again.");
    }
  }

  const actionClass =
    "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50";

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-end bg-black/20 p-4 pt-16"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Account</h2>
              <p className="text-xs text-gray-500">Active BCD Coffee OS session</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-3 rounded-xl border border-pink-100 bg-pink-50/70 p-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-pink-600 text-base font-bold text-white">
                {user.full_name?.slice(0, 1).toUpperCase() || "A"}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900">
                  {user.full_name}
                </div>
                {user.email && (
                  <div className="truncate text-xs text-gray-600">{user.email}</div>
                )}
                <div className="mt-1 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold capitalize text-pink-600 ring-1 ring-pink-100">
                  {user.role.replace("_", " ")}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3">
              <UserScopeLines
                companyName={user.company_name}
                branchName={user.branch_name}
                warehouseName={user.warehouse_name}
              />
            </div>

            <div className="mt-3 grid gap-0.5">
              <Link href="/dashboard/me" onClick={onClose} className={actionClass}>
                <UserCircleIcon className="h-5 w-5 text-gray-400" />
                Profile
              </Link>
              <button
                type="button"
                onClick={() => setPasswordOpen(true)}
                className={actionClass}
              >
                <KeyIcon className="h-5 w-5 text-gray-400" />
                Change Password
              </button>
              {!essOnly && (
                <Link href="/arkiv-os" onClick={onClose} className={actionClass}>
                  <ComputerDesktopIcon className="h-5 w-5 text-gray-400" />
                  Desktop
                </Link>
              )}
            </div>

            <div className="mt-2 border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                {loggingOut ? (
                  <Loader2 className="h-5 w-5 animate-spin text-red-400" />
                ) : (
                  <ArrowRightStartOnRectangleIcon className="h-5 w-5 text-red-400" />
                )}
                {loggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Password confirmation does not match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to change password");
      toast.success("Password changed successfully");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogPanel size="xs">
        <DialogPanelForm onSubmit={handleSubmit}>
          <DialogPanelHeader>
            <DialogPanelTitle>Change Password</DialogPanelTitle>
            <DialogPanelDescription>
              Enter your current password, then choose a new one.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Current Password
              </label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                New Password
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Confirm New Password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-10 rounded-lg border-gray-200/80"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-10 gap-2 rounded-lg bg-pink-600 px-4 text-white hover:bg-pink-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving..." : "Save Password"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
