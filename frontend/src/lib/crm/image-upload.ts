import "server-only";
import { ApiError } from "@/lib/api/auth";
import { uploadFile } from "@/lib/storage";
import { sniffImageMime } from "@/lib/storage-private";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Unggah gambar (multipart `file`, maks 5 MB, JPG/PNG/WebP) ke bucket publik
 * untuk artwork/konten yang tampil di portal member. Isi berkas yang
 * menentukan jenisnya, bukan MIME klaim browser. 400 untuk berkas salah,
 * 500 bila penyimpanan gagal.
 */
export async function uploadPublicImage(request: Request, bucket: string): Promise<{ url: string }> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw ApiError.badRequest("Pilih file gambar dulu");
  if (file.size > MAX_BYTES) throw ApiError.badRequest("Gambar maksimal 5 MB");
  if (!sniffImageMime(Buffer.from(await file.arrayBuffer()))) {
    throw ApiError.badRequest("File harus gambar JPG/PNG/WebP");
  }
  const { url, error } = await uploadFile(bucket, file);
  if (error || !url) throw ApiError.server(error || "Upload gagal");
  return { url };
}
