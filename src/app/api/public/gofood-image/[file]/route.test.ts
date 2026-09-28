// Konverter foto produk → JPEG untuk katalog GoFood (GoBiz menolak WebP).
import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { encodeImageSource } from "@/lib/gobiz/image";
import { GET } from "./route";

async function get(file: string) {
  return GET({} as NextRequest, { params: Promise.resolve({ file }) });
}

describe("GET /api/public/gofood-image/[file]", () => {
  it("foto WebP produk → JPEG valid, sisi terpanjang ≤ 1200px", async () => {
    const res = await get(`${encodeImageSource("/products/bcd/bcd-palm-02.webp")}.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1200);
  });

  it("traversal / berkas di luar root / tanpa .jpg / tidak ada → 404", async () => {
    for (const file of [
      `${encodeImageSource("/products/../package.json")}.jpg`,
      `${encodeImageSource("/products/%2e%2e/package.json")}.jpg`,
      `${encodeImageSource("/products/bcd/bcd-palm-02.webp")}.png`,
      `${encodeImageSource("/products/bcd/tidak-ada.webp")}.jpg`,
      "xx.jpg",
    ]) {
      expect((await get(file)).status).toBe(404);
    }
  });
});
