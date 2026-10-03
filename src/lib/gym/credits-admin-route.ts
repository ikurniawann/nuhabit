import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu, type ApiUser } from "@/lib/api/auth";
import { GymCreditError } from "./credits-server";

export const ok = (data: unknown) => NextResponse.json({ success: true, data });
export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/**
 * Bungkus handler API admin kredit/aturan gym: gerbang menu IAM, 400 untuk
 * payload zod yang salah, status GymCreditError apa adanya, 500 aman untuk sisanya.
 */
export function gymAdminRoute<A extends unknown[]>(
  prefixes: readonly string[],
  failMessage: string,
  handler: (user: ApiUser, ...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    const guard = await requirePosMenu(prefixes);
    if (guard.error) return guard.error;
    try {
      return await handler(guard.user, ...args);
    } catch (error) {
      if (error instanceof z.ZodError) return fail(error.issues[0]?.message ?? "Data tidak valid");
      if (error instanceof GymCreditError) return fail(error.message, error.status);
      console.error(`[gym-credits] ${failMessage}:`, error);
      return fail(failMessage, 500);
    }
  };
}

export const uuidParam = z.string().uuid("ID tidak valid");
