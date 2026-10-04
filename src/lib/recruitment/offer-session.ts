import { ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { offerRespondSchema } from "@/lib/validations/offer";
import { enforceRateLimit, isLinkExpired, isPortalToken, parseJsonBody } from "./route-helpers";

/**
 * Helper bersama endpoint publik offer (/api/offer/session/[token]),
 * pola sama dgn psikotes/interview-session: kandidat anonim, identitas =
 * token offer; rate limit di-key ke offer.
 */

/** Fallback masa hidup offer bila expires_at NULL (jangan pernah abadi). */
const MAX_OFFER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfferRow {
  id: string;
  candidate_id: string;
  version: number;
  token: string;
  status: "sent" | "negotiating" | "accepted" | "declined" | "expired";
  position_title: string | null;
  base_salary: string; // numeric → string dari pg
  benefits: string[];
  start_date: string | null;
  notes: string | null;
  response_note: string | null;
  responded_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
  candidate_name: string;
  brand_name: string | null;
}

/** 404 untuk token salah/tidak ada, 429 bila kuota `bucket` offer habis. */
export async function requireOffer(token: string, bucket: string) {
  const offer = await loadOfferByToken(token);
  if (!offer) throw ApiError.notFound("Link penawaran tidak berlaku");
  enforceRateLimit(`offer_session_${bucket}_${offer.id}`);
  return offer;
}

/** Muat offer via token + auto-expire bila lewat masa berlaku. */
async function loadOfferByToken(token: string): Promise<OfferRow | null> {
  if (!isPortalToken(token)) return null;
  const offer = await queryOne<OfferRow>(
    `SELECT o.id, o.candidate_id, o.version, o.token, o.status, o.position_title,
            o.base_salary, o.benefits, o.start_date, o.notes, o.response_note,
            o.responded_at, o.sent_at, o.expires_at,
            c.full_name AS candidate_name, b.name AS brand_name
     FROM recruitment.candidate_offers o
     JOIN recruitment.candidates c ON c.id = o.candidate_id
     LEFT JOIN item.brands b ON b.id = c.brand_id
     WHERE o.token = $1`,
    [token]
  );
  if (!offer) return null;

  const isExpirable = offer.status === "sent" || offer.status === "negotiating";
  if (isExpirable && isLinkExpired({ expires_at: offer.expires_at, issued_at: offer.sent_at }, MAX_OFFER_LIFETIME_MS)) {
    await queryOne(
      `UPDATE recruitment.candidate_offers SET status = 'expired' WHERE id = $1 RETURNING id`,
      [offer.id]
    );
    return { ...offer, status: "expired" };
  }
  return offer;
}

const ACTION_TO_STATUS = {
  accept: "accepted",
  negotiate: "negotiating",
  decline: "declined",
} as const;

const ACTION_LABELS = {
  accept: "menerima",
  negotiate: "mengajukan negosiasi",
  decline: "menolak",
} as const;

type OfferAction = keyof typeof ACTION_TO_STATUS;

/** Deskripsi jejak aktivitas respons kandidat (catatan dipotong 300 karakter). */
export function offerResponseDescription(action: OfferAction, version: number, note: string | null) {
  return (
    `Kandidat ${ACTION_LABELS[action]} offer v${version} via portal` +
    (note ? ` — "${note.slice(0, 300)}"` : "")
  );
}

/**
 * Respons kandidat (accept/negotiate/decline). Respons + waktu + IP jadi bukti
 * digital; accept/decline final, negotiate boleh diperbarui.
 */
export async function respondToOffer(offer: OfferRow, request: Request, ip: string | null) {
  if (offer.status !== "sent" && offer.status !== "negotiating") {
    throw ApiError.conflict("Penawaran ini sudah tidak bisa direspons");
  }
  const input = await parseJsonBody(request, offerRespondSchema);
  const note = input.note?.trim() || null;
  if (input.action === "negotiate" && !note) {
    throw ApiError.badRequest("Tuliskan catatan negosiasi Anda (mis. angka yang diharapkan)");
  }

  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE recruitment.candidate_offers
       SET status = $2, response_note = $3, responded_at = now(),
           response_ip = $4, response_source = 'portal'
       WHERE id = $1 AND status IN ('sent', 'negotiating')
       RETURNING id, status, response_note, responded_at`,
      [offer.id, ACTION_TO_STATUS[input.action], note, ip]
    );
    if (res.rows.length === 0) return null;
    await client.query(
      `INSERT INTO recruitment.candidate_activities (candidate_id, activity_type, description)
       VALUES ($1, 'offer_response', $2)`,
      [offer.candidate_id, offerResponseDescription(input.action, offer.version, note)]
    );
    return res.rows[0];
  });
  if (!updated) throw ApiError.conflict("Penawaran ini sudah tidak bisa direspons");
  return updated;
}

/** Rincian offer utk kandidat; catatan internal HRD (notes) tidak ikut. */
export function offerForCandidate(offer: OfferRow) {
  return {
    status: offer.status,
    version: offer.version,
    candidate_name: offer.candidate_name,
    brand_name: offer.brand_name,
    position_title: offer.position_title,
    base_salary: Number(offer.base_salary),
    benefits: offer.benefits,
    start_date: offer.start_date,
    response_note: offer.response_note,
    responded_at: offer.responded_at,
    sent_at: offer.sent_at,
    expires_at: offer.expires_at,
  };
}
