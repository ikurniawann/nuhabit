// Konverter foto produk → JPEG untuk katalog GoFood (GoBiz menolak WebP).
import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { encodeImageSource } from "@/lib/gobiz/image";
import { GET } from "./route";

// WebP sementara di public/products — tes tidak bergantung pada foto instance tertentu.
const TEST_DIR = path.join(process.cwd(), "public", "products", "__gofood_image_test__");
const TEST_SRC = "/products/__gofood_image_test__/sample.webp";

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  await sharp({ create: { width: 1600, height: 900, channels: 4, background: { r: 29, g: 29, b: 204, alpha: 0.5 } } })
    .webp()
    .toFile(path.join(TEST_DIR, "sample.webp"));
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function get(file: string) {
  return GET({} as NextRequest, { params: Promise.resolve({ file }) });
}

describe("GET /api/public/gofood-image/[file]", () => {
  it("foto WebP (transparan) → JPEG valid, sisi terpanjang ≤ 1200px", async () => {
    const res = await get(`${encodeImageSource(TEST_SRC)}.jpg`);
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
      `${encodeImageSource(TEST_SRC)}.png`,
      `${encodeImageSource("/products/__gofood_image_test__/tidak-ada.webp")}.jpg`,
      "xx.jpg",
    ]) {
      expect((await get(file)).status).toBe(404);
    }
  });
});
