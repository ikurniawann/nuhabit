import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(async () => []) }));

import { ASSISTANT_TOOLS, parseToolArguments, runTool, toolDefinitions } from "./tools";

describe("parseToolArguments", () => {
  it("membaca JSON argumen dari model", () => {
    expect(parseToolArguments('{"nama":"Ani"}')).toEqual({ nama: "Ani" });
  });

  it("mengembalikan objek kosong untuk JSON rusak", () => {
    // Model sesekali mengirim potongan JSON; ini tidak boleh menjatuhkan request.
    expect(parseToolArguments('{"nama":')).toEqual({});
  });

  it("mengembalikan objek kosong untuk tipe non-string dan string kosong", () => {
    expect(parseToolArguments(null)).toEqual({});
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("   ")).toEqual({});
  });

  it("menolak JSON yang bukan objek", () => {
    expect(parseToolArguments("[1,2]")).toEqual({});
    expect(parseToolArguments('"teks"')).toEqual({});
  });
});

describe("runTool", () => {
  it("mengembalikan error terstruktur untuk tool tak dikenal", async () => {
    // Bukan throw: model harus bisa menjelaskan kegagalan ini ke user.
    await expect(runTool("hapus_semua_data", {})).resolves.toEqual({
      error: "Tool tidak dikenal: hapus_semua_data",
    });
  });

  it("menolak argumen kosong pada pencarian karyawan", async () => {
    await expect(runTool("cari_karyawan", {})).resolves.toEqual({
      error: "Nama tidak boleh kosong",
    });
  });
});

describe("definisi tool", () => {
  it("semua tool punya nama, deskripsi, dan skema parameter", () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters).toHaveProperty("type", "object");
    }
  });

  it("nama tool unik", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("dibungkus dalam bentuk function yang dipahami OpenAI", () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(ASSISTANT_TOOLS.length);
    expect(defs[0]).toMatchObject({ type: "function", function: { name: expect.any(String) } });
  });

  it("tidak ada tool yang menjanjikan aksi menulis di fase ini", () => {
    // Fase D read-only; aksi menulis baru boleh di Fase E dengan konfirmasi.
    const terlarang = /hapus|ubah|buat|kirim|simpan|update|delete/i;
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.name).not.toMatch(terlarang);
    }
  });
});
