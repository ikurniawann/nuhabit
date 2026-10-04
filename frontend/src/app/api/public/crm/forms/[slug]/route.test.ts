// /api/public/crm/forms/[slug]: tanpa sesi; rate limit per IP sebelum DB,
// slug tidak dikenal → 404, kiriman diteruskan ke submitPublicForm.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const forms = vi.hoisted(() => ({
  loadPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  formFields: vi.fn(() => [{ key: "pic_phone", label: "WhatsApp", type: "phone", required: true }]),
}));
vi.mock("@/lib/crm/public-forms-server", () => forms);

const rateLimit = vi.hoisted(() => ({ checkRateLimit: vi.fn(() => true), clientIpFrom: vi.fn(() => "10.0.0.1") }));
vi.mock("@/lib/public/rate-limit", () => rateLimit);

import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kontak" }) };
const FORM = {
  id: "f1",
  slug: "kontak",
  title: "Hubungi kami",
  description: null,
  fields: [],
  submit_label: "Kirim",
  success_message: "Terima kasih!",
  redirect_url: null,
};

function post(body: string) {
  return new Request("http://localhost/api/public/crm/forms/kontak", {
    method: "POST",
    body,
    headers: { "user-agent": "vitest" },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.checkRateLimit.mockReturnValue(true);
});

describe("GET", () => {
  it("404 bila form tidak aktif / tidak ada", async () => {
    forms.loadPublicForm.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost") as unknown as NextRequest, ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Form tidak ditemukan" });
  });

  it("hanya field publik yang dikirim", async () => {
    forms.loadPublicForm.mockResolvedValue({ ...FORM, notify_numbers: ["0812"], company_id: "co" });
    const json = await (await GET(new Request("http://localhost") as unknown as NextRequest, ctx)).json();
    expect(json.data).toEqual({
      slug: "kontak",
      title: "Hubungi kami",
      description: null,
      fields: forms.formFields.mock.results[0].value,
      submit_label: "Kirim",
      success_message: "Terima kasih!",
      redirect_url: null,
    });
  });
});

describe("POST", () => {
  it("429 sebelum menyentuh DB bila rate limit habis", async () => {
    rateLimit.checkRateLimit.mockReturnValue(false);
    const res = await POST(post("{}"), ctx);
    expect(res.status).toBe(429);
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith("crm-form:10.0.0.1", { limit: 5, windowMs: 300_000 });
    expect(forms.loadPublicForm).not.toHaveBeenCalled();
  });

  it("400 bila body bukan JSON", async () => {
    forms.loadPublicForm.mockResolvedValue(FORM);
    const res = await POST(post("bukan-json"), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Isian tidak terbaca" });
  });

  it("galat validasi dari lib diteruskan dengan details", async () => {
    forms.loadPublicForm.mockResolvedValue(FORM);
    forms.submitPublicForm.mockRejectedValue(ApiError.badRequest("Periksa kembali isian Anda", { pic_phone: "Wajib" }));
    const res = await POST(post(JSON.stringify({ pic_phone: "" })), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Periksa kembali isian Anda",
      details: { pic_phone: "Wajib" },
    });
  });

  it("sukses: pesan & redirect dari form, IP dan user agent diteruskan", async () => {
    forms.loadPublicForm.mockResolvedValue(FORM);
    forms.submitPublicForm.mockResolvedValue({ message: "Terima kasih!", redirect_url: null });
    const res = await POST(post(JSON.stringify({ pic_phone: "0812" })), ctx);
    expect(await res.json()).toEqual({ success: true, data: { message: "Terima kasih!", redirect_url: null } });
    expect(forms.submitPublicForm).toHaveBeenCalledWith(FORM, { pic_phone: "0812" }, { ip: "10.0.0.1", userAgent: "vitest" });
  });
});
