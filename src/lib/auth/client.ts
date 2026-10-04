/**
 * Login & logout dari browser lewat /api/auth/*. Profil & role user dibaca
 * terpisah lewat fetchCurrentUser() (/api/auth/me) di src/hooks/use-auth.ts.
 */

/** Masuk dengan email + kata sandi; `error` berisi pesan untuk ditampilkan, null bila berhasil. */
export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return { error: null };
    const text = await res.text();
    let json: { error?: string; message?: string } = {};
    try {
      json = text ? (JSON.parse(text) as typeof json) : {};
    } catch {
      json = { error: text.slice(0, 180) };
    }
    return { error: json.error || json.message || `Login failed (${res.status})` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Login failed" };
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
