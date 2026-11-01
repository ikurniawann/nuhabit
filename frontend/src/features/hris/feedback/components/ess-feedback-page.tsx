"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useMyFeedback } from "../queries";
import { relationshipLabel } from "../view";
import type { MyFeedbackItem } from "../types";
import { EssFeedbackForm } from "./ess-feedback-form";
import { AssignmentStatusBadge, QueryState } from "./feedback-shared";

/** ESS → Feedback 360°: penilaian yang ditugaskan HR kepada saya. */
export function EssFeedbackPage() {
  const query = useMyFeedback();
  const items = query.data?.data ?? [];
  const total = query.data?.criteria_total ?? 0;
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) return <EssFeedbackForm id={openId} onBack={() => setOpenId(null)} />;

  const todo = items.filter((i) => i.status !== "submitted" && i.status !== "approved").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <UsersRound className="h-6 w-6" /> Feedback 360°
        </h1>
        <p className="text-sm text-muted-foreground">
          Beri penilaian jujur untuk rekan kerja, atasan, bawahan, atau diri sendiri sesuai penugasan HR. Skala 1
          sampai 5 per kriteria.
        </p>
      </div>

      {items.length > 0 ? (
        <p className="text-sm">
          {todo > 0 ? `${todo} penilaian menunggu Anda.` : "Semua penilaian sudah Anda kirim. Terima kasih."}
        </p>
      ) : null}

      <QueryState
        loading={query.isLoading}
        error={query.error}
        empty={items.length === 0 ? "Belum ada penilaian yang ditugaskan kepada Anda di siklus aktif." : undefined}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <FeedbackItemCard key={item.id} item={item} total={total} onOpen={() => setOpenId(item.id)} />
        ))}
      </div>
    </div>
  );
}

function FeedbackItemCard({ item, total, onOpen }: { item: MyFeedbackItem; total: number; onOpen: () => void }) {
  const self = item.relationship_type === "self";
  const name = self ? "Penilaian diri" : (item.employee?.full_name ?? "Karyawan");
  const percent = total ? Math.min(100, Math.round((item.answered / total) * 100)) : 0;
  return (
    <button type="button" onClick={onOpen} className="text-left" aria-label={`Buka penilaian ${name}`}>
      <Card className="h-full transition-colors hover:bg-surface">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">
                {self ? "Diri sendiri" : `Sebagai ${relationshipLabel(item.relationship_type).toLowerCase()}`}
                {item.employee?.department?.name && !self ? ` · ${item.employee.department.name}` : ""}
              </p>
            </div>
            <AssignmentStatusBadge status={item.status} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{item.cycle?.name ?? "Siklus"}</span>
              <span>
                {item.answered}/{total} kriteria
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
              <div className="h-2 rounded-full bg-forest" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tenggat {formatDate(item.due_date ?? item.cycle?.end_date)}
          </p>
        </CardContent>
      </Card>
    </button>
  );
}
