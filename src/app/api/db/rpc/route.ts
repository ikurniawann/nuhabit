import { NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import {
  DB_QUERY_FORBIDDEN_CODE,
  DB_QUERY_FORBIDDEN_MESSAGE,
  isRpcAllowed,
} from "@/lib/pg/query-policy";

export async function POST(request: Request) {
  const user = await getSessionUserFromCookies();
  if (!user) {
    return NextResponse.json({ data: null, error: { message: "Authentication required" } }, { status: 401 });
  }

  try {
    const { fn, params } = await request.json();
    if (!isRpcAllowed(fn)) {
      console.warn("[api/db/rpc] denied", { userId: user.id, fn: typeof fn === "string" ? fn : null });
      return NextResponse.json(
        { data: null, error: { message: DB_QUERY_FORBIDDEN_MESSAGE, code: DB_QUERY_FORBIDDEN_CODE } },
        { status: 403 }
      );
    }
    const client = createPgClient();
    const result = await client.rpc(fn, params ?? {});
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ data: null, error: { message } }, { status: 400 });
  }
}
