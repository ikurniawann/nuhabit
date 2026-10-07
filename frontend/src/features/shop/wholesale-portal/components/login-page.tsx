"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useWholesaleLogin, useWholesaleMe } from "../queries";

const INPUT = "h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm outline-none focus:border-forest";

/** /wholesale: masuk dengan email dan kata sandi yang diberikan tim NüHabit. */
export function WholesaleLoginPage() {
  const router = useRouter();
  const me = useWholesaleMe();
  const login = useWholesaleLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (me.data) router.replace("/wholesale/catalog");
  }, [me.data, router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { email: email.trim(), password },
      { onSuccess: () => router.replace("/wholesale/catalog") }
    );
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-card bg-card p-6 shadow-card sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Portal Mitra Wholesale</p>
        <h1 className="mt-1 text-2xl font-bold">
          Masuk<span className="text-forest">.</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Untuk gym mitra dan reseller. Akun dibuat oleh tim NüHabit; hubungi kami bila belum punya.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={INPUT}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Kata sandi
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT}
            />
          </label>
          {login.isError ? (
            <p role="alert" className="rounded-2xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {login.error.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={login.isPending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent-strong text-sm font-semibold text-accent-foreground shadow-glow hover:bg-accent-dark disabled:opacity-60"
          >
            {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Masuk
          </button>
        </form>
      </div>
    </div>
  );
}
