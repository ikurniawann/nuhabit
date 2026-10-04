"use client";

import type { CSSProperties } from "react";
import { Moon, Sun } from "lucide-react";
import type { AppearanceTokens } from "@/lib/theme/appearance-tokens";
import { appearanceCssVars } from "@/lib/theme/appearance-tokens";
import { Button } from "@/components/ui/button";
import type { ThemeMode } from "@/lib/theme/theme-state";

const NAV = [
  { label: "Dashboard", active: true },
  { label: "Master Data", active: false },
  { label: "Accounts Receivable", active: false },
  { label: "Cash & Bank", active: false },
];

export function AppearancePreview({
  tokens,
  previewMode,
  onPreviewModeChange,
  companyName,
}: {
  tokens: AppearanceTokens;
  previewMode: Exclude<ThemeMode, "auto">;
  onPreviewModeChange: (mode: Exclude<ThemeMode, "auto">) => void;
  companyName: string | null;
}) {
  const vars = appearanceCssVars(tokens);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Preview Dashboard</p>
        <div className="flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => onPreviewModeChange("light")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
              previewMode === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Sun className="size-3.5" /> Light
          </button>
          <button
            type="button"
            onClick={() => onPreviewModeChange("dark")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
              previewMode === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Moon className="size-3.5" /> Dark
          </button>
        </div>
      </div>

      <div
        data-theme={previewMode}
        className="overflow-hidden rounded-xl border border-border shadow-sm"
        style={vars as CSSProperties}
      >
        <div
          className="flex min-h-[28rem]"
          style={{
            background: "var(--page-mesh)",
            fontFamily: "var(--font-sans-stack)",
            fontSize: "var(--font-size-base)",
            color: "var(--foreground)",
          }}
        >
          <aside
            className="hidden w-44 shrink-0 sm:flex sm:flex-col"
            style={{
              background: "var(--sidebar-background)",
              color: "var(--sidebar-foreground)",
              borderRight: "1px solid var(--sidebar-border)",
            }}
          >
            <div
              className="px-3 py-3 text-xs font-semibold"
              style={{ borderBottom: "1px solid var(--sidebar-border)" }}
            >
              {companyName || "PT NüHabit"}
            </div>
            <nav className="space-y-1 p-2">
              {NAV.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg px-2.5 py-2 text-xs font-medium"
                  style={
                    item.active
                      ? {
                          background: "var(--sidebar-active-background)",
                          color: "var(--sidebar-active-foreground)",
                        }
                      : undefined
                  }
                >
                  {item.label}
                </div>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header
              className="flex items-center justify-between px-4 py-3 text-xs"
              style={{
                background: "var(--navbar-background)",
                color: "var(--navbar-foreground)",
                borderBottom: "1px solid var(--navbar-border)",
              }}
            >
              <span className="font-medium">Dashboard</span>
              <span
                className="rounded-full px-2 py-1"
                style={{
                  background: "var(--sidebar-active-background)",
                  color: "var(--sidebar-active-foreground)",
                }}
              >
                Admin
              </span>
            </header>

            <main className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Revenue", value: "Rp 128jt" },
                  { label: "Invoice", value: "24" },
                  { label: "Outstanding", value: "Rp 18jt" },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border p-3"
                    style={{
                      background: "var(--card)",
                      borderColor: "var(--border)",
                      color: "var(--card-foreground)",
                    }}
                  >
                    <p className="text-[11px] opacity-70">{card.label}</p>
                    <p className="mt-1 text-sm font-semibold">{card.value}</p>
                  </div>
                ))}
              </div>

              <div
                className="rounded-lg border p-3"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <p className="mb-2 text-xs font-medium">Monthly Overview</p>
                <div className="flex h-20 items-end gap-1.5">
                  {[40, 62, 48, 80, 55, 70].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t"
                      style={{
                        height: `${h}%`,
                        background: i % 2 === 0 ? "var(--brand-primary)" : "color-mix(in srgb, var(--brand-primary) 35%, white)",
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="h-7 text-xs">
                  Primary
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  Outline
                </Button>
                <Button size="sm" variant="destructive" className="h-7 text-xs">
                  Destructive
                </Button>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
