"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useWholesaleLogout, useWholesaleMe } from "../queries";

const NAV = [
  { href: "/wholesale/catalog", label: "Catalog" },
  { href: "/wholesale/orders", label: "Orders" },
];

/** Partner portal frame: logo, account name, sign out. Stands alone without the dashboard chrome. */
export function WholesaleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useWholesaleMe();
  const logout = useWholesaleLogout();
  const account = me.data ?? null;

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => router.replace("/wholesale"),
    });

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <header className="bg-card shadow-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href={account ? "/wholesale/catalog" : "/wholesale"} className="flex items-center gap-3">
            <Image src="/brand/wordmark-black.png" alt="NüHabit" width={1200} height={165} className="h-6 w-auto" priority />
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-on-ink">
              Partner
            </span>
          </Link>
          {account ? (
            <div className="flex items-center gap-2 sm:gap-4">
              <nav aria-label="Partner portal" className="flex gap-1">
                {NAV.map((item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                        active ? "bg-ink text-on-ink" : "text-body hover:bg-surface-2"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">{account.company_name}</p>
                <p className="text-xs text-muted-foreground">{account.contact_name}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                disabled={logout.isPending}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
