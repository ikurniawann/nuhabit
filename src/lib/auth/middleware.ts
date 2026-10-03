import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import {
  rejectionStatus,
  resolveHasSession,
  type SessionValidation,
} from "@/lib/auth/session-gate";

const PUBLIC_AUTH_PREFIXES = [
  // Aset branding statis: dibutuhkan halaman /login dan halaman publik
  // (favicon, logo, manifest PWA) sebelum user punya sesi.
  "/brand/",
  "/manifest-pos.webmanifest",
  // Service worker POS (public/sw.js) — didaftarkan dari halaman kasir; registrasi
  // harus dapat berkas JS-nya langsung, bukan redirect ke /login.
  "/sw.js",
  // Foto produk (public/products) & logo QRIS/GPN (public/qris) dipakai
  // halaman publik self-order meja (EPIC-048) sebelum ada sesi.
  "/products/",
  "/qris/",
  "/arkiv-os",
  "/qa",
  "/login",
  "/portal",
  "/career",
  "/table-order",
  "/photobooth",
  "/api/job-openings/public",
  "/api/portal",
  "/psikotes",
  "/api/psikotes/session",
  "/interview",
  "/api/interview/session",
  "/offer",
  "/api/offer/session",
  "/api/table-order",
  // Webhook GoBiz/GoFood (EPIC-049) — autentikasi token acak di path.
  "/api/integrations/gobiz/webhook/",
  // Foto produk JPEG utk katalog GoFood — diambil server GoBiz tanpa sesi.
  "/api/public/gofood-image/",
  // Webhook bot Telegram notifikasi pesanan — secret di path + header.
  "/api/integrations/telegram/webhook/",
  // Event partner loyalty — autentikasi HMAC + timestamp per partner.
  "/api/integrations/loyalty-events/",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/settings/appearance",
  // Daftar wallpaper desktop Arkiv OS — desktop tampil juga untuk pengunjung.
  "/api/desktop/wallpapers",
  "/api/files",
  "/member",
  "/api/member-portal",
  // Dataroom: halaman & API link berbagi untuk penerima tanpa akun dashboard
  "/share",
  "/api/share",
  "/api/wa/inbound",
  "/api/crm/instagram/webhook",
  "/api/payments/xendit/webhook",
  "/booking",
  "/api/public/booking",
  "/pass",
  "/shop",
  "/api/public/shop",
  // EPIC-050 T-5.3 — form publik CRM (web-to-lead)
  "/public",
  "/api/public/crm/forms",
  // Probe liveness/readiness untuk Docker HEALTHCHECK & load balancer.
  "/api/health",
  "/api/ready",
];

export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_AUTH_PREFIXES.some((route) => pathname.startsWith(route))
  );
}

/**
 * Middleware Edge-compatible — cek keberadaan cookie session saja.
 * Validasi session penuh (DB) dilakukan di API route / server component.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Audit 2026-09-17: dulu gerbang ini hanya cek KEBERADAAN cookie, sehingga
  // "Cookie: arkiv_session=apa_saja" lolos ke route yang tak memvalidasi sesi
  // sendiri. Kini token divalidasi ke DB (indeks unik token_hash, 1 baris).
  // Fail-OPEN hanya bila query melempar (DB gangguan) supaya blip sesaat tidak
  // menendang semua kasir keluar; token palsu tetap ditolak saat DB sehat.
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  let validation: SessionValidation = "invalid";
  if (sessionToken) {
    try {
      const { sessionTokenIsValid } = await import("@/lib/auth/session");
      validation = (await sessionTokenIsValid(sessionToken)) ? "valid" : "invalid";
    } catch (err) {
      // DB gangguan → fail-CLOSED untuk API & mutasi (lihat session-gate),
      // fail-open hanya untuk navigasi halaman GET.
      console.error("[middleware] validasi sesi gagal:", err);
      validation = "db-error";
    }
  }
  const hasSession = resolveHasSession({
    validation,
    pathname,
    method: request.method,
  });
  // EPIC-042: request API dgn Bearer token Open API (arkiv_...) divalidasi DI
  // SINI (proxy Next 16 = Node runtime, DB bisa diakses) — wajib, karena
  // sebagian route lama tidak punya cek sesi sendiri dan mengandalkan gerbang
  // middleware. Token tidak dikenal / scope tidak cocok → 401 sebelum route.
  const bearerMatch =
    pathname.startsWith("/api/") &&
    /^Bearer\s+(arkiv_\S+)$/i.exec(request.headers.get("authorization") ?? "");
  let hasApiBearer = false;
  if (bearerMatch && !hasSession) {
    const { verifyApiTokenRequest } = await import("@/lib/auth/api-token");
    hasApiBearer = await verifyApiTokenRequest(bearerMatch[1], {
      pathname,
      method: request.method,
    });
    if (!hasApiBearer) {
      return NextResponse.json(
        { success: false, error: "Token tidak valid atau scope tidak mengizinkan" },
        { status: 401 }
      );
    }
  }
  const isPublicRoute = isPublicAuthPath(pathname);

  if (!hasSession && !hasApiBearer && !isPublicRoute) {
    if (pathname.startsWith("/api/")) {
      const status = rejectionStatus({ validation, pathname, method: request.method });
      return NextResponse.json(
        {
          success: false,
          error:
            status === 503
              ? "Layanan sedang tidak tersedia, coba lagi"
              : "Authentication required",
        },
        { status }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Deep link (mis. "Buatkan Pesanan" dari WA) → kembali ke halaman itu setelah login.
    if (pathname.startsWith("/dashboard") && !url.searchParams.has("redirect")) {
      url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
    }
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Teruskan pathname ke server component (guard role ESS-only membacanya via
  // `headers()`) — middleware Edge tak punya role, jadi enforcement di layout.
  // x-request-method dipakai pengecekan scope token Open API (EPIC-042).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("x-request-method", request.method);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
