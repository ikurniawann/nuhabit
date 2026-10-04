import { NextRequest } from "next/server";
import { paginatedResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listBookings } from "@/lib/ticketing/bookings-admin-server";
import { ticketingContext } from "@/lib/ticketing/server";
import { pageMeta, readPage } from "@/lib/ticketing/sql";

// Fase D5 — daftar booking website utk dashboard (loket boleh lihat).

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const sp = request.nextUrl.searchParams;
  const { page, limit } = readPage(sp, 50);
  const { items, total } = await listBookings(ctx, {
    date: sp.get("date") ?? "",
    status: sp.get("status") ?? "",
    q: (sp.get("q") ?? "").trim(),
    page,
    limit,
  });
  return paginatedResponse(items, pageMeta(page, limit, total));
}, "ticketing.bookings.GET");
