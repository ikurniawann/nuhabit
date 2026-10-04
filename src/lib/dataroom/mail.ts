import { brandName } from "@/lib/branding";
import { sendEmail } from "@/lib/resend";
import { appOrigin } from "@/lib/app-origin";

const FROM = process.env.DATAROOM_FROM_EMAIL ?? process.env.FROM_EMAIL ?? "Dataroom <onboarding@resend.dev>";
const BRAND = brandName();

export function shareUrl(token: string): string {
  return `${appOrigin()}/share/${token}`;
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
}

function shell(title: string, body: string): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
  <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 8px">${esc(BRAND)} · Dataroom</p>
  <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
  ${body}
  <p style="font-size:12px;color:#9ca3af;margin-top:24px">Email ini dikirim otomatis. Bila Anda tidak merasa meminta akses, abaikan saja.</p>
</div>`;
}

export function renderCodeEmail(input: { code: string; shareName: string; minutes: number }): string {
  return shell("Kode verifikasi akses", `
  <p>Gunakan kode berikut untuk membuka <strong>${esc(input.shareName)}</strong>:</p>
  <p style="font-size:32px;letter-spacing:.35em;font-weight:700;margin:16px 0;font-variant-numeric:tabular-nums">${esc(input.code)}</p>
  <p style="color:#6b7280">Kode berlaku ${input.minutes} menit dan hanya bisa dipakai sekali.</p>`);
}

export function renderLinkEmail(input: {
  shareName: string; kind: "folder" | "file"; url: string; senderName: string;
  expiresAt: Date; hasPin: boolean;
}): string {
  const until = input.expiresAt.toLocaleString("id-ID", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });
  return shell(`${input.senderName} membagikan ${input.kind === "folder" ? "folder" : "file"} kepada Anda`, `
  <p><strong>${esc(input.shareName)}</strong></p>
  <p><a href="${esc(input.url)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Buka ${input.kind === "folder" ? "folder" : "file"}</a></p>
  <p style="color:#6b7280;font-size:14px">Link aktif sampai ${esc(until)} WIB. Saat membuka, Anda akan diminta memverifikasi email ini${input.hasPin ? " dan memasukkan PIN yang diberikan pengirim" : ""}.</p>
  <p style="font-size:12px;color:#9ca3af;word-break:break-all">${esc(input.url)}</p>`);
}

/** Kirim kode; di luar production kode juga dicetak ke log server (uji lokal). */
export async function sendShareCode(email: string, code: string, shareName: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[dataroom] kode verifikasi ${email}: ${code}`);
  }
  return sendEmail({
    to: email, from: FROM,
    subject: `Kode akses Dataroom: ${code}`,
    html: renderCodeEmail({ code, shareName, minutes: 10 }),
  });
}

export async function sendShareLink(input: {
  emails: string[]; shareName: string; kind: "folder" | "file"; token: string;
  senderName: string; expiresAt: Date; hasPin: boolean;
}): Promise<{ sent: number; failed: string[] }> {
  const url = shareUrl(input.token);
  const failed: string[] = [];
  let sent = 0;
  for (const email of input.emails) {
    const ok = await sendEmail({
      to: email, from: FROM,
      subject: `${input.senderName} membagikan "${input.shareName}" (${BRAND} Dataroom)`,
      html: renderLinkEmail({ ...input, url }),
    });
    if (ok) sent += 1; else failed.push(email);
  }
  return { sent, failed };
}
