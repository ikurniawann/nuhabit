// /api/files: bucket publik tetap anonim; CV/foto kandidat wajib sesi staf;
// foto member hanya untuk pemiliknya (atau staf); file sensitif Cache-Control private.
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const staff = vi.fn();
const member = vi.fn();
vi.mock("@/lib/api/auth", () => ({ getApiUser: () => staff() }));
vi.mock("@/lib/member-portal/session", () => ({ getMemberSession: () => member() }));

const FILES = ["products/p.png", "cv/candidates/cv.pdf", "member-photos/cust-1/m.png"];
let tmp = "";
let ROOT = "";

beforeAll(async () => {
  // Route menghitung UPLOAD_ROOT dari process.cwd() saat di-import.
  tmp = await mkdtemp(path.join(os.tmpdir(), "files-route-"));
  ROOT = path.join(tmp, "storage", "uploads");
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  for (const f of FILES) {
    await mkdir(path.dirname(path.join(ROOT, f)), { recursive: true });
    await writeFile(path.join(ROOT, f), "x");
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  staff.mockResolvedValue(null);
  member.mockResolvedValue(null);
});

async function get(rel: string) {
  const { GET } = await import("./route");
  const [bucket, ...rest] = rel.split("/");
  return GET(new Request(`http://localhost/api/files/${rel}`), {
    params: Promise.resolve({ bucket, path: rest }),
  });
}

describe("GET /api/files/[bucket]/[...path]", () => {
  it("bucket publik (gambar produk) tetap anonim, cache publik", async () => {
    const res = await get(FILES[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
  });

  it("CV kandidat tanpa sesi → 401; dengan sesi staf → 200 private", async () => {
    expect((await get(FILES[1])).status).toBe(401);
    staff.mockResolvedValue({ id: "u-1" });
    const res = await get(FILES[1]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/^private/);
  });

  it("foto member: pemilik boleh, member lain tidak", async () => {
    member.mockResolvedValue({ customerId: "cust-1", sessionId: "s" });
    expect((await get(FILES[2])).status).toBe(200);
    member.mockResolvedValue({ customerId: "cust-2", sessionId: "s" });
    expect((await get(FILES[2])).status).toBe(401);
  });

  it("bucket tak dikenal tertutup secara default; traversal tetap 404", async () => {
    expect((await get("rahasia/a.pdf")).status).toBe(401);
    staff.mockResolvedValue({ id: "u-1" });
    expect((await get("products/..%2F..%2Fetc")).status).toBe(404);
  });
});
