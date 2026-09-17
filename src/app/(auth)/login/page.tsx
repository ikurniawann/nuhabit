"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import {
  BUILTIN_WALLPAPERS,
  DEFAULT_WALLPAPER,
  WALLPAPER_STORAGE_KEY,
  resolveWallpaper,
  wallpaperBackgroundStyle,
  type WallpaperItem,
} from "@/lib/desktop/wallpapers";

export default function LoginPage() {
  const router = useRouter();
  const db = createBrowserClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  // null sampai mount — hindari hydration mismatch jam/locale SSR vs client
  const [now, setNow] = useState<Date | null>(null);
  const [wallpaper, setWallpaper] = useState(DEFAULT_WALLPAPER.src);
  const [requestedRedirect, setRequestedRedirect] = useState<string | null>(null);
  const [requestedModule, setRequestedModule] = useState<string | null>(null);

  const formattedTime = useMemo(
    () =>
      now
        ? now
            .toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
            .replace(".", ":")
        : "--:--",
    [now]
  );
  const formattedDate = useMemo(
    () =>
      now
        ? now.toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "\u00a0",
    [now]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    setRequestedRedirect(redirect?.startsWith("/dashboard") ? redirect : null);
    setRequestedModule(params.get("module"));

    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    // Wallpaper mengikuti pilihan di desktop Arkiv OS. Login belum punya sesi,
    // jadi id-nya dibaca dari localStorage (ditulis desktop saat user memilih).
    // Wallpaper bawaan resolve langsung; unggahan admin butuh daftar dari
    // /api/desktop/wallpapers (GET-nya publik) untuk memetakan id -> URL.
    const saved = window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
    setWallpaper(resolveWallpaper(saved).src);

    const aborter = new AbortController();
    const isBuiltin = BUILTIN_WALLPAPERS.some((item) => item.id === saved);
    if (saved && !isBuiltin) {
      fetch("/api/desktop/wallpapers", { signal: aborter.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const custom: WallpaperItem[] = Array.isArray(json?.data)
            ? json.data.map((item: WallpaperItem) => ({ ...item, custom: true }))
            : [];
          setWallpaper(resolveWallpaper(saved, custom).src);
        })
        .catch(() => {
          /* offline / 500 — tetap pakai wallpaper bawaan yang sudah dipasang */
        });
    }

    return () => {
      window.clearInterval(interval);
      aborter.abort();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data: authData, error } = await db.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !authData.user?.id) {
        setError(error?.message || "Login failed");
        return;
      }

      const { data: profile } = await db
        .from("users")
        .select("role")
        .eq("id", authData.user.id)
        .single();

      // Hanya super_admin yang mendarat di desktop BCD Coffee OS. Semua role lain
      // langsung ke Area Karyawan (/dashboard/me = beranda); redirect yang
      // diminta dihormati hanya bila masih di dalam area /dashboard/me.
      const role = (profile as { role?: string } | null)?.role;
      let target = requestedRedirect || "/arkiv-os";
      if (role !== "super_admin") {
        target = requestedRedirect?.startsWith("/dashboard/me")
          ? requestedRedirect
          : "/dashboard/me";
      }
      setTransitioning(true);
      window.setTimeout(() => router.replace(target), 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0b1020] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={wallpaperBackgroundStyle(wallpaper)}
      />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-[0.16] transition-transform duration-500 ease-out [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:80px_80px]" />
      <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-cyan-300/14 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-16 size-80 rounded-full bg-pink-400/14 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/10 to-transparent" />

      <section className="relative z-10 flex min-h-dvh flex-col items-center justify-between px-6 py-8 transition-all duration-500" style={{ opacity: transitioning ? 0 : 1, transform: transitioning ? "scale(1.015)" : "scale(1)" }}>
        <div className="w-full text-center">
          <div className="text-[72px] font-semibold leading-none tracking-[-0.08em] drop-shadow-2xl sm:text-[104px]">
            {formattedTime}
          </div>
          <div className="mt-2 text-sm font-medium capitalize tracking-wide text-white/80 sm:text-base">
            {formattedDate}
          </div>
        </div>

        <div className="flex w-full max-w-[420px] flex-col items-center">
          <div className="mb-5 grid size-24 place-items-center rounded-full border border-white/20 bg-white/15 text-3xl font-semibold shadow-2xl backdrop-blur-2xl">
            {email ? email.charAt(0).toUpperCase() : "A"}
          </div>
          <h1 className="text-center text-2xl font-semibold tracking-[-0.03em] drop-shadow-lg">BCD Coffee</h1>
          <p className="mt-1 text-center text-sm text-white/70">
            {requestedModule ? `Verifikasi akun untuk membuka ${requestedModule.toUpperCase()}` : "Verifikasi akun untuk masuk ke desktop"}
          </p>

          <form
            onSubmit={handleLogin}
            className="mt-8 w-full space-y-3 rounded-[28px] border border-white/20 p-4 shadow-2xl"
            style={{
              background: "rgba(10, 10, 18, 0.22)",
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
            }}
          >
            <div className="group relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-black" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/20 pl-11 pr-4 text-sm text-black shadow-lg outline-none transition placeholder:text-gray-600 focus:border-pink-400 focus:ring-4 focus:ring-pink-300/30"
                style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
                placeholder="Email"
                autoComplete="email"
                required
              />
            </div>

            <div className="group relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-black" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-2xl border border-white/20 pl-11 pr-12 text-sm text-black shadow-lg outline-none transition placeholder:text-gray-600 focus:border-pink-400 focus:ring-4 focus:ring-pink-300/30"
                style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-black transition hover:text-gray-700">
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>

            {error && <div className="rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-50 backdrop-blur-xl">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-2xl border border-pink-300/40 bg-pink-600 text-sm font-semibold text-white shadow-2xl shadow-pink-950/30 transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Memverifikasi..." : "Log In"}
            </button>
          </form>
        </div>

        <div className="flex w-full items-center justify-between text-xs text-white/55">
          <span>BCD Coffee Operating System</span>
          <span>Single account session</span>
        </div>
      </section>
    </main>
  );
}
