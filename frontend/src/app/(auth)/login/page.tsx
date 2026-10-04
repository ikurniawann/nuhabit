"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useState, useSyncExternalStore } from "react";
import { signIn } from "@/lib/auth/client";
import { fetchCurrentUser } from "@/hooks/use-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brandName, brandOsName } from "@/lib/branding";
import { OS_PATH } from "@/lib/desktop/deep-link";
import Image from "next/image";

/** Jam login per menit; null di server supaya hidrasi tidak bentrok dengan jam/locale klien. */
function subscribeClock(onTick: () => void) {
  const interval = window.setInterval(onTick, 1000);
  return () => window.clearInterval(interval);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const noClock = () => null;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const requestedRedirect = redirectParam?.startsWith("/dashboard") ? redirectParam : null;
  const requestedModule = searchParams.get("module");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const minute = useSyncExternalStore(subscribeClock, currentMinute, noClock);
  const now = minute === null ? null : new Date(minute * 60_000);
  const formattedTime = now
    ? now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":")
    : "--:--";
  const formattedDate = now
    ? now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })
    : "\u00a0";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
        return;
      }
      const profile = await fetchCurrentUser();

      // Hanya super_admin yang mendarat di desktop NüHabit OS. Semua role lain
      // langsung ke Area Karyawan (/dashboard/me = beranda); redirect yang
      // diminta dihormati hanya bila masih di dalam area /dashboard/me.
      const role = profile?.role;
      let target = requestedRedirect || OS_PATH;
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

  return (
    <main className="min-h-dvh bg-surface p-3 lg:p-4">
      <div
        className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-6xl grid-cols-1 gap-4 transition-opacity duration-500 lg:min-h-[calc(100dvh-2rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
        style={{ opacity: transitioning ? 0 : 1 }}
      >
        {/* Hero: ink + pola merek, wordmark putih, dan kalimat merek (brand guideline). */}
        <section className="relative isolate flex min-h-64 flex-col justify-between overflow-hidden rounded-hero bg-ink p-6 text-on-ink shadow-float lg:p-10">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[url('/brand/pattern.png')] bg-[length:560px_auto] opacity-[0.13] mix-blend-screen"
          />

          <div className="flex items-start justify-between gap-4">
            <Image priority
              src="/brand/wordmark-white.png" width={1200} height={165}
              alt={brandName()}
              draggable={false}
              className="h-auto w-44 select-none lg:w-56"
            />
            <div className="text-right" suppressHydrationWarning>
              <p className="font-display text-2xl leading-none font-semibold tabular-nums">{formattedTime}</p>
              <p className="mt-1 text-xs text-on-ink-muted capitalize">{formattedDate}</p>
            </div>
          </div>

          <div className="mt-12">
            <p className="font-display text-4xl leading-[1.05] font-light tracking-tight lg:text-6xl">
              They say old habits die hard.
            </p>
            <p className="mt-2 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-accent lg:text-6xl">
              Get a New one.
            </p>
            <p className="mt-6 text-sm text-on-ink-muted">{brandOsName()} · operasional bisnis dalam satu akun</p>
          </div>
        </section>

        {/* Form */}
        <section className="flex items-center justify-center py-4">
          <div className="w-full max-w-md rounded-card bg-card p-6 shadow-card sm:p-8">
            <Image priority
              src="/brand/wordmark-black.png" width={1200} height={165}
              alt={brandName()}
              draggable={false}
              className="block h-auto w-36 select-none"
            />
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">
              Masuk<span className="text-brand-text">.</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {requestedModule
                ? `Verifikasi akun untuk membuka ${requestedModule.toUpperCase()}.`
                : "Verifikasi akun untuk masuk ke desktop."}
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Email</span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 pl-11"
                    placeholder="nama@perusahaan.com"
                    autoComplete="email"
                    required
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Kata sandi</span>
                <span className="relative block">
                  <Lock className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pr-12 pl-11"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                    className="absolute top-1/2 right-2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" disabled={loading} className="w-full">
                {loading && <Loader2 className="animate-spin" />}
                {loading ? "Memverifikasi…" : "Masuk"}
              </Button>
            </form>

            <p className="mt-6 text-xs text-muted-foreground">Satu akun, satu sesi aktif.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
