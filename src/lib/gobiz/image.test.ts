import { describe, expect, it } from "vitest";
import { decodeImageSource, encodeImageSource, gofoodImageUrl } from "./image";

const app = "https://poskopi.reddie.id";

describe("gofoodImageUrl", () => {
  it("JPEG/PNG lokal langsung; WebP lewat konverter .jpg", () => {
    expect(gofoodImageUrl("/products/a.png", app)).toBe(`${app}/products/a.png`);
    expect(gofoodImageUrl("/products/a.JPG", `${app}/`)).toBe(`${app}/products/a.JPG`);
    const url = gofoodImageUrl("/products/bcd/bcd-palm-02.webp", app)!;
    expect(url).toMatch(/^https:\/\/poskopi\.reddie\.id\/api\/public\/gofood-image\/[A-Za-z0-9_-]+\.jpg$/);
    const token = url.split("/").pop()!.replace(/\.jpg$/, "");
    expect(decodeImageSource(token)).toBe("/products/bcd/bcd-palm-02.webp");
  });

  it("unggahan storage ikut dikonversi; URL luar non-JPEG/PNG & sumber asing dibuang", () => {
    expect(gofoodImageUrl("/api/files/products/x.webp", app)).toContain("/api/public/gofood-image/");
    expect(gofoodImageUrl("https://cdn.example.com/a.webp", app)).toBeUndefined();
    expect(gofoodImageUrl("https://cdn.example.com/a.jpg?w=1", app)).toBe("https://cdn.example.com/a.jpg?w=1");
    expect(gofoodImageUrl("/etc/passwd", app)).toBeUndefined();
    expect(gofoodImageUrl(null, app)).toBeUndefined();
    expect(gofoodImageUrl("/products/a.webp", "")).toBeUndefined();
  });
});

describe("decodeImageSource", () => {
  it("menolak traversal, root asing, dan token rusak", () => {
    expect(decodeImageSource(encodeImageSource("/products/../../.env"))).toBeNull();
    expect(decodeImageSource(encodeImageSource("/storage/private/x.jpg"))).toBeNull();
    expect(decodeImageSource("bukan token!")).toBeNull();
    expect(decodeImageSource(encodeImageSource("/api/files/products/a.webp"))).toBe("/api/files/products/a.webp");
  });
});
