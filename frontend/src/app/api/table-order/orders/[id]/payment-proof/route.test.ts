// Bukti bayar Static QRIS dari pemesan self-order: hanya order static_qris
// yang belum lunas, isi berkas harus gambar (magic bytes), bukti lama diganti.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

const queryMock = vi.fn();
const saveMock = vi.fn(async () => ({ path: `payment-proofs/${ORDER_ID}/2-new.png`, error: null }));
const deleteMock = vi.fn(async () => undefined);
const readMock = vi.fn(async () => ({ data: PNG, mime: "image/png" }));

vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 10, resetTime: 0 })),
}));
vi.mock("@/lib/storage-private", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage-private")>();
  return {
    sniffImageMime: actual.sniffImageMime,
    savePrivateImage: (...args: unknown[]) => saveMock(...(args as [])),
    deletePrivateFile: (...args: unknown[]) => deleteMock(...(args as [])),
    readPrivateFile: (...args: unknown[]) => readMock(...(args as [])),
  };
});

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: "pending",
    payment_status: "unpaid",
    payment_method: null,
    special_requests: "Self-service table order WIT-BDG; payment=static_qris",
    payment_proof_path: null,
    ...overrides,
  };
}

function uploadRequest(content: Buffer | null): NextRequest {
  const form = new FormData();
  if (content) form.append("file", new File([new Uint8Array(content)], "bukti.png", { type: "" }));
  return { formData: async () => form, headers: new Headers() } as unknown as NextRequest;
}

async function upload(content: Buffer | null, id = ORDER_ID) {
  const { POST } = await import("./route");
  const response = await POST(uploadRequest(content), { params: Promise.resolve({ id }) });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  queryMock.mockReset();
  saveMock.mockClear();
  deleteMock.mockClear();
  readMock.mockClear();
});

describe("POST bukti bayar Static QRIS", () => {
  it("gambar valid → disimpan private, kolom order diisi, bukti lama dihapus", async () => {
    queryMock
      .mockResolvedValueOnce([orderRow({ payment_proof_path: `payment-proofs/${ORDER_ID}/1-old.png` })])
      .mockResolvedValueOnce([{ payment_proof_uploaded_at: "2026-09-28T10:00:00Z" }]);
    const { status, json } = await upload(PNG);
    expect(status).toBe(200);
    expect(json.data).toEqual({ payment_proof_uploaded_at: "2026-09-28T10:00:00Z" });
    // MIME klaim browser kosong → tipe dari sniff isi berkas.
    expect(saveMock).toHaveBeenCalledWith(expect.any(Buffer), "image/png", `payment-proofs/${ORDER_ID}`);
    expect(queryMock.mock.calls[1][1]).toEqual([ORDER_ID, `payment-proofs/${ORDER_ID}/2-new.png`]);
    expect(deleteMock).toHaveBeenCalledWith(`payment-proofs/${ORDER_ID}/1-old.png`);
  });

  it("bukan gambar (mis. PDF/HTML) → 400 tanpa menyimpan", async () => {
    queryMock.mockResolvedValueOnce([orderRow()]);
    const { status } = await upload(Buffer.from("<html><script>alert(1)</script></html>"));
    expect(status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("order bukan Static QRIS → 409", async () => {
    queryMock.mockResolvedValueOnce([orderRow({ special_requests: "Self-service table order T1; payment=cashier" })]);
    const { status } = await upload(PNG);
    expect(status).toBe(409);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("order sudah lunas / dibatalkan → 409", async () => {
    queryMock.mockResolvedValueOnce([orderRow({ payment_status: "paid" })]);
    expect((await upload(PNG)).status).toBe(409);
    queryMock.mockResolvedValueOnce([orderRow({ status: "cancelled" })]);
    expect((await upload(PNG)).status).toBe(409);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("kasir melunasi di tengah upload → berkas baru dibuang, 409", async () => {
    queryMock.mockResolvedValueOnce([orderRow()]).mockResolvedValueOnce([]);
    const { status } = await upload(PNG);
    expect(status).toBe(409);
    expect(deleteMock).toHaveBeenCalledWith(`payment-proofs/${ORDER_ID}/2-new.png`);
  });

  it("id bukan UUID → 400; order tak ada → 404; tanpa file → 400", async () => {
    expect((await upload(PNG, "../etc")).status).toBe(400);
    queryMock.mockResolvedValueOnce([]);
    expect((await upload(PNG)).status).toBe(404);
    queryMock.mockResolvedValueOnce([orderRow()]);
    expect((await upload(null)).status).toBe(400);
  });
});

describe("GET bukti bayar", () => {
  it("path di luar folder order ditolak (404), path sah disajikan dgn nosniff", async () => {
    const { GET } = await import("./route");
    const req = { headers: new Headers() } as unknown as NextRequest;
    queryMock.mockResolvedValueOnce([orderRow({ payment_proof_path: "psikotes/rahasia.png" })]);
    expect((await GET(req, { params: Promise.resolve({ id: ORDER_ID }) })).status).toBe(404);
    expect(readMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValueOnce([orderRow({ payment_proof_path: `payment-proofs/${ORDER_ID}/1.png` })]);
    const ok = await GET(req, { params: Promise.resolve({ id: ORDER_ID }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ok.headers.get("Content-Type")).toBe("image/png");
  });
});
