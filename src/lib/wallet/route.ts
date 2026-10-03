import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosMenu, type ApiUser } from "@/lib/api/auth";
import { WalletError } from "./server";

export const ok = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status });
export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/**
 * Bungkus handler API dompet admin: gerbang menu IAM, 400 untuk zod /
 * WalletError, 500 dengan pesan aman untuk galat lain.
 */
export function walletRoute<A extends unknown[]>(
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
      if (error instanceof WalletError) return fail(error.message, error.status);
      console.error(`[wallet] ${failMessage}:`, error);
      return fail(failMessage, 500);
    }
  };
}

export const actorOf = (user: ApiUser) => ({ id: user.id, name: user.full_name || "Staf" });
