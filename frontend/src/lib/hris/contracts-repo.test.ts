import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/settings/app-settings", () => ({ getSettings: vi.fn(), SETTING_KEYS: {} }));
vi.mock("@/lib/storage-private", () => ({ deletePrivateFile: vi.fn(), savePrivateDocument: vi.fn() }));

const { clampExpiringDays } = await import("./contracts-repo");

describe("clampExpiringDays", () => {
  it.each([
    [null, 30],
    ["abc", 30],
    ["0", 1],
    ["45.9", 45],
    ["365", 90],
  ])("%s → %s hari", (raw, days) => {
    expect(clampExpiringDays(raw)).toBe(days);
  });
});
