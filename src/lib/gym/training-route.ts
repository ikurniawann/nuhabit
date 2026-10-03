import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu } from "@/lib/api/auth";

export const ok = (data: unknown) => NextResponse.json({ success: true, data });
export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/** Kode galat Postgres untuk unique violation. */
export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505";

/**
 * Bungkus handler API staf gym (latihan, race, insentif): gerbang menu IAM,
 * 400 untuk payload zod yang salah, 500 dengan pesan aman untuk galat lain.
 * Handler menerima id staf yang login sebagai argumen pertama.
 */
export function gymStaffRoute<A extends unknown[]>(
  prefixes: readonly string[],
  failMessage: string,
  handler: (userId: string, ...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    const guard = await requirePosMenu(prefixes);
    if (guard.error) return guard.error;
    try {
      return await handler(guard.userId, ...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const field = error.issues[0]?.path.join(".");
        return fail(field ? `Data tidak valid: ${field}` : "Data tidak valid");
      }
      console.error(`[gym] ${failMessage}:`, error);
      return fail(failMessage, 500);
    }
  };
}

export const uuidParam = z.string().uuid();
