import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MembershipPanel from "./membership-panel";

const branches = [
  { slug: "sulu-bandung", name: "Sulu Bandung", city: "Bandung" },
  { slug: "jakarta", name: "Jakarta", city: "Jakarta" },
];

const plans = {
  branch: { id: "b1", name: "Sulu Bandung", slug: "sulu-bandung" },
  plans: [
    { id: "c1", name: "Starter 5", kind: "credits", description: "", credits: 5, validity_days: 60, price_idr: 800000, badge: null, sort_order: 1 },
    { id: "p1", name: "4-Week Pass", kind: "pass", description: "", credits: 0, validity_days: 28, price_idr: 1000000, badge: "Most popular", sort_order: 2 },
  ],
};

function ok(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response);
}

describe("MembershipPanel", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    document.cookie = "nh_branch=; max-age=0";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        calls.push(input);
        return input.endsWith("/branches") ? ok(branches) : ok(plans);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("groups passes before credit packs with the branch price and links each to /join", async () => {
    render(<MembershipPanel branchSlug="sulu-bandung" onClose={() => {}} />);
    const pass = await screen.findByRole("region", { name: "Passes" });
    const credits = screen.getByRole("region", { name: "Credit Packs" });
    expect(pass.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pass).toHaveTextContent("4-Week Pass");
    expect(pass).toHaveTextContent("Most popular");
    expect(pass).toHaveTextContent("Rp1.000.000");
    expect(pass).toHaveTextContent("Valid for 4 weeks");
    expect(pass).toHaveTextContent("Unlimited class bookings");
    expect(credits).toHaveTextContent("5 class credits");
    expect(screen.getAllByRole("link", { name: "Choose" })[0]).toHaveAttribute("href", "/join?plan=p1&branch=sulu-bandung");
    expect(calls).toContain("/api/public/site/plans?branch=sulu-bandung");
  });

  it("falls back to the cookie branch", async () => {
    document.cookie = "nh_branch=jakarta";
    render(<MembershipPanel onClose={() => {}} />);
    await screen.findByRole("region", { name: "Passes" });
    expect(calls).toContain("/api/public/site/plans?branch=jakarta");
  });

  it("falls back to the first public branch without a cookie", async () => {
    render(<MembershipPanel onClose={() => {}} />);
    await screen.findByRole("region", { name: "Passes" });
    expect(calls).toContain("/api/public/site/plans?branch=sulu-bandung");
  });
});
