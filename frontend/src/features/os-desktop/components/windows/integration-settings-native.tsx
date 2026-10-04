"use client";

import { Camera, Command, CreditCard, Gamepad2, Plug, ShieldCheck } from "lucide-react";
import { brandOsName } from "@/lib/branding";

const FOLDERS = [
  { label: "Game", icon: Gamepad2, active: true },
  { label: "Photobox", icon: Camera },
  { label: "Payment Gateway", icon: CreditCard },
  { label: "API & Webhook", icon: Plug },
  { label: "Security", icon: ShieldCheck },
  { label: "Keys & Tokens", icon: Command },
];

const INTEGRATIONS = [
  { name: "Game", note: "Arcade machine, topup credit, game session, dan status device", icon: Gamepad2, status: "Not connected" },
  { name: "Photobox", note: "Booking, payment, print queue, dan laporan penjualan photobox", icon: Camera, status: "Not connected" },
  { name: "Payment Gateway", note: "QRIS, kartu kredit, settlement, virtual account, dan webhook", icon: CreditCard, status: "Draft" },
  { name: "API & Webhook", note: "Endpoint callback, event subscription, dan automation trigger", icon: Plug, status: "Draft" },
];

const SETTINGS = ["Auto Sync · Off", "Realtime Events · Off", "Webhook Security · Enabled", "Sandbox Server · Enabled"];

/** Panel native modul Integration (belum terhubung ke kredensial sungguhan). */
export function IntegrationSettingsNative() {
  const brandOs = brandOsName();
  return (
    <div className="flex h-full min-h-[420px]">
      <aside className="w-56 border-r border-white/10 bg-black/12 p-3">
        <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Integration</div>
        {FOLDERS.map((item) => {
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
          Native {brandOs} settings untuk koneksi Game, Photobox, Payment Gateway, API, dan webhook.
        </div>
      </aside>

      <section className="min-w-0 flex-1 p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Integration Center</h2>
            <p className="text-xs text-white/45">{brandOs} · native settings</p>
          </div>
          <button className="rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/12">Add Integration</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground"><Icon className="size-5" /></div>
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
            {SETTINGS.map((setting) => (
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
