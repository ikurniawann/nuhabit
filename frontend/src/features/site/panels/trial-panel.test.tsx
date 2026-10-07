import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import TrialPanel from "./trial-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/locations/bsd" }));

afterEach(() => {
  vi.restoreAllMocks();
  window.dataLayer = undefined;
});

describe("TrialPanel", () => {
  test("renders the trial form with the panel's branch preselected", async () => {
    window.dataLayer = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [{ slug: "bsd", name: "NüHabit BSD" }] }), { status: 200 }),
    );
    render(<TrialPanel branchSlug="bsd" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "NüHabit BSD" })).toBeInTheDocument());
    expect(screen.getByLabelText("Cabang")).toHaveValue("bsd");
    expect(screen.getByRole("button", { name: /Ajukan coba gratis/ })).toBeInTheDocument();
    expect(window.dataLayer).toEqual([{ event: "trial_open", branch: "bsd" }]);
  });
});
