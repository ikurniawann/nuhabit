import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { userHasIamPrefix } from "@/lib/iam/has-menu";

export const crmOk = (data: unknown, message?: string) =>
  NextResponse.json({ success: true, data, ...(message ? { message } : {}) });
export const crmFail = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

/**
 * Bungkus handler API admin CRM: gerbang menu IAM (`prefixes`), 400 untuk
 * payload zod yang salah, 500 dengan pesan aman untuk galat lain. Handler
 * menerima id staf sebagai argumen pertama (untuk jejak audit).
 */
export function crmRoute<A extends unknown[]>(
  prefixes: readonly string[],
  failMessage: string,
  handler: (userId: string, ...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    const user = await getApiUser();
    if (!user) return crmFail("Authentication required", 401);
    if (!(await userHasIamPrefix(user.id, user.role, prefixes))) {
      return crmFail("Insufficient permissions", 403);
    }
    try {
      return await handler(user.id, ...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Pesan refine buatan kita berbahasa Indonesia; pesan bawaan zod tidak.
        const custom = error.issues.find((issue) => issue.code === "custom");
        return crmFail(custom?.message ?? "Data tidak valid");
      }
      console.error(`[crm] ${failMessage}:`, error);
      return crmFail(failMessage, 500);
    }
  };
}
