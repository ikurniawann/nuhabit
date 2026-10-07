import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  MAX_ATTACHMENT_BYTES,
  extractAttachmentText,
  isSupportedAttachment,
} from "@/lib/attachments/extract";

/**
 * POST /api/ai/assistant/attachment — unggah satu lampiran, kembalikan teksnya.
 *
 * File TIDAK disimpan permanen: yang dibutuhkan Do hanyalah teks hasil ekstraksi,
 * dan menyimpan dokumen HR/keuangan yang diunggah sambil lalu justru menambah
 * permukaan kebocoran tanpa manfaat yang jelas. Bila kelak purchasing butuh
 * arsip file-nya, penyimpanan ditambahkan di modul itu, bukan di sini.
 */

export const runtime = "nodejs";
// OCR bisa memakan waktu; default 30 detik tidak cukup untuk scan padat.
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File kosong" }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Ukuran file melebihi ${mb} MB` }, { status: 400 });
    }
    // Ekstensi diperiksa, bukan MIME dari browser — MIME mudah dipalsukan dan
    // pemilihan ekstraktor memang bergantung pada ekstensi.
    if (!isSupportedAttachment(file.name)) {
      return NextResponse.json(
        { error: "Format tidak didukung. Pakai PDF, DOCX, gambar, XLSX, atau CSV." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractAttachmentText(buffer, file.name);

    return NextResponse.json({
      data: {
        name: file.name,
        size: file.size,
        method: result.method,
        truncated: result.truncated,
        chars: result.text.length,
        text: result.text,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membaca lampiran";
    console.error("[do:attachment] gagal:", message);
    // Pesan diteruskan apa adanya: "OCR timeout" atau "format tidak didukung"
    // jauh lebih berguna bagi user daripada "terjadi kesalahan".
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
