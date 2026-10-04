// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

describe("legacy /api/purchasing/return", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
    ["DELETE /:id", DELETE],
  ])("%s answers 410 Gone", async (_name, handler) => {
    const res = await handler();
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("/api/purchasing/returns");
  });
});
