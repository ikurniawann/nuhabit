import { NextResponse } from "next/server";

/**
 * Fallback for a route that exists only in the Go backend. The Next proxy
 * forwards the request to BACKEND_URL before it reaches here, so this
 * answers only when BACKEND_URL is unset. It keeps the strangler check in
 * backend-routes.test.ts honest: every switched Go route has a Next file.
 */
export function goOnlyRoute(): () => Promise<Response> {
  return async () =>
    NextResponse.json(
      { success: false, error: "Rute ini dilayani backend Go. Set BACKEND_URL untuk mengaktifkannya." },
      { status: 503 },
    );
}
