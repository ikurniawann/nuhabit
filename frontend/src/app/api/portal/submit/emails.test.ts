import { describe, expect, it } from "vitest";
import {
  candidateConfirmationHtml,
  emailSubject,
  hrdNotificationHtml,
  type ApplicationEmailData,
} from "./emails";

const data: ApplicationEmailData = {
  candidateId: "c-1",
  fullName: `<a href="https://evil.example">Klik</a>`,
  email: `x"@evil.example`,
  phone: "0812<script>",
  domicile: "<b>Bandung</b>",
  source: "instagram",
  notes: "<img src=x onerror=alert(1)>",
  positionTitle: "Barista",
  brandName: "Kopi & Co",
  origin: "https://app.example",
};

describe("portal application emails", () => {
  it("escapes every applicant value in the candidate email", () => {
    const html = candidateConfirmationHtml(data);
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Klik&lt;/a&gt;");
    expect(html).toContain("Kopi &amp; Co");
  });

  it("escapes applicant values in the HRD email and links to the candidate page", () => {
    const html = hrdNotificationHtml(data);
    expect(html).not.toMatch(/<script>|<img|<b>Bandung/);
    expect(html).toContain('href="mailto:x&quot;@evil.example"');
    expect(html).toContain('href="https://wa.me/0812"');
    expect(html).toContain('href="https://app.example/dashboard/hris/candidates/c-1"');
    expect(html).not.toContain("vercel.app");
  });

  it("strips line breaks from the subject", () => {
    expect(emailSubject("Lamaran\r\nBcc: a@b.c")).toBe("Lamaran Bcc: a@b.c");
  });
});
