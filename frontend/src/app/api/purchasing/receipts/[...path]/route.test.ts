// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const readPrivateFile = vi.fn();
const requireIamMenuPrefix = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});
vi.mock("@/lib/storage-private", () => ({
  readPrivateFile: (...args: unknown[]) => readPrivateFile(...args),
}));

import { GET } from "./route";

const call = (path: string[]) =>
  GET(new NextRequest("http://x/api/purchasing/receipts"), { params: Promise.resolve({ path }) });

describe("GET /api/purchasing/receipts/[...path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamMenuPrefix.mockResolvedValue({ id: "user-1" });
  });

  it("404s on traversal segments without touching storage", async () => {
    const res = await call(["2026", "..%2F..%2Fsecrets"]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "File tidak ditemukan" });
    expect(readPrivateFile).not.toHaveBeenCalled();
  });

  it("requires the items menu", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.unauthorized());
    const res = await call(["2026", "10", "a.png"]);
    expect(res.status).toBe(401);
  });

  it("serves the file inline from the receipts folder", async () => {
    readPrivateFile.mockResolvedValue({ data: Buffer.from("img"), mime: "image/png" });
    const res = await call(["2026", "10", "a.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(readPrivateFile).toHaveBeenCalledWith("purchasing-receipts/2026/10/a.png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("img");
  });
});
