import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalSearch } from "./global-search";

const search = vi.hoisted(() => ({ hits: [] as unknown[], searching: false }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/features/os-desktop/hooks/use-spotlight-search", () => ({ useSpotlightSearch: () => search }));
vi.mock("./nav-link", () => ({ useNavigate: () => navigate }));

const leaves = [{ href: "/dashboard/gym/members", label: "Member", icon: "home" as const, section: "Member" }];

function type(value: string) {
  render(<GlobalSearch leaves={leaves} />);
  const input = screen.getByRole("combobox", { name: "Quick search" });
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("GlobalSearch", () => {
  it("lists data after pages and opens the chosen record", () => {
    search.hits = [{ source: "member", label: "Member", items: [{ id: "1", title: "Member Budi", subtitle: "0812", href: "/dashboard/crm/members?q=0812" }] }];
    const input = type("member");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/dashboard/crm/members?q=0812");
  });

  it("says it is still looking before it says nothing matched", () => {
    search.hits = [];
    search.searching = true;
    type("zzz");
    expect(screen.getByText("Mencari…")).toBeTruthy();
  });
});
