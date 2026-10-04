import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { queryOne, query } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters" },
        { status: 400 }
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current password" },
        { status: 400 }
      );
    }

    const row = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM auth.users WHERE id = $1`,
      [user.id]
    );
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const newHash = await hashPassword(newPassword);
    await query(
      `UPDATE auth.users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, user.id]
    );

    return NextResponse.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to change password";
    console.error("[api/auth/change-password] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
