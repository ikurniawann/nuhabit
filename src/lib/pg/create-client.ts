import "server-only";
import { getPool, query, queryOne } from "@/lib/db";
import { QueryBuilder } from "@/lib/pg/query-builder";
import {
  authenticateCredentials,
  createSession,
  destroySession,
  getSessionUserFromCookies,
  getSessionUserFromRequest,
  type SessionUser,
} from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { readSessionToken } from "@/lib/auth/constants";
import type { NextRequest } from "next/server";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export type PgClient = ReturnType<typeof createPgClient>;

const qid = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Galat bentuk Supabase `{ message, code }` dari exception apa pun. */
function shimError(err: unknown): { message: string; code?: string } {
  const { message, code } = (err ?? {}) as { message?: unknown; code?: unknown };
  return {
    message: typeof message === "string" ? message : String(err),
    ...(typeof code === "string" ? { code } : {}),
  };
}

interface AuthUserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  raw_app_meta_data: Record<string, unknown> | null;
  banned_until: string | null;
}

function wrapUser(user: SessionUser | null) {
  if (!user) return { data: { user: null }, error: null };
  return {
    data: {
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata ?? {},
        app_metadata: user.app_metadata ?? {},
      },
    },
    error: null,
  };
}

function wrapSession(user: SessionUser | null) {
  if (!user) return { data: { session: null }, error: null };
  return {
    data: {
      session: {
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata ?? {},
          app_metadata: user.app_metadata ?? {},
        },
      },
    },
    error: null,
  };
}

async function rpcCall(fn: string, params: Record<string, unknown> = {}) {
  try {
    const pool = getPool();
    const keys = Object.keys(params);
    let sql: string;
    let values: unknown[] = [];
    if (keys.length === 0) {
      sql = `SELECT * FROM ${qid(fn)}()`;
    } else {
      const args = keys.map((k, i) => `${qid(k)} := $${i + 1}`).join(", ");
      values = keys.map((k) => params[k]);
      sql = `SELECT * FROM ${qid(fn)}(${args})`;
    }
    const { rows } = await pool.query<Record<string, unknown>>(sql, values);
    const data = rows.length === 1 ? (Object.keys(rows[0]).length === 1 ? Object.values(rows[0])[0] : rows[0]) : rows;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: shimError(err) };
  }
}

