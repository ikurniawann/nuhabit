"use client";

import { useCallback, useEffect, useReducer, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignIn } from "@/features/member-app/auth/google-sign-in";
import { ApiError, memberApi } from "@/features/member-app/lib/api";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { planPayload, pushSiteEvent } from "../lib/analytics";
import {
  accountTransition,
  initialAccountPhase,
  isCodeAccepted,
  resolveJoinStep,
  type AccountEvent,
  type GoogleIdentity,
  type JoinStep,
  type SessionState,
} from "../lib/join-steps";
import { creditsLabel, validityLabel } from "../lib/plans";
import type { PublicPlan, PublicPlanBranch } from "../types";
import { Container, Section, Tile } from "./site-section";

const STEPS: { key: "akun" | "bayar" | "status"; label: string }[] = [
  { key: "akun", label: "Akun" },
  { key: "bayar", label: "Bayar" },
  { key: "status", label: "Status" },
];

const SESSION_KEY = ["join", "session"] as const;

/**
 * Whether a member session is live. Without the cookie there is nothing to
 * check; with it, /me decides (a 401 means the session expired).
 */
function useMemberSession(hasCookie: boolean): { state: SessionState; markPresent(): void; markAbsent(): void } {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        await memberApi("/me");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return false;
        throw e;
      }
    },
    initialData: hasCookie ? undefined : false,
    retry: false,
    staleTime: Infinity,
  });
  const state: SessionState = query.isPending ? "unknown" : query.data ? "present" : "absent";
  const markPresent = useCallback(() => qc.setQueryData(SESSION_KEY, true), [qc]);
  const markAbsent = useCallback(() => qc.setQueryData(SESSION_KEY, false), [qc]);
  return { state, markPresent, markAbsent };
}

/** The OTP endpoints answer without a data envelope, so the whole body comes back. */
async function postAuth<T extends object>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/member-portal${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { success?: boolean; error?: string }) | null;
  if (!res.ok || !json?.success) throw new ApiError(res.status, json?.error ?? `Permintaan gagal (${res.status})`);
  return json;
}

interface OtpSent {
  dev_bypass: boolean;
}

