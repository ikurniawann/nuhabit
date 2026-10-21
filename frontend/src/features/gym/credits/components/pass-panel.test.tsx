import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { IamAccessProvider } from "@/components/iam/iam-access-provider";
import type { MemberCredits } from "../api";
import { PassesCard } from "./pass-panel";

const credits = {
  member: { id: "m1", name: "Rani", phone: "0812", email: null, is_active: true, membership_tier: null, ark_balance_idr: 0 },
  balance: 0,
  expiring_credits: 0,
  expiry_reminder_days: 7,
  low_balance: false,
  low_balance_threshold: 3,
  lots: [],
  passes: [
    {
      id: "p1",
      package_id: "k1",
      package_name: "Pass 30 hari",
      starts_at: "2026-10-01T00:00:00Z",
      ends_at: "2026-10-31T00:00:00Z",
      status: "active",
      upcoming: false,
      days_left: 10,
      frozen_at: null,
      frozen_until: null,
      auto_renew: false,
      renew_with: "invoice",
      purchase_id: "u1",
    },
  ],
  freeze: { max_days_per_year: 30, min_days: 7, used_days: 0, remaining_days: 30 },
  transfer: { member_enabled: false, monthly_cap: 0, sent_this_month: 0 },
  entries: [],
  purchases: [],
  transfers: [],
} satisfies MemberCredits;

function renderAs(creditsActions: string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <IamAccessProvider grantedCodes={["gym.credits"]} grantedActions={{ "gym.credits": creditsActions }}>
        {children}
      </IamAccessProvider>
    </QueryClientProvider>
  );
  render(<PassesCard credits={credits} onDone={() => {}} />, { wrapper });
}

describe("PassesCard permissions", () => {
  it("hides freeze, extend and auto-renew from front desk (read, create)", () => {
    renderAs(["read", "create"]);
    expect(screen.getByText("Pass 30 hari")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bekukan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Perpanjang" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("Tidak")).toBeInTheDocument();
  });

  it("shows them to a manager (update)", () => {
    renderAs(["read", "create", "update"]);
    expect(screen.getByRole("button", { name: "Bekukan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perpanjang" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Perpanjang otomatis Pass 30 hari" })).toBeInTheDocument();
  });
});
