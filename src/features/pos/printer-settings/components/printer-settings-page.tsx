"use client";

import { useEffect, useMemo, useState } from "react";
import { Bluetooth, CheckCircle2, Laptop, Loader2, Monitor, Printer, Save, Server, SlidersHorizontal, Tablet, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getPairedThermalCount,
  getThermalBaud,
  getThermalPairingCapability,
  pairThermalPrinter,
  printBytesToPairedThermal,
  setThermalBaud,
  THERMAL_BAUD_OPTIONS,
  type ThermalBaud,
  type ThermalPairingCapability,
} from "@/lib/pos/thermal-serial";
import { encodeEscPosText } from "@/lib/pos/thermal-escpos";
import {
  canUseRawBtPrint,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";

type PrinterMode = "browser" | "local_worker" | "network";

type StationPrinterSetting = {
  station: string;
  label: string;
  enabled: boolean;
  mode: PrinterMode;
  printerName: string;
  endpoint: string;
  copies: number;
};

const STORAGE_KEY = "arkiv-pos-printer-settings-v1";

const DEFAULT_SETTINGS: StationPrinterSetting[] = [
  { station: "kitchen", label: "Kitchen", enabled: true, mode: "browser", printerName: "Kitchen Thermal", endpoint: "", copies: 1 },
  { station: "bar", label: "Bar", enabled: true, mode: "browser", printerName: "Bar Thermal", endpoint: "", copies: 1 },
  { station: "bakery", label: "Bakery", enabled: false, mode: "browser", printerName: "Bakery Thermal", endpoint: "", copies: 1 },
  { station: "dessert", label: "Dessert", enabled: false, mode: "browser", printerName: "Dessert Thermal", endpoint: "", copies: 1 },
];

const MODES: { value: PrinterMode; label: string; icon: typeof Monitor }[] = [
  { value: "browser", label: "Browser Print", icon: Monitor },
  { value: "local_worker", label: "Local Worker", icon: Server },
  { value: "network", label: "Network Printer", icon: Wifi },
];

function loadSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as StationPrinterSetting[];
    return DEFAULT_SETTINGS.map((defaultItem) => ({
      ...defaultItem,
      ...(parsed.find((item) => item.station === defaultItem.station) || {}),
    }));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function PrinterSettingsPage() {
  const [settings, setSettings] = useState<StationPrinterSetting[]>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [pairedCount, setPairedCount] = useState(0);
  const [baud, setBaud] = useState<ThermalBaud>(9600);
  const [pairing, setPairing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [capability, setCapability] = useState<ThermalPairingCapability | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSettings(loadSettings());
      setBaud(getThermalBaud());
      setCapability(getThermalPairingCapability());
      void getPairedThermalCount().then(setPairedCount);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const activeCount = useMemo(() => settings.filter((item) => item.enabled).length, [settings]);

  function updateSetting(station: string, changes: Partial<StationPrinterSetting>) {
    setSaved(false);
    setSettings((current) => current.map((item) => (
      item.station === station ? { ...item, ...changes } : item
    )));
  }

  function saveSettings() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Printer Settings</h1>
          <p className="text-sm text-gray-500">Hubungkan printer Bluetooth kasir sekali, lalu atur printer per station.</p>
        </div>
        <Button onClick={saveSettings} className="gap-2 bg-primary hover:bg-primary/90">
          <Save className="size-4" />
          Simpan Settings
        </Button>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="size-4" />
          Konfigurasi printer tersimpan di device ini.
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bluetooth className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold text-foreground">Printer Bluetooth kasir</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Pairing sekali di laptop Chrome/Edge. Print Struk di kasir laptop itu langsung tanpa preview.
            </p>
          </div>
          <span
            className={`inline-flex w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              capability === "desktop" && pairedCount > 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {capability === "handheld"
              ? "Khusus laptop"
              : capability === "unsupported"
                ? "Tidak tersedia"
                : pairedCount > 0
                  ? "Terhubung"
                  : "Belum terhubung"}
          </span>
        </div>

        <div className="space-y-4 px-5 py-4">
          {!capability ? null : capability === "handheld" ? (
            <div className="flex gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
              <Tablet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground">Tablet tidak bisa tautkan printer Bluetooth</p>
                <p className="mt-1 text-muted-foreground">
                  Chrome di tablet tidak menampilkan perangkat serial/Bluetooth yang kompatibel.
                  Pair printer di Windows/macOS dulu, lalu buka halaman ini di Chrome atau Edge laptop kasir dan klik Hubungkan printer.
                  Di Android + RawBT, Print Struk mengirim ESC/POS langsung ke aplikasi RawBT (bukan screenshot dialog).
                </p>
              </div>
            </div>
          ) : capability === "unsupported" ? (
            <div className="flex gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-4">
              <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-amber-900">Browser ini tidak mendukung print langsung</p>
                <p className="mt-1 text-amber-800/90">
                  Pakai Chrome atau Edge di laptop. Pair printer di Bluetooth OS, lalu hubungkan di sini.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
              <p className="text-sm text-muted-foreground">
                Pair printer di Bluetooth Windows/macOS, lalu tautkan di bawah. Perangkat akan muncul di daftar Chrome.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-40">
                  <label className="text-xs font-medium text-muted-foreground">Baud rate</label>
                  <select
                    value={baud}
                    onChange={(event) => {
                      const next = Number(event.target.value) as ThermalBaud;
                      setBaud(next);
                      setThermalBaud(next);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200/80 bg-white px-3 text-sm text-foreground outline-none ring-1 ring-transparent focus:border-primary/40 focus:ring-primary/30"
                  >
                    {THERMAL_BAUD_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  disabled={pairing}
                  onClick={async () => {
                    if (pairing) return;
                    setPairing(true);
                    try {
                      await pairThermalPrinter();
                      setPairedCount(await getPairedThermalCount());
                      toast.success("Printer Bluetooth terhubung di device ini");
                    } catch (error) {
                      if (error instanceof DOMException && error.name === "NotFoundError") return;
                      toast.error(error instanceof Error ? error.message : "Gagal hubungkan printer");
                    } finally {
                      setPairing(false);
                    }
                  }}
                >
                  {pairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />}
                  Hubungkan printer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing || (pairedCount === 0 && !canUseRawBtPrint())}
                  onClick={async () => {
                    if (testing) return;
                    setTesting(true);
                    try {
                      const bytes = encodeEscPosText(["BCD COFFEE POS", "Test printer OK"]);
                      if (canUseRawBtPrint() && printBytesViaRawBt(bytes)) {
                        toast.success("Test print dikirim ke RawBT");
                        return;
                      }
                      const ok = await printBytesToPairedThermal(bytes);
                      if (!ok) {
                        toast.error("Printer belum terhubung. Klik Hubungkan printer dulu.");
                        return;
                      }
                      toast.success("Test print terkirim");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Test print gagal");
                    } finally {
                      setTesting(false);
                    }
                  }}
                  className="border-gray-200/80"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  Test print
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Printer} label="Station Aktif" value={`${activeCount} station`} />
        <SummaryCard icon={Server} label="Worker Token" value="POS_PRINT_WORKER_TOKEN" />
        <SummaryCard icon={SlidersHorizontal} label="Default Mode" value="Browser Print" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {settings.map((item) => (
          <section key={item.station} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-gray-950">{item.label}</div>
                <div className="text-xs uppercase tracking-normal text-gray-500">{item.station} station</div>
              </div>
              <button
                type="button"
                onClick={() => updateSetting(item.station, { enabled: !item.enabled })}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  item.enabled ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {item.enabled ? "Aktif" : "Nonaktif"}
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500">Mode Printer</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {MODES.map((mode) => {
                    const Icon = mode.icon;
                    const active = item.mode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => updateSetting(item.station, { mode: mode.value })}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                          active
                            ? "border-pink-500 bg-pink-50 text-pink-700"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <Icon className="size-4" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500">Nama Printer</label>
                  <input
                    value={item.printerName}
                    onChange={(event) => updateSetting(item.station, { printerName: event.target.value })}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                    placeholder="Kitchen Thermal"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500">Jumlah Copy</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={item.copies}
                    onChange={(event) => updateSetting(item.station, { copies: Math.max(1, Number(event.target.value) || 1) })}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">Endpoint / IP Printer</label>
                <input
                  value={item.endpoint}
                  onChange={(event) => updateSetting(item.station, { endpoint: event.target.value })}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                  placeholder={item.mode === "network" ? "tcp://192.168.1.50:9100" : "Opsional"}
                />
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-lg border border-pink-100 bg-pink-50 p-4 text-sm text-pink-900">
        <div className="font-bold">Catatan integrasi</div>
        <div className="mt-1 text-pink-800">
          Browser Print bisa dipakai sekarang dari halaman Print Queue. Local Worker memakai token environment
          <span className="font-mono"> POS_PRINT_WORKER_TOKEN </span>
          untuk mengambil job pending dan menandai job sebagai printed setelah printer fisik berhasil mencetak.
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Printer;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="font-bold text-gray-950">{value}</div>
        </div>
      </div>
    </div>
  );
}
