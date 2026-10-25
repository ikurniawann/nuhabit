"use client";

import Link from "next/link";
import { ArrowRight, Check, Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { providerLabel } from "../api";
import { useEmailSettings } from "../hooks";

/** Ringkasan provider email di halaman Integrasi, dengan tautan ke pengaturannya. */
export function EmailSummaryCard() {
  const { data } = useEmailSettings();

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-brand-text">
          <Mail className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold">Email</div>
          <p className="text-xs text-muted-foreground">
            Provider email keluar: Resend atau mailbox Microsoft 365 / Outlook (Graph atau SMTP). Dipakai slip gaji,
            kode masuk member, notifikasi gym, dataroom dan rekrutmen.
          </p>
        </div>
        {data?.configured ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <Check className="size-3" /> {providerLabel(data.resolved)}
          </span>
        ) : null}
      </div>
      <Link
        href="/dashboard/settings/integrations/email"
        className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-text hover:underline"
      >
        Buka pengaturan email <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}
