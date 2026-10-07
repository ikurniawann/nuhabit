import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { query: vi.fn(), release: vi.fn() };
vi.mock("pg", () => ({
  Pool: class {
    connect = async () => client;
    on() {}
  },
}));

const { afterCommit, withTransaction } = await import("./db");

describe("afterCommit", () => {
  beforeEach(() => {
    client.query.mockReset().mockResolvedValue({ rows: [] });
    process.env.DATABASE_URL = "postgres://localhost/test";
  });

  it("runs effects only after COMMIT", async () => {
    const effect = vi.fn();
    await withTransaction(async (tx) => {
      afterCommit(tx, effect);
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("drops effects when the transaction rolls back", async () => {
    const effect = vi.fn();
    await expect(
      withTransaction(async (tx) => {
        afterCommit(tx, effect);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(effect).not.toHaveBeenCalled();
  });

  it("runs immediately outside a transaction", () => {
    const effect = vi.fn();
    afterCommit(client as never, effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
