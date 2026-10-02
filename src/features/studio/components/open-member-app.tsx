"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

let flag: Promise<boolean> | null = null;
function previewEnabled(): Promise<boolean> {
  flag ??= fetch("/api/studio/member-preview", { cache: "no-store" })
    .then((r) => r.json())
    .then((b) => Boolean(b?.data?.enabled))
    .catch(() => false);
  return flag;
}

/**
 * "Buka Member App" sebagai member (tanpa OTP) — hanya tampil bila server
 * MEMBER_PREVIEW_ENABLED=1. Tab baru dibuka lebih dulu supaya tidak diblokir browser.
 */
export function OpenMemberAppButton({ customerId, label = "Buka Member App", size = "sm" }: { customerId: string; label?: string; size?: "sm" | "default" }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void previewEnabled().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  async function open() {
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`/api/studio/members/${customerId}/member-app`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error ?? "Gagal membuka Member App");
      if (tab) tab.location.href = body.data.url;
      else window.location.href = body.data.url;
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : "Gagal membuka Member App");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size={size} onClick={open} disabled={busy}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />} {label}
    </Button>
  );
}
