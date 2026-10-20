"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { gymCreditsApi, type GymRules, type RulesAdmin } from "../api";

const RULES_KEY = ["gym-credits", "rules"];
const GLOBAL = "global";

type RuleKey = keyof GymRules;
type RuleField =
  | { key: RuleKey; kind: "number"; label: string; unit: string; hint: string; min: number }
  | { key: RuleKey; kind: "policy"; label: string; hint: string }
  | { key: RuleKey; kind: "boolean"; label: string; hint: string };

const SECTIONS: { title: string; fields: RuleField[] }[] = [
  {
    title: "Kredit",
    fields: [
      { key: "creditExpiryDays", kind: "number", label: "Masa berlaku kredit bonus", unit: "hari", hint: "Untuk kredit bonus dan penyesuaian. Paket memakai masa berlakunya sendiri.", min: 1 },
      { key: "lowBalanceThreshold", kind: "number", label: "Ambang saldo menipis", unit: "kredit", hint: "Saldo di bawah atau sama dengan ini memicu pengingat beli paket.", min: 0 },
      { key: "expiryReminderDays", kind: "number", label: "Pengingat kedaluwarsa", unit: "hari", hint: "Member diingatkan sebelum kreditnya hangus.", min: 1 },
    ],
  },
  {
    title: "Booking & pembatalan",
    fields: [
      { key: "bookingOpensDaysBefore", kind: "number", label: "Booking dibuka", unit: "hari sebelum kelas", hint: "Jadwal lebih jauh dari ini belum bisa dibooking.", min: 0 },
      { key: "bookingClosesMinBefore", kind: "number", label: "Booking ditutup", unit: "menit sebelum kelas", hint: "0 = sampai kelas mulai.", min: 0 },
      { key: "classReminderMinutes", kind: "number", label: "Pengingat kelas", unit: "menit sebelum kelas", hint: "Member yang booking diingatkan lewat aplikasi, WhatsApp, dan email. 0 = tanpa pengingat.", min: 0 },
      { key: "scheduleHorizonDays", kind: "number", label: "Horizon jadwal", unit: "hari ke depan", hint: "Template jadwal membuat sesi sejauh ini. Maksimal 90 hari.", min: 1 },
      { key: "cancellationDeadlineHours", kind: "number", label: "Batas batal gratis", unit: "jam sebelum kelas", hint: "Batal setelah ini dihitung batal terlambat.", min: 0 },
      { key: "lateCancelPolicy", kind: "policy", label: "Batal terlambat", hint: "Hangus: kredit tidak kembali. Gratis: kredit dikembalikan." },
      { key: "noShowPolicy", kind: "policy", label: "Tidak hadir (no-show)", hint: "Hangus: kredit tidak kembali. Gratis: kredit dikembalikan." },
      { key: "maxConcurrentBookings", kind: "number", label: "Batas booking aktif", unit: "kelas mendatang", hint: "Berlaku juga untuk pemegang pass. 0 = tanpa batas.", min: 0 },
      { key: "maxBookingsPerDay", kind: "number", label: "Batas booking per hari", unit: "kelas", hint: "Dihitung per hari kalender WIB. 0 = tanpa batas.", min: 0 },
    ],
  },
  {
    title: "Waitlist",
    fields: [
      { key: "waitlistAutoPromote", kind: "boolean", label: "Naikkan waitlist otomatis", hint: "Kursi yang kosong langsung diisi member teratas di waitlist yang masih memenuhi syarat." },
      { key: "waitlistPromoteCutoffMin", kind: "number", label: "Batas promosi otomatis", unit: "menit sebelum kelas", hint: "Lebih dekat dari ini, kursi ditawarkan dan member harus mengonfirmasi.", min: 0 },
      { key: "waitlistOfferMinutes", kind: "number", label: "Masa tawaran kursi", unit: "menit", hint: "Kursi ditahan selama ini. Lewat dari itu, tawaran pindah ke member berikutnya.", min: 5 },
    ],
  },
  {
    title: "Strike pass",
    fields: [
      { key: "strikeLimit", kind: "number", label: "Batas strike", unit: "strike", hint: "Batal terlambat atau tidak hadir dengan pass dihitung satu strike. 0 = strike tidak menangguhkan booking.", min: 0 },
      { key: "strikeWindowDays", kind: "number", label: "Jendela strike", unit: "hari", hint: "Strike dihitung bila terjadi dalam jendela ini.", min: 1 },
      { key: "strikeSuspendDays", kind: "number", label: "Lama penangguhan", unit: "hari", hint: "Member tidak bisa booking selama ini setelah batas strike tercapai.", min: 1 },
    ],
  },
  {
    title: "Pass & membership",
    fields: [
      { key: "maxFreezeDaysPerYear", kind: "number", label: "Jatah bekukan per tahun", unit: "hari", hint: "Total hari pass boleh dibekukan dalam 365 hari. 0 = member tidak bisa membekukan pass.", min: 0 },
      { key: "minFreezeDays", kind: "number", label: "Durasi bekukan minimal", unit: "hari", hint: "Aktif lagi lebih awal tetap memotong jatah sebanyak ini.", min: 1 },
      { key: "renewalLeadDays", kind: "number", label: "Perpanjangan otomatis", unit: "hari sebelum berakhir", hint: "Pass dengan perpanjangan otomatis dibeli ulang sejak H-sekian. Maksimal 30.", min: 0 },
      { key: "renewalRetryCount", kind: "number", label: "Ulang perpanjangan gagal", unit: "kali", hint: "Pembayaran perpanjangan yang gagal atau kedaluwarsa dicoba lagi sebanyak ini. Setelah itu perpanjangan otomatis mati. Maksimal 10.", min: 0 },
      { key: "renewalRetryHours", kind: "number", label: "Jeda ulang perpanjangan", unit: "jam", hint: "Jarak antar percobaan ulang. Member diberi kabar di tiap percobaan.", min: 1 },
      { key: "renewalGraceDays", kind: "number", label: "Masa tenggang perpanjangan", unit: "hari setelah berakhir", hint: "Percobaan ulang masih jalan selama ini setelah pass berakhir. Maksimal 30.", min: 0 },
    ],
  },
  {
    title: "Check-in & gate",
    fields: [
      { key: "qrTtlSec", kind: "number", label: "Umur QR member", unit: "detik", hint: "QR di aplikasi diperbarui setelah waktu ini. Minimal 10 detik.", min: 10 },
      { key: "antiPassbackMin", kind: "number", label: "Anti-passback", unit: "menit", hint: "QR yang sama ditolak bila dipakai masuk lagi dalam jendela ini.", min: 0 },
      { key: "reEntryGraceMin", kind: "number", label: "Grace masuk ulang", unit: "menit", hint: "Keluar-masuk dalam jendela ini tidak dihitung kunjungan baru.", min: 0 },
    ],
  },
];

