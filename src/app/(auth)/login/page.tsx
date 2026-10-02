"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { brandName } from "@/lib/branding";

export default function LoginPage() {
  const router = useRouter();
  const db = createBrowserClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [requestedRedirect, setRequestedRedirect] = useState<string | null>(null);
  const [requestedModule, setRequestedModule] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    setRequestedRedirect(redirect?.startsWith("/dashboard") ? redirect : null);
    setRequestedModule(params.get("module"));
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

      // Hanya super_admin yang mendarat di desktop OS. Semua role lain
      // langsung ke Area Karyawan (/dashboard/me = beranda); redirect yang
      // diminta dihormati hanya bila masih di dalam area /dashboard/me.
      const role = (profile as { role?: string } | null)?.role;
      let target = requestedRedirect || "/arkiv-os";
      if (role !== "super_admin") {
        // Deep link staf yang diizinkan (akses tetap dijaga layout dashboard):
        // Area Karyawan & layar pesanan self-order dari link WA "Buatkan Pesanan".
        target =
          requestedRedirect?.startsWith("/dashboard/me") ||
          requestedRedirect?.startsWith("/dashboard/pos/self-orders")
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

  const inputClass =
    "h-12 w-full rounded-xl border border-input bg-card pl-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-4 focus:ring-ring/20";

  return (
    <main className="relative grid min-h-dvh bg-background text-foreground lg:grid-cols-[1.05fr_1fr]">
      {/* Panel merek — graphic language "Different Scale" (DESIGN.md §5) */}
      <aside className="relative hidden overflow-hidden bg-nh-forest text-nh-beige lg:flex lg:flex-col lg:justify-between lg:p-12">
        <img
          src="/brand/nuhabit-mark-lime.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-36 -right-40 w-[120%] max-w-none select-none"
        />
        <img src="/brand/logo-white.png" alt={brandName()} className="relative h-7 w-auto self-start" />
        <div className="relative max-w-md pb-40">
          <p className="font-display text-6xl font-light leading-[1.05] tracking-tight text-nh-lime">
            Habits
            <br />
            Start Here.
          </p>
          <p className="mt-5 text-base text-nh-beige/75">
            Kelola kelas, member, dan coach dalam satu tempat.
          </p>
        </div>
      </aside>

      <section
        className="flex min-h-dvh flex-col px-6 py-8 transition-all duration-500 sm:px-12"
        style={{ opacity: transitioning ? 0 : 1, transform: transitioning ? "scale(1.01)" : "scale(1)" }}
      >
        <img src="/brand/logo-forest.png" alt={brandName()} className="h-6 w-auto self-start lg:hidden" />

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-semibold">Masuk</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {requestedModule
              ? `Verifikasi akun untuk membuka ${requestedModule.toUpperCase()}.`
              : "Lanjutkan ke backoffice NüHabit."}
          </p>

          <form onSubmit={handleLogin} className="mt-8 space-y-3">
            <label className="relative block">
              <span className="sr-only">Email</span>
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputClass} pr-4`}
                placeholder="Email"
                autoComplete="email"
                required
              />
            </label>

            <label className="relative block">
              <span className="sr-only">Password</span>
              <Lock className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-12`}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </label>

            {error && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-full bg-nh-forest text-sm font-semibold text-nh-lime transition hover:bg-nh-everglade disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Memverifikasi..." : "Masuk"}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{brandName()} · 2026</span>
          <span>Satu akun, satu sesi</span>
        </div>
      </section>
    </main>
  );
}
