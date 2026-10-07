// PATCH /api/dataroom/nodes/[id]: guard aksi IAM + akses departemen tetap utuh setelah apiHandler.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IAM } from "@/lib/iam/prefixes";

const requireIamAction = vi.fn();
const getNode = vi.fn();
const renameNode = vi.fn();
const moveNode = vi.fn();
const allows = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamAction: (...args: unknown[]) => requireIamAction(...args) };
});
vi.mock("@/lib/dataroom/nodes", () => ({
  getNode: (...args: unknown[]) => getNode(...args),
  renameNode: (...args: unknown[]) => renameNode(...args),
  moveNode: (...args: unknown[]) => moveNode(...args),
  isSameOrDescendant: vi.fn(async () => false),
  deleteNodeCascade: vi.fn(),
}));
vi.mock("@/lib/dataroom/storage", () => ({ deleteDataroomFiles: vi.fn() }));
vi.mock("@/lib/dataroom/access", () => ({
  resolveActor: vi.fn(async () => ({ isAdmin: false })),
  createAccessResolver: vi.fn(async () => ({ allows, allowsFolder: vi.fn(() => true) })),
}));

const NODE = { id: "n1", parent_id: null, kind: "file", name: "laporan.pdf" };

async function patch(body: unknown) {
  const { PATCH } = await import("./route");
  const request = new NextRequest("http://localhost/api/dataroom/nodes/n1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: "n1" }) });
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireIamAction.mockResolvedValue({ id: "u1", role: "staff", full_name: "Staf" });
  getNode.mockResolvedValue(NODE);
  allows.mockReturnValue(true);
});

describe("PATCH /api/dataroom/nodes/[id]", () => {
  it("meminta aksi update pada menu dataroom", async () => {
    renameNode.mockResolvedValue({ ...NODE, name: "baru.pdf" });
    const res = await patch({ name: "baru.pdf" });
    expect(requireIamAction).toHaveBeenCalledWith(IAM.dataroom, "update");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, data: { ...NODE, name: "baru.pdf" } });
  });

  it("item di luar departemen user → 403 dan tidak diubah", async () => {
    allows.mockReturnValue(false);
    const res = await patch({ name: "baru.pdf" });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ success: false, error: "Item ini tidak dibuka untuk departemen Anda" });
    expect(renameNode).not.toHaveBeenCalled();
  });

  it("item tidak ada → 404", async () => {
    getNode.mockResolvedValue(null);
    const res = await patch({ name: "baru.pdf" });
    expect(res.status).toBe(404);
  });

  it("body tidak valid → 400 dari validateBody", async () => {
    const res = await patch({ name: "" });
    expect(res.status).toBe(400);
    expect(res.json.success).toBe(false);
  });
});
