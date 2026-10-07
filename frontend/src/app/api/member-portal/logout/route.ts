import { NextResponse } from "next/server";
import {
  destroyMemberSession,
  MEMBER_SESSION_COOKIE,
} from "@/lib/member-portal/session";

/** POST /api/member-portal/logout — akhiri sesi portal member. */
export async function POST() {
  try {
    await destroyMemberSession();
  } catch (error) {
    console.error("Error destroying member session:", error);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(MEMBER_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
