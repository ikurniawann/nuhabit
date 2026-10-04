import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, type ApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

export type IdContext = { params: Promise<{ id: string }> };

export const ok = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status });

/** Gerbang menu admin dompet (POS → Dompet). */
export const requireWalletAdmin = () => requireIamMenuPrefix(IAM.posWallet);

/** Validasi zod; galat jadi 400 berisi pesan isu pertama yang dibaca klien. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Data tidak valid");
  return parsed.data;
}

/** Param `[id]` wajib UUID. */
export async function uuidParam(ctx: IdContext): Promise<string> {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw ApiError.badRequest("ID tidak valid");
  return id;
}

export const actorOf = (user: ApiUser) => ({ id: user.id, name: user.full_name || "Staf" });
