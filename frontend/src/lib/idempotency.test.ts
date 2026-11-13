import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, retryKey, settleRetryKey, withRetryKey } from "./idempotency";

describe("retryKey", () => {
  it("reuses the key for the same body until settled", () => {
    const first = retryKey("t1", { total: 1 });
    expect(retryKey("t1", { total: 1 })).toBe(first);
    expect(retryKey("t1", { total: 2 })).not.toBe(first);
    const second = retryKey("t1", { total: 2 });
    settleRetryKey("t1");
    expect(retryKey("t1", { total: 2 })).not.toBe(second);
  });

  it("keeps scopes apart", () => {
    expect(retryKey("a", {})).not.toBe(retryKey("b", {}));
  });
});

describe("withRetryKey", () => {
  it("resends the same key after a failure and a fresh one after success", async () => {
    const seen: string[] = [];
    const fail = (h: Record<string, string>) => {
      seen.push(h[IDEMPOTENCY_HEADER]);
      return Promise.reject(new TypeError("network"));
    };
    const ok = (h: Record<string, string>) => {
      seen.push(h[IDEMPOTENCY_HEADER]);
      return Promise.resolve("ok");
    };
    await expect(withRetryKey("t2", { a: 1 }, fail)).rejects.toThrow("network");
    await withRetryKey("t2", { a: 1 }, ok);
    await withRetryKey("t2", { a: 1 }, ok);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[1]);
  });

  it("uses a fixed key as given", async () => {
    let sent = "";
    await withRetryKey("t3", {}, (h) => Promise.resolve((sent = h[IDEMPOTENCY_HEADER])), "offline-7");
    expect(sent).toBe("offline-7");
  });
});
