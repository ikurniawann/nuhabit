/** Auto QR for POS tables (unique-friendly, max 100 chars). */
export function generateTableQrCode(tableNumber?: string | null): string {
  const suffix = crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();
  const num = String(tableNumber ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return (num ? `TBL-${num}-${suffix}` : `TBL-${suffix}`).slice(0, 100);
}
