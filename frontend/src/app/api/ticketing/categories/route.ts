import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ensureCategory, listCategories } from "@/lib/ticketing/categories-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  return successResponse(await listCategories(ctx, q));
}, "ticketing.categories.GET");

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const parsed = createCategorySchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Nama kategori wajib diisi");
  const { row, created } = await ensureCategory(ctx, parsed.data.name);
  return created ? successResponse(row, "Kategori ditambahkan") : successResponse(row);
}, "ticketing.categories.POST");
