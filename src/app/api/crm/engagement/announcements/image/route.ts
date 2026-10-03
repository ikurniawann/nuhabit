import { engagementRoute, fail, ok } from "@/lib/crm/engagement/admin-route";
import { sniffImageMime } from "@/lib/storage-private";
import { uploadFile } from "@/lib/storage";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST (multipart `file`) — unggah gambar pengumuman member. Pola sama dengan
 * /api/crm/avatars/upload, tetapi digerbang menu Engagement supaya pengirim
 * pengumuman tidak butuh akses pengaturan CRM. Bucket publik: gambar tampil
 * di portal member.
 */
export const POST = engagementRoute("Gagal mengunggah gambar", async (request: Request) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Pilih file gambar dulu");
  if (file.size > MAX_BYTES) return fail("Gambar maksimal 5 MB");
  // Isi berkas yang menentukan, bukan MIME klaim browser.
  if (!sniffImageMime(Buffer.from(await file.arrayBuffer()))) return fail("File harus gambar JPG/PNG/WebP");

  const { url, error } = await uploadFile("crm-announcements", file);
  if (error || !url) return fail(error || "Upload gagal", 500);
  return ok({ url });
});
