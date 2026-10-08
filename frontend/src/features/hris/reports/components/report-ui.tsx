import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocumentArrowDownIcon } from "@heroicons/react/24/outline";

const REPORT_COLORS = ["#00281a", "#abde67", "#c9a227", "#1c261b", "#daff59", "#203b32", "#eeffb1", "#f3ece2", "#fdfff2"];

export const reportColor = (index: number) => REPORT_COLORS[index % REPORT_COLORS.length];

const STAT_COLORS = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-green-50 text-green-600",
  yellow: "bg-yellow-50 text-yellow-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-purple-50 text-purple-600",
};

export function StatCard({
  title, value, sub, icon, color = "blue",
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  color?: keyof typeof STAT_COLORS;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${STAT_COLORS[color]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
      {icon} {children}
    </h2>
  );
}

export function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="text-xs gap-1 h-7">
      <DocumentArrowDownIcon className="w-3.5 h-3.5" /> CSV
    </Button>
  );
}