function CodeField({ code, setCode, devBypass, phone }: { code: string; setCode(code: string): void; devBypass: boolean; phone: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="join-code">Kode OTP WhatsApp</Label>
      <Input
        id="join-code"
        inputMode={devBypass ? "text" : "numeric"}
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(devBypass ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="text-center text-xl tracking-[0.4em]"
      />
      <p className="text-xs text-muted-foreground">
        {devBypass ? "Dev lokal: isi kode dev atau kosongkan." : `Kami mengirim kode 6 digit ke WhatsApp ${phone}.`}
      </p>
    </div>
  );
}

function Stepper({ current }: { current: JoinStep }) {
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      {STEPS.map((step, i) => {
        const active = step.key === current;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px]",
                active ? "bg-ink text-on-ink" : "bg-surface-2 text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={active ? "text-foreground" : "text-muted-foreground"}>{step.label}</span>
            {i < STEPS.length - 1 ? <span aria-hidden className="mx-1 h-px w-6 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function PlanSummary({ plan, branch }: { plan: PublicPlan; branch: PublicPlanBranch | null }) {
  return (
    <Tile className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Paket pilihanmu</p>
          <h2 className="font-display text-xl font-semibold">{plan.name}</h2>
        </div>
        <p className="font-display text-xl font-bold tabular-nums">{formatRupiah(plan.price_idr)}</p>
      </div>
      <ul className="space-y-1 text-sm text-body">
        <li>{creditsLabel(plan)}</li>
        <li>Berlaku {validityLabel(plan.validity_days)} sejak aktif</li>
        <li>{branch ? `Harga cabang ${branch.name}` : "Harga dasar semua cabang"}</li>
      </ul>
    </Tile>
  );
}

function AccountStep({ onSignedIn }: { onSignedIn(): void }) {
  const [phase, dispatch] = useReducer(accountTransition, initialAccountPhase);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const google = "google" in phase ? phase.google : null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const requestRegisterCode = async (): Promise<AccountEvent> => {
    const sent = await postAuth<OtpSent>("/register/otp", { phone });
    return { type: "not_registered", phone, devBypass: sent.dev_bypass };
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setCode("");
      // A Google identity is new to us: register straight away.
      if (google) {
        dispatch(await requestRegisterCode());
        return;
      }
      try {
        const sent = await postAuth<OtpSent>("/otp", { phone });
        dispatch({ type: "otp_sent", phone, devBypass: sent.dev_bypass });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        dispatch(await requestRegisterCode());
      }
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (phase.kind !== "code") return;
    void run(async () => {
      await postAuth("/verify", { phone: phase.phone, code });
      onSignedIn();
    });
  };

  const register = (e: FormEvent) => {
    e.preventDefault();
    if (phase.kind !== "register") return;
    void run(async () => {
      try {
        await postAuth("/register", {
          phone: phase.phone,
          code,
          name: google?.name ?? name,
          email: google?.email ?? email,
          wa_consent: false,
          ...(google ? { google_ticket: google.ticket } : {}),
        });
        onSignedIn();
      } catch (err) {
        // The phone already belongs to a member: sign that member in instead.
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        const sent = await postAuth<OtpSent>("/otp", { phone: phase.phone });
        setCode("");
        dispatch({ type: "otp_sent", phone: phase.phone, devBypass: sent.dev_bypass });
      }
    });
  };

  const onNeedsPhone = useCallback((identity: GoogleIdentity) => dispatch({ type: "google_needs_phone", identity }), []);

  if (phase.kind === "phone") {
    return (
      <form onSubmit={requestCode} className="space-y-4">
        <div>
          <h2 className="font-display text-xl font-semibold">Masuk atau daftar</h2>
          <p className="text-sm text-body">
            {google
              ? `Halo ${google.name}. Tambahkan nomor WhatsApp untuk menyelesaikan pendaftaran.`
              : "Pakai nomor WhatsApp yang aktif. Member lama langsung masuk, member baru kami daftarkan."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="join-phone">Nomor WhatsApp</Label>
          <Input
            id="join-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="08xxxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy || phone.trim().length < 6}>
          {busy ? <LoaderCircle className="animate-spin" /> : null} Kirim kode
        </Button>
        {google ? null : <GoogleSignIn onSignedIn={onSignedIn} onNeedsPhone={onNeedsPhone} text="continue_with" />}
      </form>
    );
  }

  if (phase.kind === "code") {
    return (
      <form onSubmit={verify} className="space-y-4">
        <div>
          <h2 className="font-display text-xl font-semibold">Masukkan kode</h2>
          <p className="text-sm text-body">Nomor {phase.phone} sudah terdaftar sebagai member.</p>
        </div>
        <CodeField code={code} setCode={setCode} devBypass={phase.devBypass} phone={phase.phone} />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !isCodeAccepted(code, phase.devBypass)}>
          {busy ? <LoaderCircle className="animate-spin" /> : null} Masuk
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => dispatch({ type: "back" })}>
          Ganti nomor
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={register} className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Lengkapi data</h2>
        <p className="text-sm text-body">Nomor {phase.phone} belum terdaftar. Isi nama dan email untuk membuat akun member.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="join-name">Nama lengkap</Label>
        <Input id="join-name" autoComplete="name" value={google?.name ?? name} onChange={(e) => setName(e.target.value)} readOnly={Boolean(google)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="join-email">Email</Label>
        <Input
          id="join-email"
          type="email"
          autoComplete="email"
          value={google?.email ?? email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={Boolean(google)}
        />
        {google ? <p className="text-xs text-muted-foreground">Terverifikasi lewat Google.</p> : null}
      </div>
      <CodeField code={code} setCode={setCode} devBypass={phase.devBypass} phone={phase.phone} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || (google?.name ?? name).trim().length < 2 || !isCodeAccepted(code, phase.devBypass)}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : null} Daftar dan lanjut
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => dispatch({ type: "back" })}>
        Ganti nomor
      </Button>
    </form>
  );
}

interface PurchaseStarted {
  id: string;
  invoice_url: string | null;
}

function PayStep({ plan, branch, onSessionLost }: { plan: PublicPlan; branch: PublicPlanBranch | null; onSessionLost(): void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const purchase = await memberApi<PurchaseStarted>("/gym/credits/purchases", {
        method: "POST",
        json: { package_id: plan.id, method: "invoice", branch_id: branch?.id ?? null, source: "site" },
      });
      pushSiteEvent("checkout_start", planPayload(plan, branch?.slug));
      // A free plan settles at once and has no invoice.
      if (!purchase.invoice_url) {
        router.push(`/join/status?purchase=${purchase.id}`);
        return;
      }
      window.location.assign(purchase.invoice_url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onSessionLost();
        return;
      }
      setError(e instanceof Error ? e.message : "Pembayaran belum bisa dimulai. Coba lagi.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Bayar</h2>
        <p className="text-sm text-body">Kamu akan diarahkan ke halaman pembayaran Xendit, lalu kembali ke sini setelah selesai.</p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button size="lg" className="w-full" onClick={() => void pay()} disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : null} Bayar {formatRupiah(plan.price_idr)}
      </Button>
      <p className="text-xs text-muted-foreground">
        Paket aktif begitu pembayaran diterima. Lihat statusnya di{" "}
        <Link href="/member" className="font-semibold text-forest hover:underline dark:text-accent">
          Area Member
        </Link>
        .
      </p>
    </div>
  );
}

/** Steps 1 and 2 of /join for one plan; step 3 lives at /join/status. */
export function JoinCheckout({
  plan,
  branch,
  hasSessionCookie,
}: {
  plan: PublicPlan;
  branch: PublicPlanBranch | null;
  /** Read by the server page; the member area validates the session itself. */
  hasSessionCookie: boolean;
}) {
  const router = useRouter();
  const session = useMemberSession(hasSessionCookie);
  const step = resolveJoinStep(session.state);

  // The step lives in the URL so a reload or the back button lands on the same screen.
  useEffect(() => {
    if (step === "loading") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("step") === step) return;
    params.set("step", step);
    router.replace(`/join?${params}`, { scroll: false });
  }, [step, router]);

  return (
    <Section>
      <Container className="max-w-3xl space-y-8">
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Gabung NüHabit</h1>
          <Stepper current={step} />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <PlanSummary plan={plan} branch={branch} />
          <Tile>
            {step === "loading" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy>
                <LoaderCircle className="size-4 animate-spin" /> Memeriksa sesi member
              </p>
            ) : step === "akun" ? (
              <AccountStep onSignedIn={session.markPresent} />
            ) : (
              <PayStep plan={plan} branch={branch} onSessionLost={session.markAbsent} />
            )}
          </Tile>
        </div>
      </Container>
    </Section>
  );
}
