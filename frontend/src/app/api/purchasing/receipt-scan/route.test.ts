// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const savePrivateDocument = vi.fn();
const extractAttachmentText = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1" })) };
});
vi.mock("@/lib/storage-private", () => ({
  savePrivateDocument: (...args: unknown[]) => savePrivateDocument(...args),
}));
vi.mock("@/lib/attachments/extract", () => ({
  MAX_ATTACHMENT_BYTES: 1024,
  extractAttachmentText: (...args: unknown[]) => extractAttachmentText(...args),
}));

import { POST } from "./route";

function upload(file?: File): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  return { formData: async () => form } as unknown as NextRequest;
}

describe("POST /api/purchasing/receipt-scan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 without a file", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Pilih file nota dulu" });
  });

  it("400 for an unsupported extension", async () => {
    const res = await POST(upload(new File(["a,b"], "nota.csv")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Format tidak didukung");
    expect(savePrivateDocument).not.toHaveBeenCalled();
  });

  it("archives the file and still succeeds when OCR fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    savePrivateDocument.mockResolvedValue({ path: "purchasing-receipts/2026/10/abc.png" });
    extractAttachmentText.mockRejectedValue(new Error("ocr down"));

    const res = await POST(upload(new File(["png"], "nota.png", { type: "image/png" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        receipt_path: "purchasing-receipts/2026/10/abc.png",
        receipt_name: "nota.png",
        fields: { nomor: null, tanggal: null, total: null },
      },
    });
  });
});
