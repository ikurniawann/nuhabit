import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { crmFail, crmOk, crmRoute } from "@/lib/crm/crm-route";
import { cleanReviewText, REVIEW_REPLY_MAX } from "@/lib/crm/member-reviews";
import { notifyMember } from "@/lib/crm/engagement/server";

const patchSchema = z.union([
  z.object({ reply: z.string().trim().min(2, "Balasan minimal 2 karakter").max(REVIEW_REPLY_MAX) }),
  z.object({ status: z.enum(["hidden", "visible"]) }),
]);

/**
 * PATCH — balas ulasan (terlihat oleh member, member dikabari lewat
 * notifikasi) atau sembunyikan/tampilkan lagi. Menampilkan lagi
 * mengembalikan status ke replied/new sesuai ada tidaknya balasan.
 */
export const PATCH = crmRoute(
  IAM.crmMemberReviews,
  "Gagal memperbarui ulasan",
  async (userId, request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      if ("reply" in body) {
        const { rows } = await client.query(
          `UPDATE crm.member_reviews
              SET reply = $2, replied_at = now(), replied_by = $3, status = 'replied', updated_at = now()
            WHERE id = $1 RETURNING id, customer_id, status`,
          [id, cleanReviewText(body.reply, REVIEW_REPLY_MAX), userId]
        );
        if (rows[0]) {
          await notifyMember(client, rows[0].customer_id, {
            type: "review_reply",
            title: "Ulasan Anda dibalas",
            body: "Tim kami membalas ulasan Anda. Lihat di menu Ulasan.",
          });
        }
        return rows[0] ?? null;
      }
      const { rows } = await client.query(
        `UPDATE crm.member_reviews
            SET status = CASE WHEN $2 = 'hidden' THEN 'hidden'
                              WHEN reply IS NOT NULL THEN 'replied' ELSE 'new' END,
                updated_at = now()
          WHERE id = $1 RETURNING id, status`,
        [id, body.status]
      );
      return rows[0] ?? null;
    });
    if (!result) return crmFail("Ulasan tidak ditemukan", 404);
    return crmOk({ id: result.id, status: result.status });
  }
);
