// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const submitGrnQcInspection = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "QC", role: "qc_staff", brand_id: null })),
  };
});
vi.mock("@/lib/purchasing/grn-qc", () => ({
  submitGrnQcInspection: (...args: unknown[]) => submitGrnQcInspection(...args),
}));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));

import { POST } from "./route";

const GRN_ID = "11111111-1111-4111-8111-111111111111";
const GRN_ITEM_ID = "22222222-2222-4222-8222-222222222222";
const RM_ID = "33333333-3333-4333-8333-333333333333";

function post(body: unknown) {
  return new NextRequest("http://x/api/purchasing/qc", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/purchasing/qc", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 when an item has no raw material", async () => {
    const res = await POST(post({ grn_id: GRN_ID, items: [{ grn_item_id: GRN_ITEM_ID, jumlah_diterima: 1 }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "raw_material_id atau bahan_baku_id wajib diisi per item",
    });
    expect(submitGrnQcInspection).not.toHaveBeenCalled();
  });

  it("surfaces QC rule violations from the service as 400", async () => {
    submitGrnQcInspection.mockRejectedValue(ApiError.badRequest("GRN is not awaiting quality control"));
    const res = await POST(post({ grn_id: GRN_ID, items: [{ grn_item_id: GRN_ITEM_ID, raw_material_id: RM_ID }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("GRN is not awaiting quality control");
  });

  it("submits legacy fields and returns totals (201)", async () => {
    submitGrnQcInspection.mockResolvedValue({
      inspectionId: "qc-1",
      grnStatus: "partially_received",
      totalAccepted: 3,
      totalRejected: 1,
    });
    const res = await POST(
      post({
        grn_id: GRN_ID,
        items: [{ grn_item_id: GRN_ITEM_ID, bahan_baku_id: RM_ID, jumlah_diterima: 3, jumlah_ditolak: 1 }],
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        grn_id: GRN_ID,
        inspection_id: "qc-1",
        grn_status: "partially_received",
        total_accepted: 3,
        total_rejected: 1,
      },
      message: "QC submitted successfully",
    });
    expect(submitGrnQcInspection.mock.calls[0][1]).toMatchObject({
      grnId: GRN_ID,
      status: "partial",
      items: [{ grn_item_id: GRN_ITEM_ID, raw_material_id: RM_ID, qty_inspected: 4 }],
      userId: "user-1",
    });
  });
});
