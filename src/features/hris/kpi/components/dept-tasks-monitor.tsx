"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import {
  daysLate,
  type DepartmentSummary,
  type MonitorOccurrence,
  type MonitorSummary,
  OCCURRENCE_STATUS_LABEL,
} from "@/lib/hris/dept-task-monitor";

/**
 * Tab Pemantauan Task Departemen (EPIC-068): progres & penyelesaian per
 * departemen dan per penanggung jawab, task terlambat, dan task yang
 * menunggu review. HR melihat semua departemen; lainnya departemennya.
 */

interface MonitorData {
  start: string;
  end: string;
  today: string;
  summary: MonitorSummary;
  departments: DepartmentSummary[];
  overdue: MonitorOccurrence[];
  waiting_review: MonitorOccurrence[];
  is_hr: boolean;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const tgl = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Bar({ value, tone = "bg-primary" }: { value: number | null; tone?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

export function DeptTasksMonitor({ month, departmentId }: { month: string; departmentId: string | null }) {
  const [state, setState] = useState<{ key: string; data?: MonitorData; error?: string } | null>(null);
  const key = `${month}|${departmentId ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ month });
    if (departmentId) params.set("department_id", departmentId);
    apiGet<{ data: MonitorData }>(`/api/hris/dept-tasks/monitor?${params}`)
      .then((r) => !cancelled && setState({ key, data: r.data }))
      .catch((e) => !cancelled && setState({ key, error: e instanceof Error ? e.message : "Gagal memuat pemantauan" }));
    return () => {
      cancelled = true;
    };
  }, [key, month, departmentId]);

  const current = state && state.key === key ? state : null;
  if (!current) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat pemantauan…
        </CardContent>
      </Card>
    );
  }
  if (current.error || !current.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-600">{current.error}</CardContent>
      </Card>
    );
  }
  const d = current.data;
  if (d.departments.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-gray-500">
          Belum ada task departemen pada bulan ini{d.is_hr ? "." : " di departemen Anda."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Jatuh tempo s/d hari ini", value: String(d.summary.due), hint: `${d.summary.scheduled} terjadwal bulan ini` },
          { label: "Penyelesaian", value: pct(d.summary.completion), hint: `${d.summary.approved} disetujui` },
          { label: "Progres rata-rata", value: d.summary.avg_progress === null ? "—" : `${d.summary.avg_progress}%`, hint: `${d.summary.in_progress} sedang dikerjakan` },
          { label: "Terlambat", value: String(d.summary.overdue), hint: "belum selesai lewat tanggal", danger: d.summary.overdue > 0 },
          { label: "Menunggu review", value: String(d.summary.waiting_review), hint: "perlu dicek Head Division" },
        ].map((s) => (
          <Card key={s.label} className={s.danger ? "border-red-200" : undefined}>
            <CardContent className="p-4">
              <p className={`text-2xl font-bold tabular-nums ${s.danger ? "text-red-600" : "text-gray-900"}`}>{s.value}</p>
              <p className="text-xs font-medium text-gray-700">{s.label}</p>
              <p className="text-xs text-gray-400">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dua kolom hanya di layar sangat lebar & bila ada >1 departemen — kartu sempit memotong tabel PJ. */}
      <div className={`grid gap-4 ${d.departments.length > 1 ? "2xl:grid-cols-2" : ""}`}>
        {d.departments.map((dept) => (
          <Card key={dept.department_id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{dept.department_name}</p>
                  <p className="text-xs text-gray-500">
                    {dept.due} jatuh tempo · {dept.approved} disetujui · {dept.waiting_review} tunggu review · {dept.in_progress} dikerjakan
                  </p>
                </div>
                {dept.overdue > 0 ? (
                  <Badge className="bg-red-100 text-red-700">{dept.overdue} terlambat</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700">Tepat waktu</Badge>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-600">
                    <span>Penyelesaian</span>
                    <span className="font-semibold tabular-nums">{pct(dept.completion)}</span>
                  </div>
                  <Bar value={dept.completion === null ? null : dept.completion * 100} tone="bg-green-500" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-600">
                    <span>Progres</span>
                    <span className="font-semibold tabular-nums">{dept.avg_progress === null ? "—" : `${dept.avg_progress}%`}</span>
                  </div>
                  <Bar value={dept.avg_progress} />
                </div>
              </div>
              {/* HP: daftar ringkas per PJ; mulai sm: tabel. */}
              <ul className="divide-y rounded-lg border sm:hidden">
                {dept.assignees.map((a) => (
                  <li key={a.assignee_id ?? "none"} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-gray-800">{a.assignee_name}</span>
                      {a.overdue > 0 ? <Badge className="bg-red-100 text-red-700">{a.overdue} terlambat</Badge> : null}
                    </div>
                    <p className="text-xs text-gray-500">
                      {a.due} jatuh tempo · selesai {pct(a.completion)} · progres {a.avg_progress === null ? "—" : `${a.avg_progress}%`}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="py-1.5 pr-2 font-medium">Penanggung jawab</th>
                      <th className="px-2 py-1.5 text-right font-medium">Jatuh tempo</th>
                      <th className="px-2 py-1.5 text-right font-medium">Selesai</th>
                      <th className="px-2 py-1.5 text-right font-medium">Progres</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Terlambat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dept.assignees.map((a) => (
                      <tr key={a.assignee_id ?? "none"}>
                        <td className="py-1.5 pr-2 text-gray-800">{a.assignee_name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{a.due}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(a.completion)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{a.avg_progress === null ? "—" : `${a.avg_progress}%`}</td>
                        <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${a.overdue > 0 ? "text-red-600" : "text-gray-400"}`}>{a.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <AlertTriangle className="h-4 w-4 text-red-500" /> Task terlambat
          </p>
          {d.overdue.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">Tidak ada task terlambat. 👍</p>
          ) : (
            <ul className="divide-y">
              {d.overdue.map((o) => (
                <li key={o.occurrence_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-12 text-xs tabular-nums text-gray-500">{tgl(o.occurrence_date)}</span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block font-medium text-gray-900">{o.title}</span>
                    <span className="block text-xs text-gray-500">
                      {o.department_name} · PJ {o.assignee_name ?? "departemen"}
                      {o.last_note ? ` · "${o.last_note}"` : ""}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-gray-600">{o.progress}%</span>
                  <Badge className="bg-red-100 text-red-700">terlambat {daysLate(o.occurrence_date, d.today)} hari</Badge>
                  <Badge variant="outline">{OCCURRENCE_STATUS_LABEL[o.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {d.waiting_review.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Clock className="h-4 w-4 text-blue-500" /> Menunggu review Head Division
            </p>
            <ul className="divide-y">
              {d.waiting_review.map((o) => (
                <li key={o.occurrence_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-12 text-xs tabular-nums text-gray-500">{tgl(o.occurrence_date)}</span>
                  <span className="min-w-0 flex-1 basis-40 font-medium text-gray-900">{o.title}</span>
                  <span className="text-xs text-gray-500">
                    {o.department_name} · PJ {o.assignee_name ?? "departemen"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
