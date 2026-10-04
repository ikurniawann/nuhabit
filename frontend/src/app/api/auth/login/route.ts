import { NextResponse } from "next/server";
import { authenticateCredentials, createSession, setSessionCookie } from "@/lib/auth/session";
import { clientIpFrom } from "@/lib/public/rate-limit";
import {
  clearLoginFailures,
  isLoginBlocked,
  normalizeAccountKey,
  recordLoginFailure,
} from "@/lib/auth/login-throttle";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const ip = clientIpFrom(request.headers);
    const account = normalizeAccountKey(email);

    // Rate limit DURABLE (tabel auth.login_attempts) — bertahan melewati
    // restart & konsisten bila multi-instance. Pesan sengaja generik: jangan
    // bocorkan apakah akunnya ada.
    if (await isLoginBlocked(account, ip)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi." },
        { status: 429 }
      );
    }

    const { user, error } = await authenticateCredentials(email, password);
    if (error || !user) {
      await recordLoginFailure(account, ip);
      return NextResponse.json({ error: error?.message ?? "Invalid login credentials" }, { status: 401 });
    }

    // Sukses → bersihkan catatan gagal akun ini supaya salah ketik beberapa
    // kali lalu berhasil tidak menyisakan hitungan menuju blokir.
    await clearLoginFailures(account);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({
      data: {
        user: { id: user.id, email: user.email },
        session: { access_token: token, expires_at: expiresAt.toISOString() },
      },
    });
    setSessionCookie(response, token, expiresAt, request);
    return response;
  } catch (err: unknown) {
    console.error("[auth/login] POST failed:", err);
    const message = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
