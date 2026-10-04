import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { assertRecordInScope } from "@/lib/accounting/route-helpers";
import { getJournalEntry, postJournalEntry } from "@/lib/accounting/journal-entry-store";

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    assertRecordInScope(await getJournalEntry(id), await getApiUserScope(), {
      notFound: "Journal entry tidak ditemukan",
      outOfScope: "Journal entry di luar scope",
    });
    const data = await postJournalEntry(id, user.id);
    return NextResponse.json({ data, message: "Journal entry berhasil diposting" });
  },
  "POST /api/accounting/journal-entries/[id]/post"
);
