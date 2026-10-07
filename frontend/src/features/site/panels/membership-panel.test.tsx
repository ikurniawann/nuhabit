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
    { id: "p1", name: "Pass 4 Minggu", kind: "pass", description: "", credits: 0, validity_days: 28, price_idr: 1000000, badge: "Paling laris", sort_order: 2 },
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
    const pass = await screen.findByRole("region", { name: "Pass" });
    const credits = screen.getByRole("region", { name: "Paket Kredit" });
    expect(pass.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pass).toHaveTextContent("Pass 4 Minggu");
    expect(pass).toHaveTextContent("Paling laris");
    expect(pass).toHaveTextContent("Rp1.000.000");
    expect(pass).toHaveTextContent("Berlaku 4 minggu");
    expect(pass).toHaveTextContent("Booking kelas tanpa batas");
    expect(credits).toHaveTextContent("5 kredit kelas");
    expect(screen.getAllByRole("link", { name: "Pilih" })[0]).toHaveAttribute("href", "/join?plan=p1&branch=sulu-bandung");
    expect(calls).toContain("/api/public/site/plans?branch=sulu-bandung");
  });

  it("falls back to the cookie branch", async () => {
    document.cookie = "nh_branch=jakarta";
    render(<MembershipPanel onClose={() => {}} />);
    await screen.findByRole("region", { name: "Pass" });
    expect(calls).toContain("/api/public/site/plans?branch=jakarta");
  });

  it("falls back to the first public branch without a cookie", async () => {
    render(<MembershipPanel onClose={() => {}} />);
    await screen.findByRole("region", { name: "Pass" });
    expect(calls).toContain("/api/public/site/plans?branch=sulu-bandung");
  });
});
