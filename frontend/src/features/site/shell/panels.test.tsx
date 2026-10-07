import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { PANELS, readBranchCookie, resolvePanel, SitePanelsProvider, useSitePanels, type PanelKind } from "./panels";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: [{ slug: "bandung", name: "NüHabit Bandung" }] }), { status: 200 }),
  );
});

afterEach(() => vi.restoreAllMocks());

const KINDS: PanelKind[] = ["timetable", "trial", "membership", "cart"];

describe("panel registry", () => {
  it("registers the four slide-overs with a title and a component", () => {
    for (const kind of KINDS) {
      expect(PANELS[kind].title).toBeTruthy();
      expect(typeof PANELS[kind].Component).toBe("function");
    }
  });

  it("reads the remembered branch from the cookie", () => {
    expect(readBranchCookie("a=1; nh_branch=sulu-bandung; b=2")).toBe("sulu-bandung");
    expect(readBranchCookie("nh_branch=")).toBeUndefined();
    expect(readBranchCookie("")).toBeUndefined();
  });

  it("prefers an explicit branch over the cookie", () => {
    expect(resolvePanel("trial", "jakarta", "nh_branch=bandung")).toEqual({ kind: "trial", branchSlug: "jakarta" });
    expect(resolvePanel("trial", undefined, "nh_branch=bandung")).toEqual({ kind: "trial", branchSlug: "bandung" });
    expect(resolvePanel("cart", undefined, "")).toEqual({ kind: "cart", branchSlug: undefined });
  });
});

function Opener() {
  const panels = useSitePanels();
  return (
    <>
      <button onClick={() => panels.open("trial", "bandung")}>open trial</button>
      <button onClick={() => panels.open("membership")}>open membership</button>
    </>
  );
}

describe("SitePanelsProvider", () => {
  it("opens the requested panel in a dialog and closes it again", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SitePanelsProvider>
          <Opener />
        </SitePanelsProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("open trial"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Coba gratis");
    expect(await screen.findByRole("option", { name: "NüHabit Bandung" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cabang")).toHaveValue("bandung");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("open membership"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Membership");
  });
});
