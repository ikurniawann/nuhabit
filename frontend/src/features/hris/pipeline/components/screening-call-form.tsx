"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Circle, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, formatRupiah } from "@/lib/format";
import {
  SALARY_GAP_THRESHOLD,
  parseSalaryInput,
  salaryGap,
} from "@/lib/recruitment/pipeline-stage-rules";
import type { ScreeningPayload } from "../types";
import { RecommendationPicker } from "./stage-panel-parts";

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{children}</div>;
}

/** Toggle 3-keadaan: null (belum ditanya) / true (Ya) / false (Tidak). */
function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-1.5">
        {[
          { v: true, text: "Ya", active: "bg-emerald-600 text-white border-emerald-600" },
          { v: false, text: "Tidak", active: "bg-red-600 text-white border-red-600" },
        ].map((opt) => (
          <button
            key={opt.text}
            type="button"
            onClick={() => onChange(value === opt.v ? null : opt.v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              value === opt.v ? opt.active : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Isian hasil screening call (kontak, minat, gaji, shift, catatan, rekomendasi). */
export function ScreeningCallForm({
  draft,
  expectedSalary,
  onPatch,
}: {
  draft: ScreeningPayload;
  expectedSalary: number | null;
  onPatch: (patch: Partial<ScreeningPayload>) => void;
}) {
  const gap = salaryGap(expectedSalary, draft.confirmed_salary);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => onPatch({ contacted: !draft.contacted })}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
          draft.contacted
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        {draft.contacted ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground/40" />
        )}
        Kandidat sudah dihubungi (screening call)
      </button>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TriToggle
          label="Masih berminat?"
          value={draft.interested}
          onChange={(v) => onPatch({ interested: v })}
        />
        <div>
          <FieldLabel>Ketersediaan mulai kerja</FieldLabel>
          <Input
            value={draft.availability_note ?? ""}
            onChange={(e) => onPatch({ availability_note: e.target.value || null })}
            placeholder="Contoh: 2 minggu lagi / awal Agustus"
            maxLength={200}
            className="text-sm"
          />
        </div>
      </div>

      <div>
        <FieldLabel>Konfirmasi Gaji</FieldLabel>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
            Rp
          </span>
          <Input
            value={draft.confirmed_salary != null ? formatNumber(draft.confirmed_salary) : ""}
            onChange={(e) => onPatch({ confirmed_salary: parseSalaryInput(e.target.value) })}
            inputMode="numeric"
            placeholder="0"
            className="pl-9 text-sm"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            Ekspektasi awal: {expectedSalary ? formatRupiah(expectedSalary) : "—"}
          </span>
          {gap !== null && Math.abs(gap) > SALARY_GAP_THRESHOLD && (
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <TriangleAlert className="size-3" />
              Selisih {gap > 0 ? "+" : "−"}
              {Math.round(Math.abs(gap) * 100)}% dari ekspektasi awal
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TriToggle
          label="Bersedia kerja shift?"
          value={draft.willing_shift}
          onChange={(v) => onPatch({ willing_shift: v })}
        />
        <TriToggle
          label="Bersedia ditempatkan di outlet mana pun?"
          value={draft.willing_placement}
          onChange={(v) => onPatch({ willing_placement: v })}
        />
      </div>

      <div>
        <FieldLabel>Catatan Screening</FieldLabel>
        <Textarea
          value={draft.notes ?? ""}
          onChange={(e) => onPatch({ notes: e.target.value || null })}
          placeholder="Hasil percakapan, kesan, hal yang perlu ditindaklanjuti…"
          rows={3}
          maxLength={2000}
          className="text-sm"
        />
      </div>

      <div>
        <FieldLabel>Rekomendasi</FieldLabel>
        <RecommendationPicker
          value={draft.recommendation}
          onChange={(recommendation) => onPatch({ recommendation })}
        />
      </div>
    </div>
  );
}
