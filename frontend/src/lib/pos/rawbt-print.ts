/** Android Chrome RawBT — ESC/POS via intent (bukan Android Print / PDF). */

const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";

export function isAndroidClient(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  return /Android/i.test(ua);
}

/** True on Android browsers (Chrome tablet/phone) — use RawBT intent. */
export function canUseRawBtPrint(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  return isAndroidClient(ua);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function buildRawBtIntentUrl(bytes: Uint8Array): string {
  return `intent:base64,${bytesToBase64(bytes)}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end;`;
}

/**
 * Send ESC/POS to RawBT on Android Chrome via intent URL.
 * Desktop / iOS return false so callers use Web Serial or HTML popup print.
 */
export function printBytesViaRawBt(bytes: Uint8Array): boolean {
  if (typeof window === "undefined") return false;
  if (bytes.length === 0) return false;
  if (!canUseRawBtPrint()) return false;

  const intentUrl = buildRawBtIntentUrl(bytes);
  try {
    window.location.href = intentUrl;
    return true;
  } catch {
    try {
      window.location.assign(intentUrl);
      return true;
    } catch {
      return false;
    }
  }
}
