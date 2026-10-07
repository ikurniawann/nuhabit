import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { occurrenceActionSchema, runOccurrenceAction } from "@/lib/hris/dept-tasks-repo";
import { readJson, requireUuid, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * PATCH /api/hris/dept-tasks/occurrences/[id] — action done | approve |
 * reject | check_subtask pada satu kemunculan task (lihat lib/hris/dept-tasks-repo).
 */
export const PATCH = apiHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireWorkforceActor();
    const id = requireUuid((await params).id);
    const body = await readJson(req, occurrenceActionSchema);
    return NextResponse.json(await runOccurrenceAction(actor, id, body));
  },
  "hris/dept-tasks/occurrences PATCH"
);
