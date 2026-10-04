import { Resend } from "resend";
import { escapeHtml } from "@/lib/security/escape-html";

/**
 * Badan email lamaran dari form karir publik. Semua nilai berasal dari
 * pelamar (atau master yang bisa diubah admin), jadi setiap nilai di-escape.
 */

export interface ApplicationEmailData {
  candidateId: string;
  fullName: string;
  email: string;
  phone: string;
  domicile: string;
  source: string;
  notes: string | null;
  positionTitle: string;
  brandName: string;
  /** Origin dashboard tanpa garis miring akhir. */
  origin: string;
}

/** Subjek email: tanpa CR/LF supaya nilai pelamar tidak menyisipkan header. */
export function emailSubject(text: string): string {
  return text.replace(/[\r\n]+/g, " ").slice(0, 200);
}

export function candidateConfirmationHtml(d: ApplicationEmailData): string {
  return `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Terima Kasih, ${escapeHtml(d.fullName)}!</h2>
              <p style="color: #555;">Lamaran kamu untuk posisi <strong>${escapeHtml(d.positionTitle)}</strong> di <strong>${escapeHtml(d.brandName)}</strong> sudah kami terima.</p>
              <p style="color: #555;">Tim HRD akan menghubungi kamu melalui WhatsApp atau email dalam 1-3 hari kerja.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis. Mohon tidak membalas email ini.</p>
            </div>
          `;
}

function row(label: string, valueHtml: string, extraStyle = ""): string {
  return `
                <tr>
                  <td style="padding: 8px 0; color: #555;${extraStyle}">${label}</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">${valueHtml}</td>
                </tr>`;
}

export function hrdNotificationHtml(d: ApplicationEmailData): string {
  const waNumber = d.phone.replace(/\D/g, "");
  const detailUrl = `${d.origin}/dashboard/hris/candidates/${encodeURIComponent(d.candidateId)}`;
  return `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Lamaran Baru Masuk</h2>
              <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">${[
                row("Nama", `<strong>${escapeHtml(d.fullName)}</strong>`, " width: 140px;"),
                row("Email", `<a href="mailto:${escapeHtml(d.email)}">${escapeHtml(d.email)}</a>`),
                row("No. WhatsApp", `<a href="https://wa.me/${waNumber}">${escapeHtml(d.phone)}</a>`),
                row("Domisili", escapeHtml(d.domicile)),
                row("Posisi", escapeHtml(d.positionTitle)),
                row("Outlet", escapeHtml(d.brandName)),
                row("Sumber", escapeHtml(d.source)),
                d.notes ? row("Catatan", escapeHtml(d.notes)) : "",
              ].join("")}
              </table>
              <div style="margin-top: 24px;">
                <a href="${escapeHtml(detailUrl)}" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Lihat di Dashboard</a>
              </div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis dari sistem Talent Pool.</p>
            </div>
          `;
}

/**
 * Konfirmasi ke pelamar + notifikasi ke HRD lewat Resend. Best-effort:
 * kegagalan email tidak membatalkan lamaran yang sudah tersimpan.
 */
export async function sendApplicationEmails(d: ApplicationEmailData): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const resend = new Resend(apiKey);
  const from = process.env.FROM_EMAIL ?? "noreply@aapextechnology.com";
  const hrdEmail = process.env.HRD_EMAIL;
  const messages = [
    { label: "Candidate", to: d.email, subject: "Lamaran Kamu Sudah Kami Terima", html: candidateConfirmationHtml(d) },
    ...(hrdEmail
      ? [
          {
            label: "HRD",
            to: hrdEmail,
            subject: emailSubject(`[Talent Pool] Lamaran Baru: ${d.fullName} untuk ${d.positionTitle}`),
            html: hrdNotificationHtml(d),
          },
        ]
      : []),
  ];
  for (const { label, ...message } of messages) {
    try {
      await resend.emails.send({ from, ...message });
    } catch (error) {
      console.error(`${label} email error:`, error);
    }
  }
}
