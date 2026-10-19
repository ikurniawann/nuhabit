import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecipeSettingsCard } from "./recipe-settings-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings = {
  product_id: "p1",
  raw_material_id: null,
  scrap_tolerance_pct: null,
  batch_size: null,
  effective_scrap_tolerance_pct: 5,
  default_scrap_tolerance_pct: 5,
};

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.method === "PUT" ? { ...settings, scrap_tolerance_pct: 10, effective_scrap_tolerance_pct: 10 } : settings;
    return new Response(JSON.stringify({ success: true, data: body, message: "Pengaturan resep disimpan" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecipeSettingsCard owner={{ productId: "p1" }} />
    </QueryClientProvider>
  );
}

describe("RecipeSettingsCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the default, refuses a tolerance above 100% and saves a valid one", async () => {
    const fetchMock = stubFetch();
    renderCard();
    const input = await screen.findByLabelText("Toleransi scrap (% dari qty rencana)");
    expect(input).toHaveValue(null);
    expect(screen.getByText("Kosongkan untuk memakai default 5%.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/production/recipe-settings?product_id=p1");

    fireEvent.change(input, { target: { value: "150" } });
    expect(screen.getByText("Toleransi scrap harus 0 sampai 100%")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Simpan Pengaturan" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "10" } });
    const batch = screen.getByLabelText("Ukuran batch (satuan hasil)");
    fireEvent.change(batch, { target: { value: "0" } });
    expect(screen.getByText("Ukuran batch harus lebih dari 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan Pengaturan" })).toBeDisabled();
    fireEvent.change(batch, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ product_id: "p1", scrap_tolerance_pct: 10, batch_size: 2 });
  });
});
