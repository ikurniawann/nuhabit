import { describe, expect, it } from "vitest";
import { leadDedupKey, mapLeadImportRow } from "./lead-import";

const HEADERS = ["nama_instansi", "jenis_instansi", "nama_pic", "wa_pic", "email_pic", "sumber", "suhu", "kota", "catatan"];

describe("mapLeadImportRow", () => {
  it("baris kosong dilewati", () => {
    expect(mapLeadImportRow(HEADERS, ["", " ", ""])).toEqual({ kind: "empty" });
  });

  it("field wajib kosong = invalid", () => {
    expect(mapLeadImportRow(HEADERS, ["PT A", "", "", "0812"])).toEqual({
      kind: "invalid",
      message: "Field wajib kosong: nama_instansi / nama_pic / wa_pic",
    });
  });

  it("nomor WA dinormalisasi; nomor pendek invalid", () => {
    expect(mapLeadImportRow(HEADERS, ["PT A", "", "Budi", "0812"])).toEqual({
      kind: "invalid",
      message: "No. WA tidak valid: 0812",
    });
    const ok = mapLeadImportRow(HEADERS, ["PT A", "", "Budi", "0812-3456-7890"]);
    expect(ok.kind === "ok" && ok.lead.pic_phone).toBe("6281234567890");
  });

  it("enum tak dikenal jatuh ke default; email tidak valid jadi warning", () => {
    const result = mapLeadImportRow(HEADERS, ["PT A", "UNIVERSITAS", "Budi", "081234567890", "budi@", "TikTok", "PANAS", " Bandung ", ""]);
    expect(result).toEqual({
      kind: "ok",
      rawPhone: "081234567890",
      warning: "Email diabaikan (tidak valid): budi@",
      lead: {
        org_name: "PT A",
        org_type: "corporate",
        pic_name: "Budi",
        pic_title: null,
        pic_phone: "6281234567890",
        pic_email: null,
        city: "Bandung",
        source: "lainnya",
        temperature: "panas",
        notes: null,
      },
    });
  });
});

describe("leadDedupKey", () => {
  it("instansi case-insensitive + nomor", () => {
    expect(leadDedupKey("6281", " PT Maju ")).toBe(leadDedupKey("6281", "pt maju"));
    expect(leadDedupKey("6281", "PT Maju")).not.toBe(leadDedupKey("6282", "PT Maju"));
  });
});
