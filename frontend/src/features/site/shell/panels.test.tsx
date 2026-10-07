import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PANELS, readBranchCookie, resolvePanel, SitePanelsProvider, useSitePanels, type PanelKind } from "./panels";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

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
      <SitePanelsProvider>
        <Opener />
      </SitePanelsProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("open trial"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Coba gratis");
    expect(dialog).toHaveTextContent("bandung");

    fireEvent.click(screen.getByText("Tutup"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("open membership"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Membership");
  });
});
