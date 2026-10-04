import { Badge } from "@/components/ui/badge";
import { PO_STATUS_LABELS, PO_STATUS_STYLES } from "@/lib/purchasing/report-ui-po";

export function PoStatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <Badge variant="outline" className={PO_STATUS_STYLES[key] || "border-border bg-muted/50 text-muted-foreground"}>
      {PO_STATUS_LABELS[key] || status}
    </Badge>
  );
}
