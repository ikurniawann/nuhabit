import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn(async (): Promise<Record<string, unknown>[]> => []);
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...(args as [])) }));

import {
  ASSISTANT_WRITE_ACTIONS,
  escapeHtml,
  isActionExpired,
  isWriteActionName,
  plainTextToHtml,
  proposeWriteAction,
  validateCatatanKandidatArgs,
  validatePengumumanArgs,
  WRITE_ACTION_TTL_MS,
  writeToolDefinitions,
} from "./write-tools";
import { ASSISTANT_TOOLS, runTool } from "./tools";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe("escapeHtml & plainTextToHtml", () => {
  it("meng-escape karakter HTML dari teks model", () => {
    expect(escapeHtml(`<img src=x onerror="a">'&`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;"
    );
  });

  it("mengubah baris kosong menjadi paragraf dan baris tunggal menjadi <br />", () => {
    expect(plainTextToHtml("baris satu\nbaris dua\n\nparagraf dua")).toBe(
      "<p>baris satu<br />baris dua</p>\n<p>paragraf dua</p>"
    );
  });

  it("script tag tidak pernah lolos sebagai HTML aktif", () => {
    const html = plainTextToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("validatePengumumanArgs", () => {
  it("menerima argumen lengkap dan membersihkan tags", () => {
    const result = validatePengumumanArgs({
      judul: "  Libur Lebaran  ",
      isi: "Kantor libur tanggal 1-2.",
      tags: ["info", "", "x".repeat(40), 7, "  hr  ", "a", "b", "c", "d"],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        judul: "Libur Lebaran",
        isi: "Kantor libur tanggal 1-2.",
        // Non-string, kosong, dan yang kepanjangan dibuang; sisanya maksimal 5.
        tags: ["info", "hr", "a", "b", "c"],
      },
    });
  });

  it("menolak judul atau isi di luar batas", () => {
    expect(validatePengumumanArgs({ judul: "ab", isi: "cukup panjang isi" }).ok).toBe(false);
    expect(validatePengumumanArgs({ judul: "Judul benar", isi: "pendek" }).ok).toBe(false);
    expect(
      validatePengumumanArgs({ judul: "Judul benar", isi: "x".repeat(5001) }).ok
    ).toBe(false);
  });
});

describe("validateCatatanKandidatArgs", () => {
  it("menerima argumen valid", () => {
    expect(validateCatatanKandidatArgs({ kandidat: "Budi", catatan: "Sudah dihubungi" })).toEqual({
      ok: true,
      value: { kandidat: "Budi", catatan: "Sudah dihubungi" },
    });
  });

  it("menolak nama terlalu pendek dan catatan kosong", () => {
    expect(validateCatatanKandidatArgs({ kandidat: "B", catatan: "isi catatan" }).ok).toBe(false);
    expect(validateCatatanKandidatArgs({ kandidat: "Budi", catatan: "" }).ok).toBe(false);
  });
});

describe("proposeWriteAction", () => {
  it("menolak aksi di luar whitelist", async () => {
    await expect(proposeWriteAction("hapus_semua_data", {}, { userId: "u1", userName: "Admin" }))
      .resolves.toEqual({ error: "Aksi tidak dikenal: hapus_semua_data" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("argumen tidak valid TIDAK membuat baris pending", async () => {
    const result = await proposeWriteAction(
      "usulkan_pengumuman_draft",
      { judul: "x", isi: "y" },
      { userId: "u1", userName: "Admin" }
    );
    expect(result).toHaveProperty("error");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("usulan valid menyimpan baris pending dan mengembalikan meta", async () => {
    queryMock.mockResolvedValueOnce([{ id: "act-1" }]);
    const result = await proposeWriteAction(
      "usulkan_pengumuman_draft",
      { judul: "Libur Lebaran", isi: "Kantor libur tanggal 1-2 sesuai SKB." },
      { userId: "u1", userName: "Admin", sessionId: "s1" }
    );
    expect(result).toEqual({
      pending: {
        id: "act-1",
        name: "usulkan_pengumuman_draft",
        summary: expect.stringContaining('Buat DRAFT pengumuman "Libur Lebaran"'),
        status: "pending",
      },
    });
    const [sql, params] = queryMock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO ai_assistant_actions");
    expect(params[0]).toBe("s1");
    expect(params[1]).toBe("u1");
  });

  it("kandidat ambigu ditolak dengan daftar nama, tanpa baris pending", async () => {
    queryMock.mockResolvedValueOnce([
      { id: "c1", full_name: "Budi Santoso" },
      { id: "c2", full_name: "Budi Hartono" },
    ]);
    const result = await proposeWriteAction(
      "usulkan_catatan_kandidat",
      { kandidat: "Budi", catatan: "Sudah dihubungi via WA" },
      { userId: "u1", userName: "Admin" }
    );
    expect(result).toEqual({
      error: expect.stringContaining("Budi Santoso, Budi Hartono"),
    });
    // Hanya query pencarian kandidat; tidak ada INSERT.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("kandidat unik menghasilkan usulan ber-nama pasti", async () => {
    queryMock
      .mockResolvedValueOnce([{ id: "c1", full_name: "Budi Santoso" }])
      .mockResolvedValueOnce([{ id: "act-2" }]);
    const result = await proposeWriteAction(
      "usulkan_catatan_kandidat",
      { kandidat: "Budi San", catatan: "Sudah dihubungi via WA" },
      { userId: "u1", userName: "Admin" }
    );
    expect(result).toEqual({
      pending: expect.objectContaining({
        summary: expect.stringContaining('kandidat "Budi Santoso"'),
      }),
    });
  });
});

describe("pemisahan baca vs tulis", () => {
  it("aksi tulis TIDAK terdaftar sebagai tool baca, jadi runTool tidak bisa mengeksekusinya", async () => {
    for (const action of ASSISTANT_WRITE_ACTIONS) {
      expect(ASSISTANT_TOOLS.some((t) => t.name === action.name)).toBe(false);
      await expect(runTool(action.name, {})).resolves.toEqual({
        error: `Tool tidak dikenal: ${action.name}`,
      });
    }
  });

  it("semua aksi tulis berawalan 'usulkan_' agar jelas hanya usulan", () => {
    for (const action of ASSISTANT_WRITE_ACTIONS) {
      expect(action.name.startsWith("usulkan_")).toBe(true);
      expect(isWriteActionName(action.name)).toBe(true);
    }
  });

  it("definisi function untuk model lengkap dan unik", () => {
    const defs = writeToolDefinitions();
    expect(defs).toHaveLength(ASSISTANT_WRITE_ACTIONS.length);
    const names = defs.map((d) => d.function.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("isActionExpired", () => {
  const now = Date.parse("2026-07-25T10:00:00+07:00");

  it("belum kedaluwarsa di dalam TTL, kedaluwarsa setelahnya", () => {
    expect(isActionExpired(new Date(now - WRITE_ACTION_TTL_MS + 1000), now)).toBe(false);
    expect(isActionExpired(new Date(now - WRITE_ACTION_TTL_MS - 1000), now)).toBe(true);
  });

  it("tanggal rusak dianggap kedaluwarsa (gagal-aman)", () => {
    expect(isActionExpired("bukan-tanggal", now)).toBe(true);
  });
});
