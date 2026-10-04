import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { deactivateDeptTask } from "@/lib/hris/dept-tasks-repo";
import { requireUuid, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * PATCH /api/hris/dept-tasks/[id] — nonaktifkan task. HR bebas; non-HR harus
 * atasan di departemen task tersebut.
 */
export const PATCH = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireWorkforceActor();
    const id = requireUuid((await params).id);
    await deactivateDeptTask(actor, id);
    return NextResponse.json({ message: "Task dinonaktifkan" });
  },
  "hris/dept-tasks/[id] PATCH"
);