const POLICY_LABEL = { forfeit: "Hangus", free: "Gratis" } as const;

/** Gym → Aturan Gym: aturan global dan override per cabang. */
export function RulesPage() {
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: gymCreditsApi.rules });
  const [scope, setScope] = useState(GLOBAL);
  const data = rules.data;
  const branch = data?.branches.find((b) => b.id === scope) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Aturan Gym"
        description="Aturan booking, pembatalan, kredit, dan check-in. Cabang mengikuti aturan global kecuali kunci yang di-override."
        actions={
          data && data.branches.length > 0 ? (
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger aria-label="Cakupan aturan" className="min-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL}>Global (semua cabang)</SelectItem>
                {data.branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {Object.keys(b.override).length > 0 ? ` · ${Object.keys(b.override).length} override` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />
      {rules.isLoading ? (
        <Card>
          <TableNote>Memuat aturan…</TableNote>
        </Card>
      ) : rules.error || !data ? (
        <Card>
          <TableNote tone="danger">{rules.error?.message ?? "Gagal memuat aturan"}</TableNote>
        </Card>
      ) : (
        // key: form dimuat ulang saat cakupan atau data tersimpan berganti.
        <RulesForm key={`${scope}:${JSON.stringify(branch?.override ?? data.global)}`} data={data} branch={branch} />
      )}
    </div>
  );
}

function RulesForm({ data, branch }: { data: RulesAdmin; branch: RulesAdmin["branches"][number] | null }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<GymRules>(() => ({ ...data.global, ...(branch?.override ?? {}) }));
  const [overridden, setOverridden] = useState<Set<RuleKey>>(() => new Set(Object.keys(branch?.override ?? {}) as RuleKey[]));

  const save = useMutation({
    mutationFn: () => {
      if (!branch) return gymCreditsApi.saveRules(null, values);
      const patch = Object.fromEntries([...overridden].map((key) => [key, values[key]])) as Partial<GymRules>;
      return gymCreditsApi.saveRules(branch.id, patch);
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(RULES_KEY, fresh);
      toast.success("Aturan disimpan", { description: branch ? branch.name : "Global" });
    },
    onError: (error) => toast.error("Aturan gagal disimpan", { description: error.message }),
  });

  const setValue = <K extends RuleKey>(key: K, value: GymRules[K]) => setValues((cur) => ({ ...cur, [key]: value }));
  const toggleOverride = (key: RuleKey, on: boolean) => {
    setOverridden((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!on) setValue(key, data.global[key]);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {SECTIONS.map((section) => (
        <Card key={section.title} className="gap-0 py-2">
          <h2 className="px-5 pt-3 pb-1 text-sm font-semibold">{section.title}</h2>
          <ul className="divide-y divide-border/60">
            {section.fields.map((field) => {
              const editable = !branch || overridden.has(field.key);
              const changedFromDefault = values[field.key] !== data.defaults[field.key];
              return (
                <li key={field.key} className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {field.label}
                      {!branch && changedFromDefault && (
                        <Badge variant="outline" className="ml-2">
                          Bawaan {formatValue(field, data.defaults[field.key])}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                    {branch && (
                      <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={overridden.has(field.key)}
                          onCheckedChange={(on) => toggleOverride(field.key, on)}
                          aria-label={`Override ${field.label}`}
                        />
                        {overridden.has(field.key) ? "Khusus cabang ini" : `Ikut global (${formatValue(field, data.global[field.key])})`}
                      </label>
                    )}
                  </div>
                  <RuleInput field={field} value={values[field.key]} disabled={!editable} onChange={(v) => setValue(field.key, v as never)} />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        {!branch && (
          <Button type="button" variant="outline" onClick={() => setValues(data.defaults)}>
            <RotateCcw /> Kembalikan bawaan
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Menyimpan…" : branch ? `Simpan aturan ${branch.name}` : "Simpan aturan global"}
        </Button>
      </div>
    </form>
  );
}

function formatValue(field: RuleField, value: GymRules[RuleKey]) {
  if (field.kind === "policy") return POLICY_LABEL[value as keyof typeof POLICY_LABEL];
  if (field.kind === "boolean") return value ? "ya" : "tidak";
  return `${value} ${field.unit}`;
}

function RuleInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: RuleField;
  value: GymRules[RuleKey];
  disabled: boolean;
  onChange: (value: GymRules[RuleKey]) => void;
}) {
  if (field.kind === "boolean") {
    return (
      <div className="flex md:justify-end">
        <Switch checked={Boolean(value)} disabled={disabled} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    );
  }
  if (field.kind === "policy") {
    return (
      <div className="flex gap-2 md:justify-end">
        {(["forfeit", "free"] as const).map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={value === p ? "ink" : "outline"}
            aria-pressed={value === p}
            disabled={disabled}
            onClick={() => onChange(p)}
          >
            {POLICY_LABEL[p]}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 md:justify-end">
      <Input
        type="number"
        min={field.min}
        step={1}
        className="w-28 text-right tabular-nums"
        value={String(value)}
        disabled={disabled}
        aria-label={field.label}
        onChange={(e) => onChange(Math.trunc(Number(e.target.value) || 0))}
      />
      <span className="text-xs text-muted-foreground">{field.unit}</span>
    </div>
  );
}
