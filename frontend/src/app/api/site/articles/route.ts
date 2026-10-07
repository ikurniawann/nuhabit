import { goOnlyRoute } from "@/lib/api/go-only";

/** Served by the Go site module; see src/lib/api/go-only.ts. */
export const GET = goOnlyRoute();
export const POST = goOnlyRoute();
