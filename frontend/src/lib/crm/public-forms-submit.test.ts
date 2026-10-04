// submitPublicForm: setiap kiriman dicatat; bot dibalas sukses tanpa lead,
// isian salah → 400, venue belum diset → 503, sukses → lead + hitungan.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/auth";

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: vi.fn(() => ({})) }));
vi.mock("@/lib/crm/server", () => ({
  getCrmDefaultVenue: vi.fn(async () => ({ companyId: null, branchId: null })),
}));
const events = vi.hoisted(() => ({ emitCrmEvent: vi.fn() }));
vi.mock("@/lib/crm/events", () => events);
vi.mock("@/lib/crm/workflow-engine", () => ({ notifyUsers: vi.fn(async () => 0) }));
vi.mock("@/lib/whatsapp/gateway", () => ({ loadGatewayConfig: vi.fn(async () => null), sendGatewayText: vi.fn() }));
vi.mock("@/lib/sales-funnel/server", () => ({
  normalizePhone: (raw: string) => raw.replace(/\D/g, "").replace(/^0/, "62"),
  isValidNormalizedPhone: (p: string) => /^62\d{8,13}$/.test(p),
}));

import { submitPublicForm, type PublicFormRow } from "./public-forms-server";
import { triggerForEvent } from "./workflow";

const FORM: PublicFormRow = {
  id: "f1",
  company_id: "co-1",
  branch_id: "br-1",
  slug: "kontak",
  name: "Kontak",
  title: "Hubungi kami",
  description: null,
  fields: [],
  submit_label: "Kirim",
  success_message: "Terima kasih!",
  redirect_url: "https://example.com/ok",
  default_source: "lainnya",
  notify_user_ids: [],
  notify_numbers: [],
  is_active: true,
};
const CLIENT = { ip: "10.0.0.1", userAgent: "vitest" };
const VALID = { org_name: "PT Kopi", pic_name: "Ani", pic_phone: "081234567890", notes: "Sewa tempat" };
const DONE = { message: "Terima kasih!", redirect_url: "https://example.com/ok" };

/** Status kiriman yang dicatat (kolom ke-7 INSERT crm_form_submissions). */
const recorded = () =>
  db.query.mock.calls
    .filter(([sql]) => String(sql).includes("crm_form_submissions"))
    .map(([, values]) => (values as unknown[])[6]);

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
});

describe("submitPublicForm", () => {
  it("bot (honeypot terisi) dibalas sukses tanpa membuat lead", async () => {
    await expect(submitPublicForm(FORM, { website_url: "spam" }, CLIENT)).resolves.toEqual(DONE);
    expect(recorded()).toEqual(["rejected"]);
    expect(events.emitCrmEvent).not.toHaveBeenCalled();
  });

  it("isian tidak valid → 400 dan tetap dicatat", async () => {
    const error = await submitPublicForm(FORM, { pic_name: "Ani" }, CLIENT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: "Periksa kembali isian Anda" });
    expect(recorded()).toEqual(["rejected"]);
  });

  it("venue belum diset → 503", async () => {
    const error = await submitPublicForm({ ...FORM, company_id: null }, VALID, CLIENT).catch(
      (e: unknown) => e
    );
    expect(error).toMatchObject({ status: 503 });
    expect(recorded()).toEqual(["rejected"]);
  });

  it("sukses: lead baru, event CRM, hitungan kiriman bertambah", async () => {
    // Belum ada lead dengan nomor + instansi sama, lalu INSERT mengembalikan id.
    db.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "lead-1" });
    await expect(submitPublicForm(FORM, VALID, CLIENT)).resolves.toEqual(DONE);
    expect(events.emitCrmEvent).toHaveBeenCalledWith(expect.objectContaining({ subject_id: "lead-1", event_type: "lead.created" }));
    expect(recorded()).toEqual(["ok"]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("submission_count + 1"))).toBe(true);
  });

  it("lead dari form memicu workflow 'lead dibuat' seperti lead dari dashboard", async () => {
    db.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "lead-1" });
    await submitPublicForm(FORM, VALID, CLIENT);
    const [event] = events.emitCrmEvent.mock.calls[0] as [{ event_type: string }];
    expect(triggerForEvent(event.event_type)).toEqual({ object: "lead", trigger: "created" });
  });
});
