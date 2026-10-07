import { useActivityLog } from "@/contexts/ActivityLogContext";
import { createActivityLogger } from "@/lib/activity-logger";
import type { ActivityLog } from "@/types/activity-log";

type LogMetadata = ActivityLog["metadata"];

/**
 * Activity logger untuk komponen:
 *
 *   const logger = useActivityLogger();
 *   logger.createRawMaterial("Unit Created", "KG", { nama: "Kilogram" });
 *   logger.logStatusChange("PO", "PO Approved", "draft", "approved", id, "PO-001");
 */
export function useActivityLogger() {
  const { addLog } = useActivityLog();
  const logger = createActivityLogger(addLog);

  return {
    ...logger,
    createRawMaterial: (title: string, recordNumber?: string, metadata?: LogMetadata) =>
      logger.logCreate("RAW_MATERIAL", title, undefined, recordNumber, metadata),
    updateRawMaterial: (
      title: string,
      recordNumber?: string,
      changes?: string,
      metadata?: LogMetadata
    ) => logger.logUpdate("RAW_MATERIAL", title, undefined, recordNumber, changes, metadata),
  };
}
