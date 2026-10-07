import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { offerManualResponseSchema } from "@/lib/validations/offer";

/**
 * PUT /api/offers/[id]/response — HRD mencatat respons kandidat secara
 * manual (mis. kandidat membalas via WA/telepon, bukan portal).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABELS: Record<string, string> = {
  accepted: "menerima",
  negotiating: "mengajukan negosiasi",
  declined: "menolak",
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID offer tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`offer_response_put_${user.id}`).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = offerManualResponseSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const offer = await queryOne<{ id: string; candidate_id: string; version: number; status: string }>(
      `SELECT id, candidate_id, version, status FROM recruitment.candidate_offers WHERE id = $1`,
      [id]
    );
    if (!offer) {
      return NextResponse.json({ error: "Offer tidak ditemukan" }, { status: 404 });
    }
    if (offer.status === "accepted" || offer.status === "declined") {
      return NextResponse.json(
        { error: "Offer ini sudah direspons final oleh kandidat" },
        { status: 409 }
      );
    }

    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE recruitment.candidate_offers
         SET status = $2, response_note = $3, responded_at = now(), response_source = 'manual'
         WHERE id = $1
         RETURNING id, status, response_note, responded_at`,
        [id, input.status, input.note?.trim() || null]
      );
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'offer_response', $2, $3, $4)`,
        [
          offer.candidate_id,
          `Kandidat ${STATUS_LABELS[input.status]} offer v${offer.version} (dicatat manual)` +
            (input.note?.trim() ? ` — "${input.note.trim().slice(0, 300)}"` : ""),
          user.id,
          user.full_name,
        ]
      );
      return res.rows[0];
    });

    return NextResponse.json({ data: updated, message: "Respons tercatat" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[offer-response] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
