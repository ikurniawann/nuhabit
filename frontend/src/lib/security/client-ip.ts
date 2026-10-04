/**
 * IP klien untuk kunci rate limit dan log audit.
 *
 * Model kepercayaan (deployment: container Docker di belakang Cloudflare
 * Tunnel, lihat .gitlab/deploy-docker.sh dan docs/ARSITEKTUR-SISTEM.md):
 *
 * 1. `cf-connecting-ip`: Cloudflare menimpa header ini di edge dengan IP
 *    asli pengunjung, jadi untuk trafik domain (lewat cloudflared) nilainya
 *    tidak bisa dipalsukan klien. Dipercaya bila ada.
 * 2. Tanpa header itu, request datang langsung ke container lewat IP LAN,
 *    tailscale, atau localhost. Next.js mengisi `x-forwarded-for` dengan IP
 *    socket hanya bila header itu kosong, jadi nilai paling kiri adalah IP
 *    socket ATAU nilai kiriman klien. Ini fallback yang sudah dipakai kode
 *    lama; klien di jalur langsung bisa memalsukannya, sehingga batas per-IP
 *    di jalur itu hanya rem, bukan penjaga. Penjaga utamanya tetap batas
 *    per-akun, per-nomor, atau per-sumber daya yang disimpan di DB.
 *    Klien di jalur langsung juga bisa mengirim `cf-connecting-ip` palsu;
 *    jalur itu hanya terjangkau dari jaringan internal.
 * 3. `x-real-ip` sebagai cadangan terakhir, lalu "unknown".
 */

type HasHeaders = { headers: Headers };

export function clientIpFromHeaders(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function clientIp(request: HasHeaders): string {
  return clientIpFromHeaders(request.headers);
}
