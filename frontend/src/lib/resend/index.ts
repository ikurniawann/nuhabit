// Resend Email integration

import { Resend } from "resend";
import { escapeHtml } from "@/lib/security/escape-html";

// Klien dibuat saat email pertama dikirim, bukan saat modul di-import, supaya
// kunci dibaca dari env runtime container. Tanpa kunci: satu peringatan saja.
let client: Resend | null = null;
let warnedMissingKey = false;

function resendClient(): Resend | null {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedMissingKey) console.warn("[resend] RESEND_API_KEY belum diset; email tidak dikirim");
    warnedMissingKey = true;
    return null;
  }
  client = new Resend(apiKey);
  return client;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const resend = resendClient();
  if (!resend) return false;

  try {
    const { error } = await resend.emails.send({
      from: payload.from || "Talent Pool <onboarding@resend.dev>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });

    if (error) {
      console.error("Resend error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Email send error:", err);
    return false;
  }
}

// --- Email Templates ---

export function candidateStatusEmail(
  candidateName: string,
  status: string,
  notes?: string
) {
  const statusLabels: Record<string, string> = {
    applied: "Applied",
    screening: "Screening",
    psikotes: "Psikotes",
    interview: "Interview",
    offer: "Offer",
    talent_pool: "Talent Pool",
    hired: "Diterima",
    rejected: "Tidak Diterima",
  };

  return {
    subject: `Update Status Lamaran - ${candidateName}`,
    html: `
      <h2>Hi ${escapeHtml(candidateName)},</h2>
      <p>Status lamaran kamu saat ini: <strong>${escapeHtml(statusLabels[status] || status)}</strong></p>
      ${notes ? `<p>Catatan: ${escapeHtml(notes)}</p>` : ""}
      <p>Terima kasih sudah melamar di Aapex Technology.</p>
    `,
  };
}
