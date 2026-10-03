import { NextResponse } from "next/server";
import { getMemberSession } from "./session";

export const memberJson = (data: unknown) => NextResponse.json({ success: true, data });

export const memberError = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

/**
 * Bungkus handler API portal member: 401 tanpa sesi, 500 dengan pesan yang
 * aman bila handler melempar galat.
 */
export function withMemberSession<A extends unknown[]>(
  failMessage: string,
  handler: (customerId: string, ...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    try {
      const session = await getMemberSession();
      if (!session) return memberError("Unauthorized", 401);
      return await handler(session.customerId, ...args);
    } catch (error) {
      console.error(`[member-portal] ${failMessage}:`, error);
      return memberError(failMessage, 500);
    }
  };
}
