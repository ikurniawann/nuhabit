import Link from "next/link";
import { Dumbbell, ReceiptText, ScanLine, Users } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import { formatRupiahCompact, formatTime } from "@/lib/format";
import type { ExecutiveDashboard } from "@/lib/dashboard/executive";
import { SectionCard } from "./executive-parts";

export function GymTodayCard({
  gym,
}: {
  gym: NonNullable<ExecutiveDashboard["gym"]>;
}) {
  return (
    <SectionCard
      title="Gym hari ini"
      href="/dashboard/gym/schedule"
      hrefLabel="Jadwal"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Kelas"
          value={gym.kelasHariIni}
          hint={`${gym.waitlistHariIni} di waitlist`}
          icon={<Dumbbell />}
        />
        <StatCard
          label="Kursi terisi"
          value={`${gym.isiKelasPersen}%`}
          hint={`${gym.bookingHariIni} booking`}
          icon={<Users />}
          tone={gym.isiKelasPersen >= 80 ? "accent" : "default"}
        />
        <StatCard
          label="Check-in"
          value={gym.checkinHariIni}
          hint="member masuk kelas"
          icon={<ScanLine />}
          href="/dashboard/gym/checkin"
        />
        <StatCard
          label="Paket terjual · 30 hari"
          value={gym.paketTerjual30Hari}
          hint={`${formatRupiahCompact(gym.pendapatanPaket30Hari)} · ${gym.kreditBeredar} kredit beredar`}
          icon={<ReceiptText />}
          href="/dashboard/gym/credits"
        />
      </div>
      {gym.sesi.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Belum ada kelas terjadwal hari ini.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {gym.sesi.map((s) => {
            const pct =
              s.kapasitas > 0
                ? Math.min(100, Math.round((s.terisi / s.kapasitas) * 100))
                : 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/dashboard/gym/sessions/${s.id}`}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-2.5 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none"
                >
                  <span className="font-display text-sm font-semibold tabular-nums">
                    {formatTime(s.mulai)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {s.kelas}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.coach ?? "Belum ada coach"}
                    </span>
                  </span>
                  <span className="w-28 text-right">
                    <span className="text-xs font-semibold tabular-nums">
                      {s.terisi}/{s.kapasitas}
                      {s.waitlist > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          +{s.waitlist}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          pct >= 100 ? "bg-forest" : "bg-accent",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
