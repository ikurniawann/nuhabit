import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmEngagementRole } from "@/lib/crm/server";

export const ok = (data: unknown) => NextResponse.json({ success: true, data });
export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/**
 * Bungkus handler API admin CRM → Engagement: gerbang menu IAM crm.engagement,
 * 400 untuk payload zod yang salah, 500 dengan pesan aman untuk galat lain.
 */
export function engagementRoute<A extends unknown[]>(
  failMessage: string,
  handler: (...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    const denied = await requireCrmEngagementRole();
    if (denied) return denied;
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof z.ZodError) return fail("Data tidak valid");
      console.error(`[crm-engagement] ${failMessage}:`, error);
      return fail(failMessage, 500);
    }
  };
}
