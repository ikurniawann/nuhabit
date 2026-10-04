import type { ComponentType, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircleIcon, ClockIcon, UsersIcon, XCircleIcon } from "@heroicons/react/24/outline";
import type { AnalyticsView } from "@/lib/recruitment/analytics-view";

function SkeletonCard() {
  return <Card><CardContent className="pt-6"><div className="h-20 bg-gray-100 rounded animate-pulse" /></CardContent></Card>;
}

function KpiCard({
  icon: Icon, tone, label, value, hint,
}: {
  icon: ComponentType<{ className?: string }>;
  tone: string;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-400">{hint}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsKpis({ view, loading }: { view: AnalyticsView; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {loading ? (
        [0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)
      ) : (
        <>
          <KpiCard
            icon={ClockIcon}
            tone="bg-indigo-100 text-indigo-600"
            label="Time to Hire"
            value={<>{view.timeToHire.avgDays} <span className="text-sm font-normal text-gray-400">hari</span></>}
            hint={`${view.timeToHire.count} kandidat hired`}
          />
          <KpiCard
            icon={CheckCircleIcon}
            tone="bg-green-100 text-green-600"
            label="Hiring Rate"
            value={`${view.hiringRate}%`}
            hint="Talent Pool → Hired"
          />
          <KpiCard
            icon={UsersIcon}
            tone="bg-blue-100 text-blue-600"
            label="Total Sources"
            value={view.topSources.length}
            hint="portal aktif"
          />
          <KpiCard
            icon={XCircleIcon}
            tone="bg-red-100 text-red-600"
            label="Sulit Diisi"
            value={view.hardToFill.length}
            hint="posisi lama"
          />
        </>
      )}
    </div>
  );
}
