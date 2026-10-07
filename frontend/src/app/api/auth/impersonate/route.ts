import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";

const impersonateSchema = z.object({
  user_id: z.string().uuid(),
});

/**
 * Login As (impersonation) — khusus super_admin. Mengganti session cookie
 * dengan session baru milik user target, sehingga super admin masuk sebagai
 * user tersebut. Kembali ke akun sendiri dengan logout lalu login ulang.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireIamMenuPrefix(IAM.settingsUsers);
    const { user_id } = await validateBody(request, impersonateSchema);

    if (user_id === admin.id) {
      throw ApiError.badRequest("You are already logged in as this account");
    }

    const target = await queryOne<{
      id: string;
      email: string;
      role: string;
      full_name: string;
      is_banned: boolean;
    }>(
      `SELECT au.id, au.email, cu.role, cu.full_name,
              (au.banned_until IS NOT NULL AND au.banned_until > NOW()) AS is_banned
       FROM auth.users au
       JOIN configuration.users cu ON cu.id = au.id
       WHERE au.id = $1`,
      [user_id]
    );

    if (!target) throw ApiError.notFound("User account not found");
    if (target.is_banned) throw ApiError.badRequest("User account is banned");
    if (target.role === "super_admin") {
      throw ApiError.forbidden("Cannot impersonate a super admin account");
    }

    const { token, expiresAt } = await createSession(target.id, {
      userAgent: `impersonated-by:${admin.id} ${request.headers.get("user-agent") ?? ""}`.trim(),
    });

    const response = NextResponse.json({
      success: true,
      data: { id: target.id, email: target.email, role: target.role, full_name: target.full_name },
      message: `Logged in as ${target.full_name}`,
    });
    setSessionCookie(response, token, expiresAt, request);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to impersonate user";
    console.error("[api/auth/impersonate] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
