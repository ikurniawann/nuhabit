import { describe, expect, it } from "vitest";
import {
  EMPTY_CAMPAIGN_FORM,
  campaignSummary,
  defaultSendAt,
  isCampaignFormInvalid,
  isCancellable,
  primaryCampaignAction,
  segmentFromForm,
  toCreateCampaignInput,
  withChannel,
  type CampaignForm,
} from "./campaign-form";
import type { CrmCampaign } from "./types";

const valid = (patch: Partial<CampaignForm> = {}): CampaignForm => ({
  ...EMPTY_CAMPAIGN_FORM,
  name: "Win-back Juli",
  promo_campaign_id: "p1",
  ...patch,
});

describe("campaign form", () => {
  it("defaults 'send later' to tomorrow 10:00 local time", () => {
    const now = new Date(2026, 9, 4, 15, 30).getTime();
    expect(defaultSendAt(now)).toBe("2026-10-05T10:00");
  });

  it("parses the simple segment", () => {
    expect(segmentFromForm(valid({ last_visit_days: "", min_xp: "100", tiers: " gold, ,silver " }))).toEqual({
      last_visit_days: null,
      tiers: ["gold", "silver"],
      min_xp: 100,
    });
  });

  it("toggles channels without duplicates", () => {
    expect(withChannel(["wa"], "wa", true)).toEqual(["wa"]);
    expect(withChannel(["wa"], "in_app", true)).toEqual(["wa", "in_app"]);
    expect(withChannel(["wa", "in_app"], "wa", false)).toEqual(["in_app"]);
  });

  it("validates the form", () => {
    expect(isCampaignFormInvalid(valid())).toBe(false);
    expect(isCampaignFormInvalid(valid({ channels: [] }))).toBe(true);
    expect(isCampaignFormInvalid(valid({ name: "A" }))).toBe(true);
    expect(isCampaignFormInvalid(valid({ message_template: "pendek" }))).toBe(true);
    expect(isCampaignFormInvalid(valid({ voucher_prefix: "W" }))).toBe(true);
    expect(isCampaignFormInvalid(valid({ promo_mode: "public", voucher_prefix: "W" }))).toBe(false);
    expect(isCampaignFormInvalid(valid({ send_at: "bukan-tanggal" }))).toBe(true);
    // {kode} wajib ada bila ada promo, dan dilarang bila tanpa promo.
    expect(isCampaignFormInvalid(valid({ promo_campaign_id: "" }))).toBe(true);
    expect(isCampaignFormInvalid(valid({ message_template: "Halo {nama}, apa kabar hari ini?" }))).toBe(true);
    expect(
      isCampaignFormInvalid(valid({ promo_campaign_id: "", message_template: "Halo {nama}, apa kabar hari ini?" }))
    ).toBe(false);
  });

  it("builds the create payload", () => {
    const input = toCreateCampaignInput(
      valid({
        name: "  Win-back ",
        voucher_prefix: " win ",
        daily_cap: "50",
        channels: ["wa", "in_app"],
        inapp_title: " Kangen ",
        image_url: "  ",
        segment_id: "seg-1",
      })
    );
    expect(input).toMatchObject({
      name: "Win-back",
      segment_id: "seg-1",
      promo_campaign_id: "p1",
      promo_mode: "batch",
      voucher_prefix: "WIN",
      daily_cap: 50,
      inapp_title: "Kangen",
      image_url: null,
      link_url: null,
      scheduled_at: null,
    });
  });

  it("drops promo and in-app fields when not used", () => {
    const input = toCreateCampaignInput(valid({ promo_campaign_id: "", inapp_title: "x", send_at: "2026-10-05T10:00" }));
    expect(input).toMatchObject({ promo_campaign_id: null, promo_mode: null, voucher_prefix: null, inapp_title: null });
    expect(input.scheduled_at).toBe(new Date("2026-10-05T10:00").toISOString());
  });

  it("summarises a campaign row", () => {
    const base = { promo_mode: null, promo_campaign_id: null, voucher_prefix: null, daily_cap: null, channels: ["wa"] };
    expect(campaignSummary(base as unknown as CrmCampaign)).toBe("tanpa promo · WhatsApp");
    expect(
      campaignSummary({ ...base, promo_mode: "batch", voucher_prefix: "WIN", daily_cap: 20, channels: ["wa", "in_app"] } as unknown as CrmCampaign)
    ).toBe("voucher batch (WIN-…) · cap 20/hari · WhatsApp + In-app");
    expect(campaignSummary({ ...base, promo_mode: "public", promo_campaign_id: "p" } as unknown as CrmCampaign)).toBe(
      "kode publik · WhatsApp"
    );
  });

  it("maps status to the primary action and cancellability", () => {
    expect(primaryCampaignAction("draft")).toEqual({ action: "start", label: "Mulai" });
    expect(primaryCampaignAction("scheduled")).toEqual({ action: "start", label: "Kirim sekarang" });
    expect(primaryCampaignAction("failed")).toEqual({ action: "resume", label: "Lanjutkan" });
    expect(primaryCampaignAction("sending")).toBeNull();
    expect(isCancellable("sending")).toBe(true);
    expect(isCancellable("done")).toBe(false);
  });
});
