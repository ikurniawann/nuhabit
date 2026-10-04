import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { revokeStaffPass } from "@/lib/ticketing/bands-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const DELETE = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    await revokeStaffPass(ctx, id);
    return successResponse({ id }, "Pairing dicabut — gelang kembali tersedia");
  },
  "ticketing.staff-passes.DELETE"
);
