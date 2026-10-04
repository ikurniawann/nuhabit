import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const ctor = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    constructor(key: string) {
      ctor(key);
    }
  },
}));

const payload = { to: "a@b.id", subject: "s", html: "<p>x</p>" };

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    send.mockReset().mockResolvedValue({ error: null });
    ctor.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("tanpa RESEND_API_KEY: tidak membuat klien dan memperingatkan sekali", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await import("./index");
    expect(await sendEmail(payload)).toBe(false);
    expect(await sendEmail(payload)).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("membaca kunci saat kirim pertama, bukan saat import", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { sendEmail } = await import("./index");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(await sendEmail(payload)).toBe(true);
    expect(await sendEmail(payload)).toBe(true);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith("re_test");
  });
});

describe("candidateStatusEmail", () => {
  it("meng-escape nama dan catatan kandidat", async () => {
    const { candidateStatusEmail } = await import("./index");
    const { html } = candidateStatusEmail("<img src=x onerror=alert(1)>", "hired", "<script>x</script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
