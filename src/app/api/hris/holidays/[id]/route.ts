import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";

/**
 * PATCH  /api/hris/holidays/[id] — ubah satu hari libur (termasuk menyetujui
 *        baris `draft` hasil impor menjadi `aktif`).
 * DELETE /api/hris/holidays/[id] — soft delete. Sengaja bukan hard delete:
 *        baris ini dirujuk perhitungan cuti historis, dan index unique-nya
 *        parsial (WHERE deleted_at IS NULL) sehingga tanggal+nama yang sama
 *        tetap bisa ditambahkan lagi setelah dihapus.
 */

const WRITE_ROLES = ["super_admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOLIDAY_TYPES = ["nasional", "cuti_bersama", "perusahaan"];
const UNIQUE_VIOLATION = "23505";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID libur tidak valid" }, { status: 400 });
    }

    const body = (await req.json()) as {
      holiday_date?: string;
      name?: string;
      type?: string;
      deducts_leave?: boolean;
      status?: string;
      note?: string | null;
    };

    if (body.holiday_date !== undefined && !DATE_RE.test(body.holiday_date)) {
      return NextResponse.json({ error: "Tanggal tidak valid (YYYY-MM-DD)" }, { status: 400 });
    }
    if (body.type !== undefined && !HOLIDAY_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Tipe libur tidak valid" }, { status: 400 });
    }
    if (body.status !== undefined && !["draft", "aktif"].includes(body.status)) {
      return NextResponse.json({ error: "Status tidak valid" }, { status: 400 });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return NextResponse.json({ error: "Nama libur wajib diisi" }, { status: 400 });
    }

    // Mengubah tipe tanpa menyebut deducts_leave akan meninggalkan baris yang
    // bertentangan dengan aturan SKB (cuti bersama memotong, libur nasional
    // tidak). Ikutkan default tipenya supaya baris tidak pernah inkonsisten.
    const deductsLeave =
      body.deducts_leave ?? (body.type ? body.type === "cuti_bersama" : null);

    const updated = await queryOne<{ id: string; name: string }>(
      `UPDATE hris.public_holidays SET
         holiday_date  = COALESCE($2::date, holiday_date),
         name          = COALESCE($3, name),
         type          = COALESCE($4, type),
         deducts_leave = COALESCE($5, deducts_leave),
         status        = COALESCE($6, status),
         -- note dibedakan dari kolom lain: COALESCE akan membuat catatan mustahil
         -- dikosongkan (null = "jangan ubah"). Flag $8 memisahkan "tidak dikirim"
         -- dari "dikirim kosong".
         note          = CASE WHEN $8::boolean THEN $7 ELSE note END,
         updated_by    = $9,
         updated_at    = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name`,
      [
        id,
        body.holiday_date ?? null,
        body.name?.trim() ?? null,
        body.type ?? null,
        deductsLeave,
        body.status ?? null,
        body.note?.trim() || null,
        body.note !== undefined,
        user.id,
      ]
    );

    if (!updated) {
      return NextResponse.json({ error: "Hari libur tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json({ message: `Libur "${updated.name}" diperbarui` });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "Libur dengan tanggal dan nama yang sama sudah ada" },
        { status: 409 }
      );
    }
    console.error("[holidays] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID libur tidak valid" }, { status: 400 });
    }

    const deleted = await queryOne<{ id: string; name: string }>(
      `UPDATE hris.public_holidays
       SET deleted_at = now(), updated_by = $2, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name`,
      [id, user.id]
    );
    if (!deleted) {
      return NextResponse.json({ error: "Hari libur tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json({ message: `Libur "${deleted.name}" dihapus` });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[holidays] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
