// createReservation: the stock check runs inside the transaction after the
// branch lock the Go service also takes, and a reservation-code collision
// retries from a savepoint instead of aborting the transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  withTransaction: async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }),
}));

const loadBookedRooms = vi.fn(async () => []);
vi.mock("./server", () => ({
  loadActorName: vi.fn(async () => "FO"),
  loadRoomTypes: vi.fn(async () => []),
  loadSeasons: vi.fn(async () => []),
  loadBookedRooms: (...args: unknown[]) => loadBookedRooms(...(args as [])),
}));

vi.mock("./planning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./planning")>()),
  planReservation: vi.fn(() => ({ lines: [], roomTotal: 0, extraTotal: 0, total: 0, nights: 2 })),
}));

const { createReservation } = await import("./reservations-server");

const ctx = { companyId: "co", branchId: "br", user: { id: "u1" } } as Parameters<typeof createReservation>[0];
const body = {
  check_in: "2026-10-10",
  check_out: "2026-10-12",
  guest_name: "Budi",
  guest_phone: "0812",
  adults: 2,
  children: 0,
  status: "dikonfirmasi",
  source: "walk-in",
  discount_amount: 0,
  rooms: [],
} as unknown as Parameters<typeof createReservation>[1];

describe("createReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQuery.mockImplementation(async (sql: string) =>
      sql.includes("INSERT INTO resort.reservations") ? { rows: [{ id: "r1" }] } : { rows: [] }
    );
  });

  it("locks the branch, then reads booked rooms on the transaction client", async () => {
    await createReservation(ctx, body);
    expect(clientQuery.mock.calls[0][0]).toContain("pg_advisory_xact_lock(hashtext('resort-booking:' || $1))");
    expect(clientQuery.mock.calls[0][1]).toEqual(["br"]);
    const client = loadBookedRooms.mock.calls[0] as unknown[];
    expect(client[4]).toEqual(expect.objectContaining({ query: clientQuery }));
  });

  it("retries a colliding reservation code from a savepoint", async () => {
    let inserts = 0;
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO resort.reservations")) {
        inserts += 1;
        if (inserts === 1) throw Object.assign(new Error("dup"), { code: "23505" });
        return { rows: [{ id: "r2" }] };
      }
      return { rows: [] };
    });
    const res = await createReservation(ctx, body);
    const sqls = clientQuery.mock.calls.map((c) => c[0] as string);
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT reservation_code");
    expect(inserts).toBe(2);
    expect(res.data).toMatchObject({ id: "r2", nights: 2, total: 0 });
  });
});
