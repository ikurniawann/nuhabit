import { describe, expect, it } from "vitest";
import {
  challengeMetricText,
  challengeRewardText,
  eventSeat,
  formatRp,
  tierProgressPct,
  topupAmountError,
  type Translate,
} from "./loyalty";

/** t palsu: kunci apa adanya, placeholder diisi. */
const t: Translate = (key, vars) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));

describe("challengeMetricText", () => {
  it("shows spend in rupiah and visits as a count", () => {
    expect(challengeMetricText(t, "spend", 150000)).toBe("Rp 150.000");
    expect(challengeMetricText(t, "visits", 12)).toBe("12 visits");
  });
});

describe("challengeRewardText", () => {
  it("joins XP and ARK rewards", () => {
    expect(challengeRewardText(t, { reward_xp: 500, reward_ark_idr: 10000 })).toBe("500 XP + ARK worth Rp 10.000");
  });

  it("leaves out empty parts", () => {
    expect(challengeRewardText(t, { reward_xp: 0, reward_ark_idr: 25000 })).toBe("ARK worth Rp 25.000");
    expect(challengeRewardText(t, { reward_xp: 0, reward_ark_idr: 0 })).toBe("");
  });
});

describe("eventSeat", () => {
  const base = { booking_status: null, confirmed_count: 3, capacity: 10 };

  it("reports the member's own booking first", () => {
    expect(eventSeat({ ...base, booking_status: "confirmed" })).toBe("confirmed");
    expect(eventSeat({ ...base, booking_status: "waitlist", confirmed_count: 10 })).toBe("waitlist");
  });

  it("sends new sign-ups to the waitlist once the event is full", () => {
    expect(eventSeat({ ...base, confirmed_count: 10 })).toBe("full");
    expect(eventSeat({ ...base, confirmed_count: 11 })).toBe("full");
    expect(eventSeat(base)).toBe("open");
  });
});

describe("topupAmountError", () => {
  it("rejects amounts under the minimum or over the maximum", () => {
    expect(topupAmountError(t, 5000, 10000, 1000000)).toBe("Minimum Rp 10.000");
    expect(topupAmountError(t, 2000000, 10000, 1000000)).toBe("Maximum Rp 1.000.000");
  });

  it("accepts amounts in range, with no upper limit when max is 0", () => {
    expect(topupAmountError(t, 10000, 10000, 1000000)).toBeNull();
    expect(topupAmountError(t, 50000000, 10000, 0)).toBeNull();
  });
});

describe("tierProgressPct", () => {
  it("measures XP against the next tier threshold, capped at 100", () => {
    expect(tierProgressPct(250, 1000)).toBe(25);
    expect(tierProgressPct(1500, 1000)).toBe(100);
  });

  it("is full at the top tier", () => {
    expect(tierProgressPct(9000, null)).toBe(100);
  });
});

it("formatRp uses Indonesian digit grouping", () => {
  expect(formatRp(1234567)).toBe("Rp 1.234.567");
});
