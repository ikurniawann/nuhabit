import { Badge } from "@/components/ui/badge";

/** Label & warna status entry logbook — konsisten di semua tab. */
export const LOGBOOK_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Menunggu Review",
  reviewed: "Direview",
  rejected: "Ditolak",
};

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  submitted: "bg-blue-50 text-blue-700 border-blue-200",
  reviewed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export function LogbookStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={STATUS_CLASSES[status] ?? STATUS_CLASSES.draft}
    >
      {LOGBOOK_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
