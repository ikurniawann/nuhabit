/**
 * Menentukan flag `Secure` cookie dari request, bukan dari NODE_ENV.
 *
 * Sebelumnya `secure: process.env.NODE_ENV === "production"` — nilainya ikut
 * dibekukan saat build, jadi selalu `true` di image produksi. Browser membuang
 * cookie `Secure` pada origin `http://`, dan IP privat (10.20.89.5) tidak bisa
 * punya sertifikat tepercaya dari CA manapun. Akibatnya operasional yang
 * memakai IP jaringan lokal tidak pernah bisa login: halaman tampil, cookie
 * sesi dibuang diam-diam.
 *
 * Aturannya: pertahankan `Secure` kecuali kita tahu pasti request tiba lewat
 * HTTP polos.
 */

/** Host yang hanya bisa dijangkau langsung ke container — selalu HTTP polos. */
function isDirectHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1") return true;
  // IPv4 literal, mis. 10.20.89.5 / 100.107.60.3
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 literal dalam kurung siku, mis. [fd7a:115c::1]
  if (hostname.startsWith("[")) return true;
  return false;
}

/**
 * True bila request sampai ke browser lewat HTTPS.
 *
 * `X-Forwarded-Proto` dipakai lebih dulu — itu yang benar di belakang proxy
 * mana pun (Cloudflare Tunnel, tailscale serve, reverse proxy). Tanpa header
 * itu berarti klien terhubung langsung ke container, yang di deployment ini
 * hanya terjadi lewat IP/localhost dan selalu tanpa TLS.
 *
 * Catatan: `X-Forwarded-Proto` bisa dipalsukan, tapi header kustom tidak dapat
 * disetel lintas-origin oleh halaman penyerang, jadi ini bukan jalur serangan
 * yang bisa diarahkan ke browser korban.
 */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto?.split(",")[0].trim().toLowerCase() === "https") return true;

  // Sengaja OR, bukan else: Next.js menyuntikkan `x-forwarded-proto: http`
  // sendiri saat header itu tidak ada, sehingga cabang pertama tidak bisa
  // membedakan "proxy bilang HTTP" dari "tidak ada proxy sama sekali". Nama
  // domain hanya terjangkau lewat tunnel ber-TLS (tidak ada port 80/443
  // terbuka di server), jadi host non-IP tetap dihitung aman walaupun
  // cloudflared ternyata tidak mengirim X-Forwarded-Proto.
  const hostname = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return !isDirectHost(hostname);
}
