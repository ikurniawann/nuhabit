"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, ShoppingBag, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCartCount } from "../lib/cart-count";
import { TRAINING_NAV } from "../lib/training";
import { useSitePanels } from "./panels";

export const BRAND_NAV = [
  { href: "/training", label: "Training" },
  { href: "/space", label: "The Space" },
  { href: "/brand", label: "Our Story" },
  { href: "/locations", label: "Locations" },
  { href: "/news", label: "News" },
] as const;

export const BUSINESS_NAV = [
  { href: "/apparel", label: "Shop" },
  { href: "/equipment", label: "Equipment" },
  { href: "/career", label: "Careers" },
  { href: "/contact", label: "Contact" },
] as const;

/** The floating bar keeps five links; the rest sit under "More". */
const HEADER_NAV = [
  { href: "/space", label: "The Space" },
  { href: "/locations", label: "Locations" },
  { href: "/apparel", label: "Shop" },
  { href: "/news", label: "News" },
] as const;

const MORE_NAV = [
  { href: "/brand", label: "Our Story" },
  { href: "/equipment", label: "Equipment" },
  { href: "/career", label: "Careers" },
  { href: "/contact", label: "Contact" },
  { href: "/franchise", label: "Own a Gym" },
] as const;

function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="NüHabit, go to the home page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wordmark-black.png" alt="" className="h-6 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wordmark-white.png" alt="" className="hidden h-6 w-auto dark:block" />
    </Link>
  );
}

function NavLinks({ items, current, onNavigate, className }: {
  items: readonly { href: string; label: string }[];
  current: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <>
      {items.map((item) => {
        const active = current === item.href || current.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 whitespace-nowrap transition-colors hover:bg-surface-2",
              active ? "font-semibold text-foreground" : "text-body",
              className,
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function NavMenu({ label, items, active = false }: { label: string; items: readonly { href: string; label: string }[]; active?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-3 py-1.5 whitespace-nowrap transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-forest/40",
          active ? "font-semibold text-foreground" : "text-body",
        )}
      >
        {label} <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader({ memberLinked }: { memberLinked: boolean }) {
  const pathname = usePathname() ?? "/";
  const panels = useSitePanels();
  const cartCount = useCartCount();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountHref = memberLinked ? "/member" : "/member/auth/login";
  const accountLabel = memberLinked ? "Member Area" : "Member login";

  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:px-4">
      <div className="mx-auto flex h-16 items-center gap-3 rounded-2xl bg-card/95 px-4 shadow-float backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:px-5">
        <Wordmark />
        <nav aria-label="Main navigation" className="ml-6 hidden items-center gap-1 text-sm lg:flex">
          <NavMenu label="Training" items={TRAINING_NAV} active={pathname.startsWith("/training")} />
          <NavLinks items={HEADER_NAV} current={pathname} />
          <NavMenu label="More" items={MORE_NAV} />
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href={accountHref}
            aria-label={accountLabel}
            className="inline-flex size-10 items-center justify-center gap-2 rounded-full border border-border text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 sm:size-auto sm:px-4 sm:py-2"
          >
            <UserRound className="size-4" />
            <span className="hidden sm:inline">{accountLabel}</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"}
            onClick={() => panels.open("cart")}
            className="relative"
          >
            <ShoppingBag />
            {cartCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-strong px-1 text-[11px] font-bold text-accent-foreground">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </Button>
          <Button variant="ink" className="hidden uppercase tracking-wide sm:inline-flex lg:hidden xl:inline-flex" onClick={() => panels.open("trial")}>
            Start a Trial
          </Button>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" showCloseButton={false} aria-describedby={undefined}>
          <SheetHeader className="flex-row items-center justify-between">
            <SheetTitle>Menu</SheetTitle>
            <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
              <X />
            </Button>
          </SheetHeader>
          <nav aria-label="Navigation" className="flex flex-col gap-1 overflow-y-auto px-2 text-base">
            <p className="px-3 pt-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Training</p>
            <NavLinks items={TRAINING_NAV} current={pathname} onNavigate={() => setMenuOpen(false)} className="px-3 py-2" />
            <div className="my-2 h-px bg-border" />
            <NavLinks items={HEADER_NAV} current={pathname} onNavigate={() => setMenuOpen(false)} className="px-3 py-2.5" />
            <div className="my-2 h-px bg-border" />
            <NavLinks items={MORE_NAV} current={pathname} onNavigate={() => setMenuOpen(false)} className="px-3 py-2.5 text-sm" />
          </nav>
          <div className="mt-auto flex flex-col gap-2 p-4">
            <Button asChild variant="outline">
              <Link href={accountHref} onClick={() => setMenuOpen(false)}>
                {memberLinked ? accountLabel : "Log in to NüHabit"}
              </Link>
            </Button>
            {memberLinked ? null : (
              <Button asChild variant="ink">
                <Link href="/member/auth/register" onClick={() => setMenuOpen(false)}>
                  Register
                </Link>
              </Button>
            )}
            <Button
              onClick={() => {
                setMenuOpen(false);
                panels.open("trial");
              }}
            >
              Start a Trial
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
