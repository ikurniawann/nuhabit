import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectibleIdleSection } from "./collectible-idle-section";

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CollectibleIdleSection />
    </QueryClientProvider>
  );
}

describe("CollectibleIdleSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists members with idle avatar entitlements and links to the member", async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: {
        interval_xp: 500,
        total_idle: 7,
        active_artworks: 3,
        members: [{ customer_id: "c1", name: "Rina", phone: "0812", total_xp: 2600, quota: 5, used: 1, idle: 4 }],
      },
    });
    renderSection();
    const link = await screen.findByRole("link", { name: "Rina" });
    expect(link).toHaveAttribute("href", "/dashboard/crm/members/c1");
    expect(screen.getByText("Jatah menganggur").nextSibling).toHaveTextContent("7");
    expect(screen.getByText("Artwork aktif").nextSibling).toHaveTextContent("3");
    expect(fetchMock).toHaveBeenCalledWith("/api/crm/collectibles/idle-report", expect.anything());
  });

  it("shows the server error", async () => {
    stubFetch(403, { success: false, error: "Akses ditolak" });
    renderSection();
    expect(await screen.findByText("Akses ditolak")).toBeInTheDocument();
  });
});
