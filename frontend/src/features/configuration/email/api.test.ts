import { describe, expect, it } from "vitest";
import { buildEmailPayload, draftFrom, providerLabel, type EmailSettings } from "./api";

const settings: EmailSettings = {
  provider: "microsoft",
  transport: "graph",
  from_email: "ops@nuhabit.onmicrosoft.com",
  from_name: "NüHabit",
  resend_api_key_masked: null,
  has_resend_api_key: false,
  ms_tenant_id: "tenant",
  ms_client_id: "client",
  ms_client_secret_masked: "very••••••••alue",
  has_ms_client_secret: true,
  ms_sender: "",
  smtp_host: "",
  smtp_port: 0,
  smtp_user: "",
  smtp_password_masked: null,
  has_smtp_password: false,
  resolved: "microsoft-graph",
  configured: true,
  from_env: [],
};

describe("buildEmailPayload", () => {
  it("leaves untouched secrets out and keeps the rest", () => {
    const payload = buildEmailPayload(draftFrom(settings));
    expect(payload).toEqual({
      provider: "microsoft",
      transport: "graph",
      from_email: "ops@nuhabit.onmicrosoft.com",
      from_name: "NüHabit",
      ms_tenant_id: "tenant",
      ms_client_id: "client",
      ms_sender: "",
      smtp_host: "",
      smtp_port: null,
      smtp_user: "",
    });
    expect("ms_client_secret" in payload).toBe(false);
  });

  it("sends a typed secret trimmed and a cleared secret as null", () => {
    const draft = draftFrom(settings);
    draft.ms_client_secret = "  new-secret ";
    draft.resend_api_key = null;
    draft.smtp_port = " 587 ";
    const payload = buildEmailPayload(draft);
    expect(payload.ms_client_secret).toBe("new-secret");
    expect(payload.resend_api_key).toBeNull();
    expect(payload.smtp_port).toBe(587);
    expect("smtp_password" in payload).toBe(false);
  });
});

describe("providerLabel", () => {
  it("names the known providers and echoes the rest", () => {
    expect(providerLabel("microsoft-graph")).toBe("Microsoft Graph");
    expect(providerLabel("fake")).toBe("fake");
  });
});
