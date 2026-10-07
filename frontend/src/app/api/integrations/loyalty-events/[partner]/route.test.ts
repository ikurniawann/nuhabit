// Webhook partner loyalty: tanda tangan HMAC + timestamp segar wajib sebelum data diproses.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();
const partner = { value: { id: "pt1", is_active: true, signing_secret: "s3cret" } as Record<string, unknown> | null };
const signatureOk = { value: true };
vi.mock("@/lib/crm/partners", () => ({
  SIGNATURE_HEADER: "x-signature",
  TIMESTAMP_HEADER: "x-timestamp",
  isTimestampFresh: (ts: string | null) => ts === "fresh",
  verifySignature: () => signatureOk.value,
}));
vi.mock("@/lib/crm/partners-server", () => ({
  findPartnerByCode: async () => partner.value,
  ingestPartnerEvent: (...a: unknown[]) => ingest(...a),
}));

async function post(body: string, ts = "fresh") {
  const { POST } = await import("./route");
  const req = new Request("http://x", { method: "POST", body, headers: { "x-timestamp": ts, "x-signature": "sha256=x" } });
  const res = await POST(req, { params: Promise.resolve({ partner: "photobooth" }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  ingest.mockReset();
  partner.value = { id: "pt1", is_active: true, signing_secret: "s3cret" };
  signatureOk.value = true;
});

describe("POST /api/integrations/loyalty-events/[partner]", () => {
  it("partner nonaktif, timestamp basi, atau tanda tangan salah → 401 tanpa ingest", async () => {
    partner.value = { ...partner.value!, is_active: false };
    expect((await post("{}")).status).toBe(401);
    partner.value = { ...partner.value!, is_active: true };
    expect((await post("{}", "stale")).status).toBe(401);
    signatureOk.value = false;
    expect((await post("{}")).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("body bukan JSON / tidak valid → 400; valid → diingest idempoten", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ event_type: "x" }))).status).toBe(400);
    ingest.mockResolvedValue({ event: { id: "e1", status: "awarded", xp_awarded: 10 }, duplicate: false });
    const ok = await post(JSON.stringify({ external_id: "ext-1", event_type: "photo", phone: "0811" }));
    expect(ok).toMatchObject({ status: 200, json: { data: { id: "e1", xp_awarded: 10, duplicate: false } } });
    expect(ingest).toHaveBeenCalledWith(partner.value, expect.objectContaining({ externalId: "ext-1", subject: "0811" }));
  });
});
