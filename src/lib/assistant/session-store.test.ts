import { describe, expect, it } from "vitest";
import { compactChatHistory, sanitizeAttachments } from "./session-store";

describe("sanitizeAttachments", () => {
  it("membuang item tanpa teks, memberi nama default, dan membatasi jumlah file", () => {
    const input = [{ text: "  " }, { text: "isi" }, ...Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, text: "x" }))];
    const out = sanitizeAttachments(input);
    expect(out[0]).toEqual({ name: "lampiran", text: "isi", truncated: false });
    expect(out.length).toBe(4); // 5 item pertama diperiksa, 1 kosong dibuang
  });

  it("memotong teks panjang dan menandai truncated", () => {
    const [item] = sanitizeAttachments([{ name: "a.pdf", text: "y".repeat(25_000) }]);
    expect(item.text.length).toBe(20_000);
    expect(item.truncated).toBe(true);
  });

  it("bukan array → kosong", () => {
    expect(sanitizeAttachments("x")).toEqual([]);
  });
});

describe("compactChatHistory", () => {
  it("merapikan spasi, memotong panjang per peran, dan menjaga urutan", () => {
    const out = compactChatHistory([
      { role: "user", content: "halo   dunia" },
      { role: "assistant", content: "z".repeat(1000) },
    ]);
    expect(out[0]).toEqual({ role: "user", content: "halo dunia" });
    expect(out[1].content.length).toBe(900);
  });
});
