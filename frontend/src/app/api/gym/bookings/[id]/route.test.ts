// @vitest-environment node
// POST /api/gym/bookings/[id]: aksi staf diteruskan ke lib booking; galat
// bisnis SchedulingError keluar sebagai 4xx berpesan Indonesia.
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireIamMenuPrefix: vi.fn() }));
const booking = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  markNoShow: vi.fn(),
  checkInBookingManually: vi.fn(),
}));

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, requireIamMenuPrefix: auth.requireIamMenuPrefix };
});
vi.mock("@/lib/db", () => ({ withTransaction: (fn: (client: unknown) => unknown) => fn("tx-client") }));
vi.mock("@/lib/gym/booking-server", () => booking);

import { SchedulingError } from "@/lib/gym/booking-store";
import { POST } from "./route";

const ID = "0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30";
const ctx = { params: Promise.resolve({ id: ID }) };
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/gym/bookings/x", { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest,
    ctx
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireIamMenuPrefix.mockResolvedValue({ id: "staff-1", full_name: "Staf", role: "admin", brand_id: null });
});

describe("POST /api/gym/bookings/[id]", () => {
  it("check_in: diteruskan dengan id staf sebagai scannedBy", async () => {
    booking.checkInBookingManually.mockResolvedValue({ decision: "allowed" });
    const res = await post({ action: "check_in" });
    expect(await res.json()).toEqual({ success: true, data: { decision: "allowed" } });
    expect(booking.checkInBookingManually).toHaveBeenCalledWith("tx-client", { bookingId: ID, scannedBy: "staff-1" });
  });

  it("SchedulingError: status dan pesannya diteruskan", async () => {
    booking.markNoShow.mockRejectedValue(new SchedulingError("Hanya booking terkonfirmasi yang bisa ditandai tidak hadir"));
    const res = await post({ action: "no_show" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: "Hanya booking terkonfirmasi yang bisa ditandai tidak hadir",
    });
  });

  it("aksi tidak dikenal: 400 menyebut kolomnya", async () => {
    const res = await post({ action: "delete" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Data tidak valid: action");
    expect(booking.cancelBooking).not.toHaveBeenCalled();
  });
});
