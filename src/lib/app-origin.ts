/**
 * Origin publik aplikasi untuk tautan absolut (redirect pembayaran, link WA,
 * email). NEXT_PUBLIC_APP_URL bila diset (NEXT_PUBLIC_BASE_URL dibaca sebagai
 * nama lama); tanpa itu origin request, karena deployment juga diakses lewat
 * IP LAN, tunnel, dan tailscale. Tanpa request dan tanpa konfigurasi hasilnya
 * "" (tautan relatif). Tanpa garis miring akhir.
 */
export function appOrigin(request?: { nextUrl: { origin: string } } | null): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return (configured || request?.nextUrl.origin || "").replace(/\/+$/, "");
}
