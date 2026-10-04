import { describe, expect, it, vi } from "vitest";
import { recordAudit, requestMeta } from "./index";
import { diffAudit } from "./diff";

describe("recordAudit", () => {
  it("menulis satu baris ke audit.audit_log lewat client transaksi", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await recordAudit(
      { query },
      {
        actor: { id: "u1", name: "Rina" },
        action: "ap_payment.void",
        entity: "ap_payment",
        entityId: "p1",
        entityLabel: "APP-0001",
        before: { status: "POSTED" },
        after: { status: "VOID" },
        reason: "  salah nominal  ",
        ip: "10.0.0.1",
      }
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit\.audit_log/);
    expect(params).toEqual([
      "u1",
      "Rina",
      "ap_payment.void",
      "ap_payment",
      "p1",
      "APP-0001",
      '{"status":"POSTED"}',
      '{"status":"VOID"}',
      "salah nominal",
      "10.0.0.1",
      null,
    ]);
  });

  it("before/after kosong disimpan null, alasan kosong jadi null", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await recordAudit({ query }, { actor: { id: null }, action: "grn.post", entity: "grn", entityId: "g1", reason: " " });
    const params = query.mock.calls[0][1];
    expect(params[1]).toBeNull();
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[8]).toBeNull();
  });

  it("melempar error database supaya transaksi ikut rollback", async () => {
    const query = vi.fn().mockRejectedValue(new Error("append-only"));
    await expect(
      recordAudit({ query }, { actor: { id: "u" }, action: "po.approve", entity: "purchase_order", entityId: "x" })
    ).rejects.toThrow("append-only");
  });
});

describe("requestMeta", () => {
  it("mengambil IP pertama dari x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1", "user-agent": "vitest" });
    expect(requestMeta({ headers })).toEqual({ ip: "203.0.113.5", userAgent: "vitest" });
    expect(requestMeta(null)).toEqual({ ip: null, userAgent: null });
  });
});

describe("diffAudit", () => {
  it("hanya field yang berubah", () => {
    expect(diffAudit({ qty: 5, note: "a", same: 1 }, { qty: 3, note: "a", same: 1, extra: true })).toEqual([
      { field: "extra", before: null, after: true },
      { field: "qty", before: 5, after: 3 },
    ]);
    expect(diffAudit(null, { status: "VOID" })).toEqual([{ field: "status", before: null, after: "VOID" }]);
  });
});
