import { describe, expect, it } from "vitest";
import { buildInterviewScheduledMessage } from "./candidate-message";

describe("buildInterviewScheduledMessage", () => {
  it("online: memuat tanggal WIB, link, dan pewawancara", () => {
    const msg = buildInterviewScheduledMessage({
      candidateName: "Sari",
      interviewDate: "2026-10-05T03:00:00Z",
      interviewType: "Interview HR",
      mode: "online",
      meetingLink: "https://meet.test/abc",
      interviewerName: "Budi",
    });
    expect(msg).toContain("Halo Sari, jadwal interview telah ditentukan:");
    expect(msg).toContain("📅 *Interview HR*");
    expect(msg).toContain("🗓️ Tanggal: Senin, 5 Oktober 2026, 10.00 WIB");
    expect(msg).toContain("🔗 Link: https://meet.test/abc");
    expect(msg).toContain("👤 Interviewer: Budi");
  });

  it("offline: tanpa baris link meski link diisi", () => {
    const msg = buildInterviewScheduledMessage({
      candidateName: "Sari",
      interviewDate: "2026-10-05T03:00:00Z",
      interviewType: "Interview",
      mode: "offline",
      meetingLink: "https://meet.test/abc",
    });
    expect(msg).toContain("Offline (Tatap Muka)");
    expect(msg).not.toContain("🔗");
  });
});
