import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn() }));

const { normalizeJobOpening, validateJobOpening } = await import("./job-openings");

describe("normalizeJobOpening", () => {
  it("default lokasi/tipe, slug dari judul, published_at terisi saat terbit", () => {
    const payload = normalizeJobOpening({ title: " Barista Senior ", status: "published", headcount: 3 }, "create");
    expect(payload.slug).toBe("barista-senior");
    expect(payload.location).toBe("Jakarta, ID");
    expect(payload.headcount).toBe(3);
    expect(payload.published_at).not.toBeNull();
  });

  it("update mempertahankan published_at yang dikirim", () => {
    const payload = normalizeJobOpening(
      { title: "Kasir", status: "published", published_at: "2026-01-01T00:00:00.000Z" },
      "update"
    );
    expect(payload.published_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("field non-string diabaikan", () => {
    const payload = normalizeJobOpening({ title: "Kasir", brand_id: 12 }, "create");
    expect(payload.brand_id).toBeNull();
    expect(payload.status).toBe("draft");
    expect(payload.published_at).toBeNull();
  });
});

describe("validateJobOpening", () => {
  it("judul wajib; status hanya dicek saat create", () => {
    expect(validateJobOpening(normalizeJobOpening({}, "create"), "create")).toBe("Judul lowongan wajib diisi");
    const odd = normalizeJobOpening({ title: "Kasir", status: "arsip" }, "create");
    expect(validateJobOpening(odd, "create")).toBe("Status lowongan tidak valid");
    expect(validateJobOpening(odd, "update")).toBeNull();
  });
});
