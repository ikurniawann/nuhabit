// Fake query-builder db untuk route test master item / inventory purchasing.
// Respons per tabel FIFO, meniru urutan db.from(table) di kode. Hanya untuk vitest.
import type { NextRequest } from "next/server";

export type FakeResult = { data: unknown; error: unknown; count?: number | null };

export interface FakeCall {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
}

const CHAIN_METHODS = [
  "select", "eq", "neq", "in", "or", "is", "gt", "gte", "lt", "lte", "like", "ilike",
  "not", "contains", "order", "limit", "range", "single", "maybeSingle",
] as const;

export function createFakeDb(responses: Record<string, FakeResult[]>, userId = "user-1") {
  const calls: FakeCall[] = [];

  function builder(table: string) {
    const call: FakeCall = { table, action: "select", filters: [] };
    const b: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      b[method] = (...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return b;
      };
    }
    for (const action of ["insert", "update", "upsert", "delete"] as const) {
      b[action] = (payload?: unknown) => {
        call.action = action;
        call.payload = payload;
        return b;
      };
    }
    b.then = (resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) => {
      calls.push(call);
      const queue = responses[table];
      if (!queue || queue.length === 0) {
        return Promise.reject(new Error(`Tidak ada mock response tersisa untuk tabel "${table}"`)).catch(
          reject
        );
      }
      return Promise.resolve(queue.shift()!).then(resolve, reject);
    };
    return b;
  }

  const db = {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  };
  return { db, calls };
}

/** Request JSON minimal untuk handler route. */
export function jsonRequest(url: string, body?: unknown): NextRequest {
  const request = new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return request as unknown as NextRequest;
}

/** Context route dinamis Next 16 (params berupa Promise). */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
