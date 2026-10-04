import type { createPgClient } from "@/lib/pg/create-client";

/** Server-side Postgres client (query builder + session auth). */
export type DbClient = ReturnType<typeof createPgClient>;
