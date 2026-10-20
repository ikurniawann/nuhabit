"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { metricInput, METRICS, parseMetricInput, type Assessment, type MetricKey } from "@/lib/gym/assessments";
import { SELECT } from "@/features/gym/shared";
import { wibDay } from "@/features/gym/scheduling/api";
import { COACHING_KEYS, coachingApi, type AssessmentInput, type PtMemberHit } from "../api";
import { MemberPicker } from "./member-picker";

const GROUPS = [
  { key: "body", title: "Metrik tubuh" },
  { key: "hyrox", title: "Benchmark HYROX", hint: "Waktu ditulis menit:detik, mis. 4:05." },
] as const;

/**
 * Catat atau ubah asesmen. Tanpa customerId staf memilih member dulu. Coach
 * kosong saat mencatat = coach yang terhubung ke akun staf.
 */
export function AssessmentDialog({
  customerId,
  assessment,
  onClose,
  onSaved,
}: {
  customerId?: string;
  assessment?: Assessment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const coaches = useQuery({ queryKey: COACHING_KEYS.coaches(true), queryFn: () => coachingApi.coaches(true), retry: false });
  const [member, setMember] = useState<PtMemberHit | null>(null);
  const memberId = customerId ?? assessment?.customer_id ?? member?.id ?? "";
  const [form, setForm] = useState(() => ({
    assessed_on: assessment?.assessed_on ?? wibDay(new Date()),
    coach_id: assessment?.coach_id ?? "",
    notes: assessment?.notes ?? "",
    goals: assessment?.goals ?? "",
  }));
  const [values, setValues] = useState<Record<MetricKey, string>>(
    () => Object.fromEntries(METRICS.map((m) => [m.key, metricInput(m, assessment?.[m.key] ?? null)])) as Record<MetricKey, string>
  );

  const parsed = Object.fromEntries(METRICS.map((m) => [m.key, parseMetricInput(m.kind, values[m.key])])) as Record<
    MetricKey,
    number | null | undefined
  >;
  const invalid = METRICS.filter((m) => parsed[m.key] === undefined);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        customer_id: memberId,
        coach_id: form.coach_id || null,
        assessed_on: form.assessed_on,
        notes: form.notes.trim(),
        goals: form.goals.trim(),
        ...parsed,
      } as AssessmentInput;
      return assessment ? coachingApi.updateAssessment(assessment.id, input) : coachingApi.createAssessment(input);
    },
    onSuccess: () => {
      toast.success(assessment ? "Asesmen diperbarui" : "Asesmen dicatat");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Asesmen gagal disimpan", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (memberId && invalid.length === 0) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{assessment ? "Ubah asesmen" : "Catat asesmen kebugaran"}</DialogPanelTitle>
            <DialogPanelDescription>
              Isi metrik yang diukur saja. Member melihat riwayat dan grafik progresnya di aplikasi.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-5">
            {!customerId && !assessment && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Member</p>
                {member ? (
                  <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{member.name ?? "Tanpa nama"}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{member.phone}</span>
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMember(null)}>
                      Ganti
                    </Button>
                  </div>
                ) : (
                  <MemberPicker onPick={setMember} />
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tanggal asesmen">
                <Input
                  type="date"
                  max={wibDay(new Date())}
                  value={form.assessed_on}
                  onChange={(e) => setForm({ ...form, assessed_on: e.target.value })}
                  required
                />
              </Field>
              <Field label="Coach">
                <select className={SELECT} value={form.coach_id} onChange={(e) => setForm({ ...form, coach_id: e.target.value })}>
                  <option value="">{assessment ? "Tanpa coach" : "Coach akun saya (bila ada)"}</option>
                  {(coaches.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {GROUPS.map((g) => (
              <fieldset key={g.key} className="space-y-3">
                <legend className="text-sm font-semibold">{g.title}</legend>
                {"hint" in g && <p className="text-xs text-muted-foreground">{g.hint}</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {METRICS.filter((m) => m.group === g.key).map((m) => (
                    <Field key={m.key} label={m.unit ? `${m.label} (${m.unit})` : m.label}>
                      <Input
                        inputMode={m.kind === "seconds" ? "text" : "decimal"}
                        value={values[m.key]}
                        aria-invalid={parsed[m.key] === undefined}
                        placeholder={m.kind === "seconds" ? "m:ss" : "-"}
                        onChange={(e) => setValues((cur) => ({ ...cur, [m.key]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
            ))}
            {invalid.length > 0 && (
              <p className="text-sm text-danger">Periksa isian: {invalid.map((m) => m.label).join(", ")}.</p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Catatan coach">
                <textarea
                  className={TEXTAREA}
                  maxLength={2000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <Field label="Target">
                <textarea
                  className={TEXTAREA}
                  maxLength={1000}
                  value={form.goals}
                  onChange={(e) => setForm({ ...form, goals: e.target.value })}
                  placeholder="Contoh: sub 90 menit di HYROX Jakarta"
                />
              </Field>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!memberId || invalid.length > 0 || save.isPending}>
              Simpan asesmen
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
