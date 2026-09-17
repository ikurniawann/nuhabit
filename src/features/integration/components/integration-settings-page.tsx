import {
  Bell,
  Camera,
  ChevronRight,
  CreditCard,
  Gamepad2,
  Globe2,
  KeyRound,
  Lock,
  Plug,
  Search,
  Server,
  ShieldCheck,
  ToggleLeft,
  Wifi,
  Zap,
} from 'lucide-react';
import { GobizSettingsPanel } from '@/features/gobiz/components/gobiz-settings-panel';

const sidebar = [
  { label: 'Game', icon: Gamepad2, active: true },
  { label: 'Photobox', icon: Camera },
  { label: 'Payment Gateway', icon: CreditCard },
  { label: 'API & Webhook', icon: Plug },
  { label: 'Security', icon: ShieldCheck },
  { label: 'Keys & Tokens', icon: KeyRound },
];

const integrationCards = [
  {
    name: 'Game',
    desc: 'Arcade machine, topup credit, game session, dan status device.',
    icon: Gamepad2,
    color: 'bg-indigo-500',
    status: 'Not Connected',
  },
  {
    name: 'Photobox',
    desc: 'Booking, payment, print queue, dan laporan penjualan photobox.',
    icon: Camera,
    color: 'bg-pink-500',
    status: 'Not Connected',
  },
  {
    name: 'Payment Gateway',
    desc: 'QRIS, kartu kredit, virtual account, settlement, dan webhook.',
    icon: CreditCard,
    color: 'bg-emerald-500',
    status: 'Draft',
  },
  {
    name: 'API & Webhook',
    desc: 'Endpoint callback, event subscription, dan automation trigger.',
    icon: Plug,
    color: 'bg-sky-500',
    status: 'Draft',
  },
];

const rows = [
  { label: 'Auto Sync', desc: 'Sinkronisasi transaksi otomatis saat koneksi tersedia.', icon: Wifi, value: 'Off' },
  { label: 'Realtime Events', desc: 'Kirim event transaksi secara realtime ke layanan eksternal.', icon: Zap, value: 'Off' },
  { label: 'Webhook Security', desc: 'Validasi signature untuk setiap request webhook.', icon: Lock, value: 'On' },
  { label: 'Regional Endpoint', desc: 'Pilih region server untuk latency terbaik.', icon: Globe2, value: 'Asia' },
  { label: 'Notification', desc: 'Kirim notifikasi jika integrasi gagal.', icon: Bell, value: 'On' },
  { label: 'Sandbox Server', desc: 'Mode uji coba sebelum aktivasi production.', icon: Server, value: 'Enabled' },
];

export function IntegrationSettingsPage() {
  return (
    <main className="min-h-screen bg-[#ececf1] text-[#1d1d1f] dark:bg-transparent dark:text-foreground">
      <div className="mx-auto flex min-h-screen max-w-7xl p-4 sm:p-6">
        <div className="flex w-full overflow-hidden rounded-[32px] border border-white/70 bg-white/60 shadow-[0_24px_80px_rgba(0,0,0,.14)] backdrop-blur-2xl">
          {/* Sidebar */}
          <aside className="hidden w-72 shrink-0 border-r border-black/5 bg-white/50 p-4 md:block">
            <div className="mb-4 flex items-center gap-2 px-2">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-300" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" />
              <input
                placeholder="Search"
                className="w-full rounded-xl border border-black/5 bg-black/5 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-black/35 focus:bg-white"
              />
            </div>

            <div className="mb-3 px-2 text-xl font-semibold tracking-tight">Settings</div>
            <nav className="space-y-1">
              {sidebar.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      item.active ? 'bg-[#007aff] text-white shadow-sm' : 'text-black/75 hover:bg-black/5 dark:text-foreground/75 dark:hover:bg-white/10'
                    }`}
                  >
                    <span className={`grid h-7 w-7 place-items-center rounded-lg ${item.active ? 'bg-white/20' : 'bg-white shadow-sm'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <section className="flex-1 overflow-y-auto bg-[#f5f5f7]/80 p-5 dark:bg-white/[0.04] sm:p-8">
            <div className="mx-auto max-w-4xl">
              <div className="mb-6">
                <h1 className="text-4xl font-semibold tracking-tight">Integration</h1>
                <p className="mt-2 text-sm text-black/50">Kelola integrasi BCD Coffee OS dengan layanan eksternal.</p>
              </div>

              {/* Hero Card */}
              <div className="mb-6 overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-black/5">
                <div className="flex items-center gap-5 p-6">
                  <div className="grid h-20 w-20 place-items-center rounded-[24px] bg-gradient-to-br from-pink-400 to-rose-600 text-white shadow-lg shadow-pink-200">
                    <Plug className="h-10 w-10" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-semibold">Integration Center</h2>
                    <p className="mt-1 text-sm leading-6 text-black/55">
                      Hubungkan Game, Photobox, Payment Gateway, API, dan webhook dari satu tempat.
                    </p>
                  </div>
                  <button className="hidden rounded-full bg-[#007aff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#006ee6] sm:block">
                    Add Integration
                  </button>
                </div>
              </div>

              {/* GoBiz / GoFood (EPIC-049) — konfigurasi nyata */}
              <GobizSettingsPanel />

              {/* Integration cards */}
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                {integrationCards.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.name}
                      className="group rounded-[24px] bg-white p-5 text-left shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${item.color} text-white shadow-sm`}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <ChevronRight className="mt-2 h-5 w-5 text-black/25 transition group-hover:translate-x-0.5" />
                      </div>
                      <div className="mt-4 text-lg font-semibold">{item.name}</div>
                      <p className="mt-1 min-h-[48px] text-sm leading-6 text-black/50">{item.desc}</p>
                      <div className="mt-4 inline-flex rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-black/55">{item.status}</div>
                    </button>
                  );
                })}
              </div>

              {/* macOS-style grouped settings */}
              <div className="overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-black/5">
                {rows.map((row, index) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className={`flex items-center gap-4 px-5 py-4 ${index !== rows.length - 1 ? 'border-b border-black/5' : ''}`}>
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#f2f2f7] dark:bg-white/10">
                        <Icon className="h-5 w-5 text-[#007aff]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{row.label}</div>
                        <div className="text-xs text-black/45">{row.desc}</div>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-black/45">
                        <span>{row.value}</span>
                        <ToggleLeft className="h-7 w-7 text-black/25" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
