"use client";

import { Card } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { formatNumber } from "@/lib/format";
import { percent } from "../csv";
import type { ClassReport } from "../api";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Rata-rata keterisian kelas per hari dan jam mulai (WIB). Satu hue, makin pekat makin penuh. */
export function OccupancyHeatmap({ cells }: { cells: ClassReport["heatmap"] }) {
  if (cells.length === 0) return null;
  const hours = cells.map((c) => c.hour);
  const range = Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => Math.min(...hours) + i);
  const at = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">Keterisian per hari dan jam</h3>
      <p className="text-xs text-muted-foreground">Rata-rata kursi terisi dari kapasitas, menurut jam mulai kelas (WIB).</p>
      <ScrollRegion label="Peta keterisian kelas" className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">Rata-rata keterisian kelas per hari dan jam mulai</caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <span className="sr-only">Hari</span>
              </th>
              {range.map((h) => (
                <th key={h} scope="col" className="px-1 py-1 font-semibold text-muted-foreground">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((name, i) => (
              <tr key={name}>
                <th scope="row" className="pr-2 text-left font-semibold text-muted-foreground">
                  {name}
                </th>
                {range.map((h) => {
                  const cell = at.get(`${i + 1}-${h}`);
                  if (!cell) return <td key={h} className="h-9 min-w-10 rounded-md bg-surface" />;
                  const fill = percent(cell.avg_fill);
                  return (
                    <td
                      key={h}
                      title={`${name} ${String(h).padStart(2, "0")}.00: ${fill}% terisi, ${formatNumber(cell.sessions)} sesi`}
                      className="h-9 min-w-10 rounded-md text-center font-semibold text-foreground tabular-nums"
                      style={{ background: `color-mix(in oklch, var(--color-success) ${Math.round(10 + cell.avg_fill * 45)}%, var(--color-card))` }}
                    >
                      {Math.round(fill)}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </Card>
  );
}
