import { describe, expect, it } from "vitest";
import { buildQueueSlipHtml } from "./print-queue-slip";

describe("buildQueueSlipHtml", () => {
  it("escapes guest name, merchant and table labels", () => {
    const html = buildQueueSlipHtml({
      queueLabel: "A12",
      guestName: `<svg onload=alert(1)>`,
      paxCount: 2,
      dateLabel: "4 Okt",
      timeLabel: "19:00",
      tableLabel: "</div><script>x</script>",
      merchantName: "Kopi & Co",
    });
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
    expect(html).toContain("Kopi &amp; Co");
    expect(html).toContain(">A12<");
  });
});
