const BAUD_KEY = "arkiv-pos-thermal-baud";
const DEFAULT_BAUD = 9600;

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};

type SerialApi = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
};

function getSerialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  const serial = (navigator as Navigator & { serial?: SerialApi }).serial;
  return serial ?? null;
}

export function canUseDirectThermalPrint() {
  return Boolean(getSerialApi());
}

export type ThermalPairingCapability = "desktop" | "handheld" | "unsupported";

/** Android/iPad/phone — Web Serial picker usually empty even if API exists. */
export function isHandheldClient(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
  extras?: { maxTouchPoints?: number; platform?: string },
) {
  if (/Android/i.test(ua)) return true;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (/Mobile/i.test(ua) && !/Windows NT/i.test(ua)) return true;
  const platform =
    extras?.platform ?? (typeof navigator === "undefined" ? "" : navigator.platform);
  const touch =
    extras?.maxTouchPoints ?? (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints);
  return platform === "MacIntel" && touch > 1;
}

export function getThermalPairingCapability(): ThermalPairingCapability {
  if (typeof navigator === "undefined") return "unsupported";
  if (isHandheldClient()) return "handheld";
  if (typeof window !== "undefined") {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    if (coarse && noHover) return "handheld";
  }
  if (!getSerialApi()) return "unsupported";
  return "desktop";
}

export const THERMAL_BAUD_OPTIONS = [9600, 19200, 115200] as const;
export type ThermalBaud = (typeof THERMAL_BAUD_OPTIONS)[number];

export function getThermalBaud(): ThermalBaud {
  if (typeof window === "undefined") return DEFAULT_BAUD;
  const raw = Number(window.localStorage.getItem(BAUD_KEY));
  return THERMAL_BAUD_OPTIONS.includes(raw as ThermalBaud) ? (raw as ThermalBaud) : DEFAULT_BAUD;
}

export function setThermalBaud(baud: ThermalBaud) {
  window.localStorage.setItem(BAUD_KEY, String(baud));
}

export async function getPairedThermalCount() {
  const serial = getSerialApi();
  if (!serial) return 0;
  const ports = await serial.getPorts();
  return ports.length;
}

async function writeToPort(port: SerialPortLike, bytes: Uint8Array) {
  const baudRate = getThermalBaud();
  await port.open({ baudRate });
  try {
    if (!port.writable) throw new Error("Printer tidak writable");
    const writer = port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    try {
      await port.close();
    } catch {
      // ignore close race
    }
  }
}

export async function pairThermalPrinter() {
  const capability = getThermalPairingCapability();
  if (capability === "handheld") {
    throw new Error("Tablet/PWA tidak bisa tautkan printer Bluetooth. Pairing hanya di Chrome atau Edge laptop.");
  }
  const serial = getSerialApi();
  if (!serial || capability === "unsupported") {
    throw new Error("Browser ini tidak mendukung print langsung. Pakai Chrome/Edge di laptop.");
  }
  const port = await serial.requestPort();
  await writeToPort(port, Uint8Array.from([0x1b, 0x40]));
}

export async function printBytesToPairedThermal(bytes: Uint8Array): Promise<boolean> {
  const serial = getSerialApi();
  if (!serial) return false;
  const ports = await serial.getPorts();
  const port = ports[0];
  if (!port) return false;
  await writeToPort(port, bytes);
  return true;
}
