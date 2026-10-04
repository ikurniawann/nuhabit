import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";
import { uploadFile } from "@/lib/storage";

/**
 * Unggah foto profil member dari portal.
 *
 * Sengaja TIDAK memakai `validateFile` generik (yang juga mengizinkan PDF &
 * dokumen Word) — foto profil harus benar-benar gambar. Batas ukuran juga
 * dikecilkan ke 5 MB karena ini foto dari HP, bukan lampiran dokumen.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export async function POST(request: NextRequest) {
  const session = await getMemberSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Format unggahan tidak valid" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, error: "Foto tidak ditemukan" }, { status: 400 });
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { success: false, error: "Ukuran foto maksimal 5 MB" },
      { status: 400 }
    );
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { success: false, error: "Format harus JPG, PNG, atau WEBP" },
      { status: 400 }
    );
  }

  const { url, error } = await uploadFile("member-photos", file, session.customerId);
  if (error || !url) {
    console.error("[member-portal] Upload foto gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal mengunggah foto" }, { status: 500 });
  }

  // Simpan langsung supaya foto tidak hilang bila member menutup halaman
  // sebelum menekan Simpan pada form profil.
  await getPool().query(
    `UPDATE pos.pos_customers SET photo_url = $2 WHERE id = $1`,
    [session.customerId, url]
  );

  return NextResponse.json({ success: true, data: { photo_url: url } });
}