function buildAuthAdmin() {
  return {
    async listUsers(opts?: { page?: number; perPage?: number }) {
      try {
        const perPage = opts?.perPage ?? 1000;
        const page = opts?.page ?? 1;
        const offset = (page - 1) * perPage;
        const rows = await query<Omit<AuthUserRow, "banned_until">>(
          `SELECT id, email, created_at, last_sign_in_at, raw_user_meta_data, raw_app_meta_data
           FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [perPage, offset]
        );
        return {
          data: {
            users: rows.map((r) => ({
              id: r.id,
              email: r.email,
              created_at: r.created_at,
              last_sign_in_at: r.last_sign_in_at,
              user_metadata: r.raw_user_meta_data ?? {},
              app_metadata: r.raw_app_meta_data ?? {},
            })),
          },
          error: null,
        };
      } catch (err) {
        return { data: { users: [] }, error: shimError(err) };
      }
    },

    async getUserById(id: string) {
      try {
        const row = await queryOne<AuthUserRow>(
          `SELECT id, email, created_at, last_sign_in_at, raw_user_meta_data, raw_app_meta_data, banned_until
           FROM auth.users WHERE id = $1`,
          [id]
        );
        if (!row) return { data: { user: null }, error: { message: "User not found" } };
        return {
          data: {
            user: {
              id: row.id,
              email: row.email,
              created_at: row.created_at,
              last_sign_in_at: row.last_sign_in_at,
              user_metadata: row.raw_user_meta_data ?? {},
              app_metadata: row.raw_app_meta_data ?? {},
              banned_until: row.banned_until,
            },
          },
          error: null,
        };
      } catch (err) {
        return { data: { user: null }, error: shimError(err) };
      }
    },

    async createUser(input: {
      email: string;
      password: string;
      email_confirm?: boolean;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    }) {
      try {
        const passwordHash = await hashPassword(input.password);
        const row = await queryOne<{ id: string; email: string }>(
          `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
           VALUES ($1, $2, CASE WHEN $3 THEN NOW() ELSE NULL END, $4::jsonb, $5::jsonb)
           RETURNING id, email`,
          [
            input.email.trim(),
            passwordHash,
            Boolean(input.email_confirm),
            JSON.stringify(input.user_metadata ?? {}),
            JSON.stringify(input.app_metadata ?? {}),
          ]
        );
        return {
          data: {
            user: {
              id: row!.id,
              email: row!.email,
              user_metadata: input.user_metadata ?? {},
              app_metadata: input.app_metadata ?? {},
            },
          },
          error: null,
        };
      } catch (err) {
        return { data: { user: null }, error: shimError(err) };
      }
    },

    async updateUserById(
      id: string,
      updates: {
        password?: string;
        email?: string;
        email_confirm?: boolean;
        ban_duration?: string;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
      }
    ) {
      try {
        const sets: string[] = [];
        const params: unknown[] = [];
        let n = 1;
        if (updates.password) {
          sets.push(`password_hash = $${n++}`);
          params.push(await hashPassword(updates.password));
        }
        if (updates.email) {
          sets.push(`email = $${n++}`);
          params.push(updates.email.trim());
        }
        if (updates.email_confirm) {
          sets.push(`email_verified_at = NOW()`);
        }
        if (updates.user_metadata) {
          sets.push(`raw_user_meta_data = $${n++}::jsonb`);
          params.push(JSON.stringify(updates.user_metadata));
        }
        if (updates.app_metadata) {
          sets.push(`raw_app_meta_data = $${n++}::jsonb`);
          params.push(JSON.stringify(updates.app_metadata));
        }
        if (updates.ban_duration) {
          // "none" = unban (selaras semantik Supabase admin API)
          if (updates.ban_duration === "none") {
            sets.push(`banned_until = NULL`);
          } else {
            sets.push(`banned_until = NOW() + INTERVAL '876000 hours'`);
          }
        }
        if (sets.length) {
          params.push(id);
          await query(`UPDATE auth.users SET ${sets.join(", ")} WHERE id = $${n}`, params);
        }
        return this.getUserById(id);
      } catch (err) {
        return { data: { user: null }, error: shimError(err) };
      }
    },

    async deleteUser(id: string) {
      try {
        await query(`DELETE FROM auth.users WHERE id = $1`, [id]);
        return { data: {}, error: null };
      } catch (err) {
        return { data: {}, error: shimError(err) };
      }
    },
  };
}

export function createPgClient(ctx?: {
  request?: NextRequest;
  cookies?: ReadonlyRequestCookies;
}) {
  const resolveUser = async () => {
    if (ctx?.request) return getSessionUserFromRequest(ctx.request);
    // EPIC-042: jangan short-circuit saat cookie absen — getSessionUserFrom-
    // Cookies juga menangani fallback Bearer token (Open API).
    return getSessionUserFromCookies();
  };

  const auth = {
    async getUser() {
      return wrapUser(await resolveUser());
    },
    async getSession() {
      return wrapSession(await resolveUser());
    },
    async signInWithPassword(credentials: { email: string; password: string }) {
      const { user, error } = await authenticateCredentials(credentials.email, credentials.password);
      if (error || !user) return { data: { user: null, session: null }, error };
      const { token, expiresAt } = await createSession(user.id);
      // Cookie diset di route handler; di sini kembalikan user saja
      return {
        data: {
          user: { id: user.id, email: user.email },
          session: { access_token: token, expires_at: expiresAt.toISOString() },
        },
        error: null,
      };
    },
    async signOut() {
      const user = await resolveUser();
      if (user) {
        const jar = ctx?.request?.cookies ?? ctx?.cookies;
        await destroySession(jar ? readSessionToken(jar) : undefined);
      }
      return { error: null };
    },
    admin: buildAuthAdmin(),
  };

  return {
    from(table: string, schema = "public") {
      return new QueryBuilder(table, schema);
    },
    rpc(fn: string, params?: Record<string, unknown>) {
      return rpcCall(fn, params ?? {});
    },
    auth,
  };
}

export async function createServerPgClient() {
  const { cookies } = await import("next/headers");
  return createPgClient({ cookies: await cookies() });
}
