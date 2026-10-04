import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { formFields, loadPublicForm, submitPublicForm } from "@/lib/crm/public-forms-server";

type Ctx = { params: Promise<{ slug: string }> };

async function requirePublicForm(slug: string) {
  const form = await loadPublicForm(slug);
  if (!form) throw ApiError.notFound("Form tidak ditemukan");
  return form;
}

/** EPIC-050 T-5.3 — definisi form untuk dirender halaman publik. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const form = await requirePublicForm((await params).slug);
  return NextResponse.json({
    success: true,
    data: {
      slug: form.slug,
      title: form.title,
      description: form.description,
      fields: formFields(form.fields),
      submit_label: form.submit_label,
      success_message: form.success_message,
      redirect_url: form.redirect_url,
    },
  });
}, "public.crm.forms.GET");

/** Kiriman form publik → lead + scoring + workflow + notifikasi sales. */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { slug } = await params;
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`crm-form:${ip}`, { limit: 5, windowMs: 5 * 60_000 })) {
    throw ApiError.tooManyRequests("Terlalu banyak kiriman — coba lagi beberapa menit lagi");
  }

  const form = await requirePublicForm(slug);
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    throw ApiError.badRequest("Isian tidak terbaca");
  }

  const data = await submitPublicForm(form, payload, { ip, userAgent: request.headers.get("user-agent") });
  return NextResponse.json({ success: true, data });
}, "public.crm.forms.POST");
