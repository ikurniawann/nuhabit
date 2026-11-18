import { describe, expect, it, vi } from "vitest";

const url = process.env.TEST_REDIS_URL;

describe("cachedGrant", () => {
  it("runs the loader every time without REDIS_URL", async () => {
    vi.resetModules();
    delete process.env.REDIS_URL;
    const { cachedGrant } = await import("./grant-cache");
    const load = vi.fn(async () => ({ tasks: ["read"] }));
    await cachedGrant("no-redis", load);
    await cachedGrant("no-redis", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.skipIf(!url)("serves the second read from Redis and falls back when the hash is deleted", async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    const { cachedGrant } = await import("./grant-cache");
    const { createClient } = await import("redis");
    const admin = createClient({ url });
    await admin.connect();
    const field = `test:${Date.now()}:${Math.random()}`;
    const load = vi.fn(async () => ({ "gym.packages": ["read", "create"] }));

    // The client connects in the background; reads use the loader until it is ready.
    await vi.waitFor(async () => {
      await cachedGrant(field, load);
      expect(await admin.hGet("iam:grants", field)).not.toBeNull();
    });
    const calls = load.mock.calls.length;
    expect(await cachedGrant(field, load)).toEqual({ "gym.packages": ["read", "create"] });
    expect(load).toHaveBeenCalledTimes(calls);
    const ttl = await admin.ttl("iam:grants");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await admin.del("iam:grants"); // what the Go API does after an IAM write
    await cachedGrant(field, load);
    expect(load).toHaveBeenCalledTimes(calls + 1);
    await admin.hDel("iam:grants", field);
    await admin.close();
  });
});
