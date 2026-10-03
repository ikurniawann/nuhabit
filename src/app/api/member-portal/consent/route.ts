import { z } from "zod";
import { getPool } from "@/lib/db";
import { readMarketingConsent, setMarketingConsent } from "@/lib/member-portal/consent";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const schema = z.object({ enabled: z.boolean() });

/** PUT { enabled } — member menyalakan/mematikan promo WhatsApp & kampanye. */
export const PUT = withMemberSession("Gagal menyimpan pilihan promo", async (customerId, request: Request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  const pool = getPool();
  await setMarketingConsent(pool, customerId, parsed.data.enabled);
  return memberJson({ marketing_opt_in: await readMarketingConsent(pool, customerId) });
});
