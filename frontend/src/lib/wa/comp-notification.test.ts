import { describe, expect, it } from "vitest";
import {
  COMP_NOTIF_TARGET,
  buildCompNotifMessage,
  buildFocTopupMessage,
  compNotifLabel,
} from "./comp-notification";

describe("comp-notification", () => {
  it("nomor tujuan sesuai permintaan owner (format 62)", () => {
    expect(COMP_NOTIF_TARGET).toBe("6281809078014");
  });

  it("label per jenis komplimen", () => {
    expect(compNotifLabel("foc_comp")).toBe("FOC (Free of Charge)");
    expect(compNotifLabel("owner_comp")).toBe("Owner Comp");
  });

  it("pesan FOC memuat order, nilai, dan penyetuju", () => {
    const msg = buildCompNotifMessage(
      {
        compType: "foc_comp",
        orderNumber: "POS-20260824-0044",
        grossIdr: 20000,
        approvedName: "Ricky Ardiansyah",
      },
      new Date("2026-08-24T08:30:00Z")
    );
    expect(msg).toContain("Komplimen FOC (Free of Charge)");
    expect(msg).toContain("Order : POS-20260824-0044");
    expect(msg).toContain("Customer : -");
    expect(msg).toContain("Nilai : Rp 20.000");
    expect(msg).toContain("Disetujui : Ricky Ardiansyah");
    expect(msg).toContain("WIB");
  });

  it("checkout gabungan mencantumkan jumlah order; tanpa penyetuju → '-'", () => {
    const msg = buildCompNotifMessage({
      compType: "owner_comp",
      orderNumber: "CHK-20260824-0010",
      orderCount: 2,
      grossIdr: 105000,
      approvedName: null,
      customerName: "Budi Santoso",
    });
    expect(msg).toContain("Komplimen Owner Comp");
    expect(msg).toContain("Order : CHK-20260824-0010 (2 order)");
    expect(msg).toContain("Customer : Budi Santoso");
    expect(msg).toContain("Nilai : Rp 105.000");
    expect(msg).toContain("Disetujui : -");
  });

  it("pesan topup FOC memuat customer, nominal, penyetuju, dan penanda tanpa XP", () => {
    const msg = buildFocTopupMessage(
      {
        transactionId: "tx-1",
        amountIdr: 150000,
        approvedName: "Erik Hidayat",
        customerName: "Maudy Ayunda",
      },
      new Date("2026-09-01T03:00:00Z")
    );
    expect(msg).toContain("Topup FOC (Gratis)");
    expect(msg).toContain("Customer : Maudy Ayunda");
    expect(msg).toContain("Rp 150.000");
    expect(msg).toContain("tanpa XP");
    expect(msg).toContain("Disetujui : Erik Hidayat");
    expect(msg).toContain("WIB");
  });
});
