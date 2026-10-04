"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CountBadge } from "@/components/ui/count-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNavLinkActive } from "@/lib/iam/nav-active";
import { flattenNavLeaves } from "@/lib/iam/nav-leaves";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import type { NavItem } from "@/lib/iam/types";
import { cn } from "@/lib/utils";
import { AppSidebarNavIcon } from "./app-sidebar-nav-icons";
import { NavLink, useNavigate } from "./nav-link";

interface AppSidebarNavProps {
  navItems: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

/**
 * Href ESS yang otomatis ditandai "sudah dilihat" begitu dibuka, sehingga
 * badge pembaruannya langsung hilang tanpa aksi tambahan dari karyawan.
 * Kunci map = href, nilai = nama modul di API.
 */
const ESS_SEEN_ON_VISIT: Record<string, string> = {
  "/dashboard/me/cuti": "leaves",
  "/dashboard/me/lembur": "overtime",
  "/dashboard/me/pinjaman": "loans",
};

function navItemKey(item: NavItem): string {
  return `${item.href}::${item.label}`;
}

function collectActiveGroupKeys(
  items: NavItem[],
  pathname: string,
  navFrom: string | null,
  allLeafHrefs: string[],
  ancestors: string[] = []
): string[] {
  const keys: string[] = [];

  for (const item of items) {
    const selfActive = isNavLinkActive(pathname, item.href, allLeafHrefs, navFrom);
    const childActive = item.children?.some((child) =>
      isNavLinkActive(pathname, child.href, allLeafHrefs, navFrom)
    );
    const itemKey = navItemKey(item);

    if (item.children?.length && (selfActive || childActive)) {
      keys.push(...ancestors, itemKey);
    }

    if (item.children?.length) {
      keys.push(
        ...collectActiveGroupKeys(item.children, pathname, navFrom, allLeafHrefs, [
          ...ancestors,
          itemKey,
        ])
      );
    }
  }

  return keys;
}

function isGroupActive(
  item: NavItem,
  pathname: string,
  navFrom: string | null,
  allLeafHrefs: string[]
): boolean {
  if (!item.children?.length) {
    return isNavLinkActive(pathname, item.href, allLeafHrefs, navFrom);
  }

  return (
    pathname === item.href ||
    item.children.some((child) => isGroupActive(child, pathname, navFrom, allLeafHrefs))
  );
}

/** Menu links on the ink rail: sections with their pages as sub-items. */
export default function AppSidebarNav({
  navItems,
  collapsed = false,
  onNavigate,
  className = "",
}: AppSidebarNavProps) {
  const pathname = usePathname();
  const navigate = useNavigate();
  const navFrom = useNavFrom();
  const allLeafHrefs = useMemo(
    () => flattenNavLeaves(navItems).map((leaf) => leaf.href),
    [navItems]
  );
  const autoExpanded = useMemo(
    () => [...new Set(collectActiveGroupKeys(navItems, pathname, navFrom, allLeafHrefs))],
    [navItems, pathname, navFrom, allLeafHrefs]
  );
  const [expandedMenus, setExpandedMenus] = useState<string[]>(autoExpanded);

  useEffect(() => {
    setExpandedMenus((prev) => [...new Set([...prev, ...autoExpanded])]);
  }, [autoExpanded]);

  /**
   * Badge notifikasi: antrean persetujuan (HR) dan pembaruan pengajuan (ESS).
   * Satu permintaan untuk semua menu; server yang memutuskan angka mana yang
   * boleh dilihat aktor ini.
   */
  const [badges, setBadges] = useState<Record<string, number>>({});
  const loadBadges = useCallback(async () => {
    try {
      const res = await fetch("/api/hris/nav-badges");
      if (!res.ok) return;
      const json = await res.json();
      setBadges(json?.badges ?? {});
    } catch {
      // Badge hiasan — diamkan agar navigasi tetap utuh saat jaringan gagal.
    }
  }, []);

  useEffect(() => {
    // Dimuat ulang tiap pindah halaman agar angkanya menyusul aksi pengguna.
    void loadBadges();
  }, [loadBadges, pathname]);

  // Membuka halaman ESS berarti karyawan sudah melihat pembaruannya.
  useEffect(() => {
    const essModule = ESS_SEEN_ON_VISIT[pathname];
    if (!essModule) return;
    let active = true;
    fetch("/api/hris/nav-badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: essModule }),
    })
      .then(() => {
        if (active) void loadBadges();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname, loadBadges]);

  const toggleMenu = (key: string) => {
    setExpandedMenus((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  /**
   * Total badge sebuah cabang. Tanpa ini, notifikasi pada anak menu tidak
   * terlihat sama sekali selama grupnya masih tertutup.
   */
  const branchBadgeTotal = (item: NavItem): number => {
    if (item.children?.length) {
      return item.children.reduce((sum, child) => sum + branchBadgeTotal(child), 0);
    }
    return item.href ? (badges[item.href] ?? 0) : 0;
  };

  const leafActive = (href: string) => isNavLinkActive(pathname, href, allLeafHrefs, navFrom);

  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };

  const railRow =
    "relative flex w-full items-center gap-3 rounded-2xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 [&_svg]:shrink-0";

  /** Collapsed rail: one icon tile per section; a section opens its pages in a flyout. */
  const renderCollapsed = (item: NavItem) => {
    const active = isGroupActive(item, pathname, navFrom, allLeafHrefs);
    const tileClass = cn(
      railRow,
      "size-11 justify-center",
      active ? "bg-accent text-accent-foreground shadow-glow" : "text-on-ink-muted hover:bg-white/10 hover:text-white"
    );
    const total = branchBadgeTotal(item);
    const badge = total > 0 && (
      <CountBadge count={total} tone="white" className="absolute -top-1 -right-1" />
    );

    if (!item.children?.length) {
      return (
        <NavLink
          key={navItemKey(item)}
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={tileClass}
          title={item.label}
        >
          <AppSidebarNavIcon name={item.icon} isActive={active} className="size-5" />
          <span className="sr-only">{item.label}</span>
          {badge}
        </NavLink>
      );
    }

    const renderFlyoutItems = (items: NavItem[]): React.ReactNode =>
      items.map((child) =>
        child.children?.length ? (
          <DropdownMenuGroup key={navItemKey(child)}>
            <DropdownMenuLabel>{child.label}</DropdownMenuLabel>
            {renderFlyoutItems(child.children)}
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuItem
            key={navItemKey(child)}
            onClick={() => go(child.href)}
            className={cn(leafActive(child.href) && "bg-surface font-semibold")}
          >
            <span className="flex-1 truncate">{child.label}</span>
            <CountBadge count={badges[child.href] ?? 0} />
          </DropdownMenuItem>
        )
      );

    return (
      <DropdownMenu key={navItemKey(item)}>
        <DropdownMenuTrigger className={tileClass} title={item.label} aria-label={item.label}>
          <AppSidebarNavIcon name={item.icon} isActive={active} className="size-5" />
          {badge}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={14} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            {renderFlyoutItems(item.children)}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderItem = (item: NavItem, depth = 0): React.ReactNode => {
    const hasChildren = Boolean(item.children?.length);
    const itemKey = navItemKey(item);

    if (hasChildren) {
      const isExpanded = expandedMenus.includes(itemKey);
      const active = isGroupActive(item, pathname, navFrom, allLeafHrefs);
      const total = branchBadgeTotal(item);
      return (
        <div key={itemKey}>
          <button
            type="button"
            onClick={() => toggleMenu(itemKey)}
            aria-expanded={isExpanded}
            className={cn(
              railRow,
              depth === 0 ? "h-11 px-3" : "h-9 px-3 text-[13px]",
              active || isExpanded ? "text-white" : "text-on-ink-muted hover:bg-white/10 hover:text-white"
            )}
          >
            {depth === 0 && (
              <AppSidebarNavIcon name={item.icon} isActive={active} className="size-5" />
            )}
            <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            {!isExpanded && <CountBadge count={total} tone="white" />}
            <ChevronDown
              className={cn("size-4 opacity-60 transition-transform", isExpanded && "rotate-180")}
            />
          </button>
          {isExpanded && (
            <div
              className={cn(
                "mt-0.5 mb-1 space-y-0.5 border-l border-white/10",
                depth === 0 ? "ml-[22px] pl-3" : "ml-3 pl-3"
              )}
            >
              {item.children!.map((child) => renderItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const active = leafActive(item.href);
    const badgeCount = item.href ? (badges[item.href] ?? 0) : 0;
    const rowClass =
      depth === 0
        ? cn(
            railRow,
            "h-11 px-3",
            active
              ? "bg-accent text-accent-foreground shadow-glow"
              : "text-on-ink-muted hover:bg-white/10 hover:text-white"
          )
        : cn(
            railRow,
            "h-9 rounded-xl px-3 text-[13px]",
            active
              ? "bg-white/10 font-semibold text-white"
              : "text-on-ink-muted hover:bg-white/5 hover:text-white"
          );

    return (
      <NavLink
        key={itemKey}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={rowClass}
      >
        {depth === 0 && <AppSidebarNavIcon name={item.icon} isActive={active} className="size-5" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <CountBadge count={badgeCount} tone="white" />
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Menu utama"
      className={cn(
        "no-scrollbar min-h-0 flex-1 overflow-y-auto",
        collapsed ? "flex flex-col items-center gap-1.5 px-2 py-2" : "space-y-1 px-3 py-2",
        className
      )}
    >
      {collapsed ? navItems.map(renderCollapsed) : navItems.map((item) => renderItem(item, 0))}
    </nav>
  );
}
