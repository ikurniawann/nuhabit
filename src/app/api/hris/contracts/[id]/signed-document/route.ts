import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import {
  deletePrivateFile,
  readPrivateFile,
  savePrivateDocument,
} from "@/lib/storage-private";

/**
 * Dokumen kontrak bertanda tangan (scan PDF/JPG/PNG/WebP, maks 10 MB) —
 * disimpan di storage private, path di kolom signed_document_url.
 *   POST   upload (re-upload menimpa file lama, best-effort delete)
 *   GET    sajikan file (inline, ber-auth)
 *   DELETE hapus dokumen + kosongkan kolom
 */

const ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ContractDocRow {
  id: string;
  employee_id: string;
  contract_number: string;
  signed_document_url: string | null;
}

async function loadContract(id: string): Promise<ContractDocRow | null> {
  return queryOne<ContractDocRow>(
    `SELECT id, employee_id, contract_number, signed_document_url
     FROM hris.employment_contracts WHERE id = $1`,
    [id]
  );
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    const contract = await loadContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Kontrak tidak ditemukan" }, { status: 404 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Form data tidak valid" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran dokumen maksimal 10 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await savePrivateDocument(buffer, `contract-signed/${contract.employee_id}`);
    if (!saved.path) {
      return NextResponse.json(
        { error: saved.error ?? "Gagal menyimpan dokumen" },
        { status: 400 }
      );
    }

    // ttd default hari ini bila belum pernah diisi — bisa dikoreksi via aksi update
    await queryOne(
      `UPDATE hris.employment_contracts
       SET signed_document_url = $2, signed_at = COALESCE(signed_at, now()::date)
       WHERE id = $1 RETURNING id`,
      [contract.id, saved.path]
    );
    if (contract.signed_document_url) {
      await deletePrivateFile(contract.signed_document_url);
    }

    return NextResponse.json({
      message: `Dokumen bertanda tangan kontrak ${contract.contract_number} tersimpan`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts/signed-document] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    const contract = await loadContract(id);
    if (!contract?.signed_document_url) {
      return NextResponse.json(
        { error: "Kontrak ini belum punya dokumen bertanda tangan" },
        { status: 404 }
      );
    }

    const { data, mime } = await readPrivateFile(contract.signed_document_url);
    if (!data) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="ttd-${contract.contract_number.replace(/[^a-zA-Z0-9.-]/g, "_")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts/signed-document] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kontrak tidak valid" }, { status: 400 });
    }
    const contract = await loadContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Kontrak tidak ditemukan" }, { status: 404 });
    }
    if (!contract.signed_document_url) {
      return NextResponse.json(
        { error: "Kontrak ini belum punya dokumen bertanda tangan" },
        { status: 409 }
      );
    }

    await queryOne(
      `UPDATE hris.employment_contracts
       SET signed_document_url = NULL WHERE id = $1 RETURNING id`,
      [contract.id]
    );
    await deletePrivateFile(contract.signed_document_url);

    return NextResponse.json({ message: "Dokumen bertanda tangan dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[contracts/signed-document] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
