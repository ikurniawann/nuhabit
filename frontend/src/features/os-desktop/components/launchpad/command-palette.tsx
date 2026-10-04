"use client";

import { Activity, Bell, Bot, ChevronRight, Folder, MonitorDot, Search, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { brandName } from "@/lib/branding";
import { useSpotlightSearch } from "../../hooks/use-spotlight-search";
import { filterModules, DESKTOP_MODULES, type DesktopModule } from "../../lib/modules";

type QuickAction = { label: string; subtitle: string; icon: ComponentType<{ className?: string }>; run: () => void };

function ResultRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-white/10">
      <span className="flex items-center gap-3">
        <Icon className="size-5 text-pink-200" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="text-xs text-white/45">{subtitle}</span>
        </span>
      </span>
      <ChevronRight className="size-4 text-white/35" />
    </button>
  );
}

function SectionLabel({ children, className = "pt-2" }: { children: string; className?: string }) {
  return <div className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 ${className}`}>{children}</div>;
}

/** Spotlight (⌘K): data, aksi cepat, dan aplikasi dalam satu daftar. */
export function CommandPalette({
  query,
  setQuery,
  isLoggedIn,
  onClose,
  onOpen,
  onOpenPath,
  onAssistant,
  onNotifications,
  onWallpaper,
  onWidgets,
  onFiles,
  onSettings,
}: {
  query: string;
  setQuery: (value: string) => void;
  isLoggedIn: boolean;
  onClose: () => void;
  onOpen: (module: DesktopModule) => void;
  onOpenPath: (path: string, title: string) => void;
  onAssistant: () => void;
  onNotifications: () => void;
  onWallpaper: () => void;
  onWidgets: () => void;
  onFiles: () => void;
  onSettings: () => void;
}) {
  const { hits, searching } = useSpotlightSearch(query, isLoggedIn);
  const normalized = query.trim().toLowerCase();
  const actions: QuickAction[] = [
    { label: "System Settings", subtitle: "Theme, widgets, sound, account", icon: Settings, run: onSettings },
    { label: `${brandName()} Drive`, subtitle: "Open file explorer", icon: Folder, run: onFiles },
    { label: "Tanya Do", subtitle: "Buka asisten Do", icon: Bot, run: onAssistant },
    { label: "Notification Center", subtitle: "Review alerts and approvals", icon: Bell, run: onNotifications },
    { label: "Widgets", subtitle: "Turn desktop widgets on or off", icon: Activity, run: onWidgets },
    { label: "Change Wallpaper", subtitle: "Open Desktop settings", icon: MonitorDot, run: onWallpaper },
  ].filter((action) => !normalized || `${action.label} ${action.subtitle}`.toLowerCase().includes(normalized));

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto mt-20 max-w-xl overflow-hidden rounded-3xl border border-white/18 bg-slate-950/80 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search className="size-5 text-white/50" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari aplikasi, transaksi, member, produk, karyawan…"
            className="w-full rounded-xl bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-gray-600"
          />
          <kbd className="rounded-md bg-white/10 px-2 py-1 text-[10px] text-white/50">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {searching && <div className="px-3 pt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">Mencari data…</div>}
          {hits.map((group) => (
            <div key={group.source}>
              <SectionLabel>{group.label}</SectionLabel>
              {group.items.map((item) => (
                <button
                  key={`${group.source}-${item.id}`}
                  onClick={() => run(() => onOpenPath(item.href, `${group.label}: ${item.title}`))}
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
          {actions.length > 0 && <SectionLabel>Quick Actions</SectionLabel>}
          {actions.map((action) => (
            <ResultRow key={action.label} icon={action.icon} title={action.label} subtitle={action.subtitle} onClick={() => run(action.run)} />
          ))}
          <SectionLabel className="pt-3">Applications</SectionLabel>
          {filterModules(DESKTOP_MODULES, query).map((module) => (
            <ResultRow key={module.name} icon={module.icon} title={module.name} subtitle={module.subtitle} onClick={() => run(() => onOpen(module))} />
          ))}
        </div>
      </div>
    </div>
  );
}
