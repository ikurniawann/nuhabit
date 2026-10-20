"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { useGymBranches } from "@/features/gym/branches";
import { GYM_KEYS, schedulingApi, WEEKDAYS, type OpenGymHours } from "@/features/gym/scheduling/api";
import { zoneAbbr } from "@/lib/timezone";

type Day = { open: boolean; opens_at: string; closes_at: string };

const DEFAULT_DAY: Day = { open: false, opens_at: "06:00", closes_at: "22:00" };

function toDays(hours: OpenGymHours[]): Day[] {
  return WEEKDAYS.map((_, i) => {
    const h = hours.find((x) => x.weekday === i + 1);
    return h ? { open: true, opens_at: h.opens_at, closes_at: h.closes_at } : DEFAULT_DAY;
  });
}

/**
 * Jam open gym mingguan satu cabang, di zona cabang itu. Tanpa hari yang dibuka, open gym
 * berlaku sepanjang hari selama aturan Open gym aktif.
 */
export function OpenGymHoursCard({ branchId, branchName }: { branchId: string; branchName: string }) {
  const key = [...GYM_KEYS.openGymHours, branchId];
  const hours = useQuery({ queryKey: key, queryFn: () => schedulingApi.openGymHours(branchId) });
  const zone = useGymBranches().data?.branches.find((b) => b.id === branchId)?.timezone;
  return (
    <Card className="gap-0 py-2">
      <h2 className="px-5 pt-3 text-sm font-semibold">Jam open gym · {branchName}</h2>
      <p className="px-5 pb-2 text-xs text-muted-foreground">
        Satu rentang per hari, jam {zoneAbbr(zone)}. Bila tidak ada hari yang dibuka, open gym berlaku sepanjang hari.
      </p>
      {hours.isLoading ? (
        <TableNote>Memuat jam open gym…</TableNote>
      ) : hours.error || !hours.data ? (
        <TableNote tone="danger">{hours.error?.message ?? "Gagal memuat jam open gym"}</TableNote>
      ) : (
        <HoursForm key={JSON.stringify(hours.data.hours)} branchId={branchId} initial={toDays(hours.data.hours)} queryKey={key} />
      )}
    </Card>
  );
}

function HoursForm({ branchId, initial, queryKey }: { branchId: string; initial: Day[]; queryKey: readonly string[] }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(initial);
  const setDay = (i: number, patch: Partial<Day>) => setDays((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const invalid = days.some((d) => d.open && d.closes_at <= d.opens_at);
  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveOpenGymHours(
        branchId,
        days.flatMap((d, i) => (d.open ? [{ weekday: i + 1, opens_at: d.opens_at, closes_at: d.closes_at }] : []))
      ),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh);
      toast.success("Jam open gym disimpan");
    },
    onError: (error) => toast.error("Jam open gym gagal disimpan", { description: error.message }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <ul className="divide-y divide-border/60">
        {days.map((d, i) => (
          <li key={WEEKDAYS[i]} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <label className="flex w-32 items-center gap-2 text-sm">
              <Switch checked={d.open} onCheckedChange={(open) => setDay(i, { open })} aria-label={`Open gym hari ${WEEKDAYS[i]}`} />
              {WEEKDAYS[i]}
            </label>
            {d.open ? (
              <div className="flex items-center gap-2 text-sm">
                <Input
                  type="time"
                  className="w-32"
                  value={d.opens_at}
                  onChange={(e) => setDay(i, { opens_at: e.target.value })}
                  aria-label={`Buka ${WEEKDAYS[i]}`}
                />
                <span className="text-muted-foreground">sampai</span>
                <Input
                  type="time"
                  className="w-32"
                  value={d.closes_at}
                  onChange={(e) => setDay(i, { closes_at: e.target.value })}
                  aria-label={`Tutup ${WEEKDAYS[i]}`}
                  aria-invalid={d.closes_at <= d.opens_at}
                />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Tutup</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-3">
        {invalid && <p className="text-xs text-danger">Jam tutup harus setelah jam buka.</p>}
        <Button type="submit" disabled={invalid || save.isPending}>
          {save.isPending ? "Menyimpan…" : "Simpan jam open gym"}
        </Button>
      </div>
    </form>
  );
}
