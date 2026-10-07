import type { SegmentDefinition } from "@/lib/crm/segments";
import type { PublicFormInput } from "@/lib/crm/public-forms";
import type { FormRow, FormSubmissionRow, SegmentPreview, SegmentRow } from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: Array<{ message: string }> };
    message = body.error ?? body.message ?? fallback;
    if (body.details?.length) message += `: ${body.details.map((d) => d.message).join("; ")}`;
  } catch {
    // bukan JSON
  }
  throw new Error(message);
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T; message?: string };
  return body.data;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── segmen ──
export const fetchSegments = () => fetch("/api/crm/segments").then((r) => json<SegmentRow[]>(r, "Gagal memuat segmen"));
export const previewDefinition = (definition: SegmentDefinition) =>
  fetch("/api/crm/segments/preview", jsonInit("POST", definition)).then((r) => json<SegmentPreview>(r, "Gagal menghitung segmen"));
export const recountSegment = (id: string) =>
  fetch(`/api/crm/segments/${id}/preview`, jsonInit("POST")).then((r) => json<SegmentPreview>(r, "Gagal menghitung ulang"));
export const createSegment = (v: { name: string; description?: string | null; definition: SegmentDefinition; is_active: boolean }) =>
  fetch("/api/crm/segments", jsonInit("POST", v)).then((r) => json(r, "Gagal menyimpan segmen"));
export const updateSegment = (id: string, v: Partial<{ name: string; description: string | null; definition: SegmentDefinition; is_active: boolean }>) =>
  fetch(`/api/crm/segments/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui segmen"));
export const deleteSegment = async (id: string) => {
  const r = await fetch(`/api/crm/segments/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus segmen");
};

// ── form publik ──
export const fetchForms = () => fetch("/api/crm/forms").then((r) => json<FormRow[]>(r, "Gagal memuat form"));
export const fetchSubmissions = (id: string) =>
  fetch(`/api/crm/forms/${id}`).then((r) => json<FormSubmissionRow[]>(r, "Gagal memuat kiriman"));
export const createForm = (v: PublicFormInput) => fetch("/api/crm/forms", jsonInit("POST", v)).then((r) => json(r, "Gagal membuat form"));
export const updateForm = (id: string, v: Partial<PublicFormInput>) =>
  fetch(`/api/crm/forms/${id}`, jsonInit("PATCH", v)).then((r) => json(r, "Gagal memperbarui form"));
export const deleteForm = async (id: string) => {
  const r = await fetch(`/api/crm/forms/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) await parseError(r, "Gagal menghapus form");
};
