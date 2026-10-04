import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compressAttendancePhoto } from "./attendance-photo-compress";

describe("compressAttendancePhoto", () => {
  it("foto besar dikecilkan jadi JPEG bermutu cukup", async () => {
    const besar = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 120, g: 80, b: 200 } },
    })
      .png()
      .toBuffer();
    const hasil = await compressAttendancePhoto(besar, "image/png");
    expect(hasil).not.toBeNull();
    expect(hasil!.mime).toBe("image/jpeg");
    expect(hasil!.data.length).toBeLessThan(besar.length);
    const meta = await sharp(hasil!.data).metadata();
    expect(meta.width).toBe(480);
    expect(meta.format).toBe("jpeg");
  });

  it("webp dikonversi ke JPEG (pdfkit tidak mendukung webp)", async () => {
    const webp = await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 200, b: 90 } },
    })
      .webp()
      .toBuffer();
    const hasil = await compressAttendancePhoto(webp, "image/webp");
    expect(hasil!.mime).toBe("image/jpeg");
  });

  it("foto kecil tidak diperbesar", async () => {
    const kecil = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const hasil = await compressAttendancePhoto(kecil, "image/jpeg");
    const meta = await sharp(hasil!.data).metadata();
    expect(meta.width).toBe(200);
  });

  it("buffer rusak: JPEG asli tetap dipakai, format asing jadi null", async () => {
    const rusak = Buffer.from("bukan gambar sama sekali");
    expect(await compressAttendancePhoto(rusak, "image/jpeg")).toEqual({
      data: rusak,
      mime: "image/jpeg",
    });
    expect(await compressAttendancePhoto(rusak, "image/webp")).toBeNull();
  });
});
