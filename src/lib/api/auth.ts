import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@/types";
import { z } from "zod";
import { resolveRoleIds } from "@/lib/iam/get-user-menus";
import {
  hasAnyIamMenuPrefix,
  hasGrantedAction,
  loadGrantedMenuActions,
  loadGrantedMenuCodesForUser,
} from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";

export interface ApiUser {
  id: string;
  full_name: string;
  role: UserRole;
  brand_id: string | null;
}

/**
 * Get authenticated user from JWT session
 * Used in API route handlers (not pages)
 */
export async function getApiUser(): Promise<ApiUser | null> {
  const db = await createServerPgClient();
  const { data: { user } } = await db.auth.getUser();
  
  if (!user) return null;

  const { data: profile } = await db
    .from("users")
    .select("full_name, role, brand_id")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: user.id,
    full_name: profile.full_name,
    role: profile.role as UserRole,
    brand_id: profile.brand_id,
  };
}

/**
 * Session POS: JWT + profil users + grant menu `pos.*`.
 * 401/403 dikembalikan sebagai null agar call site lama tetap 401.
 */
export async function getPosSession(): Promise<string | null> {
  try {
    const user = await requireIamMenuPrefix(IAM.pos);
    return user.id;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}

/**
 * Require authenticated user, returns 401 if not authenticated
 */
export async function requireApiUser(): Promise<ApiUser> {
  const user = await getApiUser();
  if (!user) {
    throw ApiError.unauthorized("Authentication required");
  }
  return user;
}

/**
 * @deprecated Pakai requireIamMenuPrefix. Tetap ada untuk endpoint break-glass
 * (impersonate) sampai menu khusus tersedia.
 */
export async function requireApiRole(roles: UserRole[]): Promise<ApiUser> {
  const user = await requireApiUser();
  if (!roles.includes(user.role)) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

/**
 * Gate API pakai grant IAM, bukan daftar role di kode.
 * Prefix `items.product` loloskan `items.product.master.products`, dst.
 */
export async function requireIamMenuPrefix(
  prefixes: readonly string[]
): Promise<ApiUser> {
  const user = await requireApiUser();
  const granted = await loadGrantedMenuCodesForUser(user.id, user.role);
  if (!hasAnyIamMenuPrefix(granted, prefixes)) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

/** Exact menu code (tanpa anak). */
export async function requireIamMenu(codes: readonly string[]): Promise<ApiUser> {
  const user = await requireApiUser();
  const granted = await loadGrantedMenuCodesForUser(user.id, user.role);
  if (!codes.some((code) => granted.includes(code))) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

/** Menu prefix + granted_actions (create/update/delete/approve). */
export async function requireIamAction(
  prefixes: readonly string[],
  action: string
): Promise<ApiUser> {
  const user = await requireApiUser();
  const roleIds = await resolveRoleIds(user.id, user.role);
  const granted = await loadGrantedMenuActions(roleIds);
  if (!hasGrantedAction(granted, prefixes, action)) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

export type IamGuardResult =
  | { error: NextResponse; user: null }
  | { error: null; user: ApiUser };

/** Pola result (ticketing/CRM) supaya route tidak perlu try/catch ApiError. */
export async function requireIamGuard(
  prefixes: readonly string[]
): Promise<IamGuardResult> {
  try {
    const user = await requireIamMenuPrefix(prefixes);
    return { error: null, user };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.toResponse(), user: null };
    }
    throw error;
  }
}

/** POS: ganti getPosSession — wajib profil users + grant menu. */
export async function requirePosMenu(
  prefixes: readonly string[]
): Promise<
  | { error: NextResponse; userId: null; user: null }
  | { error: null; userId: string; user: ApiUser }
> {
  const guard = await requireIamGuard(prefixes);
  if (guard.error) {
    return { error: guard.error, userId: null, user: null };
  }
  return { error: null, userId: guard.user.id, user: guard.user };
}

/**
 * Standardized API error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }

  static forbidden(message = "Insufficient permissions") {
    return new ApiError(403, message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }

  static tooManyRequests(
    message = "Terlalu banyak permintaan. Silakan coba lagi dalam beberapa saat."
  ) {
    return new ApiError(429, message);
  }

  static server(message = "Internal server error") {
    return new ApiError(500, message);
  }

  toResponse() {
    return NextResponse.json(
      {
        success: false,
        error: this.message,
        ...(this.details != null ? { details: this.details as Record<string, unknown> } : {}),
      },
      { status: this.status }
    );
  }
}

/**
 * Validate request body with Zod schema
 */
export async function validateBody<T extends z.ZodSchema>(
  request: NextRequest,
  schema: T
): Promise<z.infer<T>> {
  try {
    const body = await request.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw ApiError.badRequest("Validation failed", error.issues);
    }
    throw error;
  }
}

/**
 * Parse and validate query params
 */
export function parseQueryParams(
  request: NextRequest,
  schema: z.ZodSchema
): Record<string, unknown> {
  const params: Record<string, string | null> = {};
  const url = new URL(request.url);

  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  const parsed = schema.parse(params) as Record<string, unknown>;
  return parsed;
}

/**
 * Standard paginated response
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export function paginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  message?: string
) {
  return NextResponse.json({
    success: true,
    data,
    ...(message && { message }),
    pagination: meta,
  });
}

export function successResponse<T>(data: T, message?: string) {
  return NextResponse.json({
    success: true,
    data,
    ...(message && { message }),
  });
}

export function createdResponse<T>(data: T, message = "Created successfully") {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status: 201 }
  );
}

export function noContentResponse() {
  return new NextResponse(null, { status: 204 });
}
