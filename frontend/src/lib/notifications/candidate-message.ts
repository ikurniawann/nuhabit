import { formatDateLong, formatTime } from "@/lib/format";

export interface InterviewScheduleInput {
  candidateName: string;
  interviewDate: string;
  interviewType: string;
  mode: "offline" | "online";
  meetingLink?: string;
  interviewerName?: string;
}

/** Pesan WhatsApp/email jadwal interview untuk kandidat (tanggal & jam WIB). */
export function buildInterviewScheduledMessage({
  candidateName,
  interviewDate,
  interviewType,
  mode,
  meetingLink,
  interviewerName,
}: InterviewScheduleInput): string {
  const lines = [
    `Halo ${candidateName}, jadwal interview telah ditentukan:`,
    "",
    `📅 *${interviewType}*`,
    `🗓️ Tanggal: ${formatDateLong(interviewDate)}, ${formatTime(interviewDate)} WIB`,
    `📍 Mode: ${mode === "online" ? "Online (Zoom/Google Meet)" : "Offline (Tatap Muka)"}`,
  ];
  if (mode === "online" && meetingLink) lines.push(`🔗 Link: ${meetingLink}`);
  if (interviewerName) lines.push(`👤 Interviewer: ${interviewerName}`);
  lines.push("", "Mohon konfirmasi kehadiran. Terima kasih!");
  return lines.join("\n");
}
