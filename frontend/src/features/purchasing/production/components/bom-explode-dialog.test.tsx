import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BomExplosion, BomNode } from "@/lib/purchasing/production-ui-explode";
import { BomExplodeDialog } from "./bom-explode-dialog";

const line = (fields: Partial<BomNode>): BomNode => ({
  raw_material_id: "rm",
  kode: "RM",
  nama: "Bahan",
  satuan: "kg",
  level: 1,
  qty_per_parent: 1,
  recipe_qty_per: 1,
  recipe_satuan: "kg",
  unit_factor: 1,
  waste_factor: 0,
  qty_required: 1,
  qty_onhand: 0,
  shortage_qty: 0,
  unit_cost: 0,
  total_cost: 0,
  rolled_unit_cost: null,
  has_recipe: false,
  children: null,
  ...fields,
});

const explosion: BomExplosion = {
  item: { id: "p1", kode: "BRD", nama: "Roti", satuan: "pcs", type: "product" },
  qty: 2,
  lines: [
    line({
      raw_material_id: "dough",
      kode: "DGH",
      nama: "Adonan",
      has_recipe: true,
      waste_factor: 0.05,
      qty_required: 2.1,
      children: [line({ raw_material_id: "flour", kode: "FLR", nama: "Tepung", level: 2, qty_required: 1.5 })],
    }),
  ],
  leaves: [
    line({ raw_material_id: "flour", kode: "FLR", nama: "Tepung", qty_required: 1.5, qty_onhand: 1, shortage_qty: 0.5, total_cost: 15000 }),
  ],
  stock_cost: 21000,
  rolled_cost: 15000,
  depth: 2,
};

function renderDialog() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify({ success: true, data: explosion }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BomExplodeDialog open onOpenChange={() => {}} owner={{ productId: "p1" }} itemName="Roti" />
    </QueryClientProvider>
  );
  return fetchMock;
}

describe("BomExplodeDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the recipe tree and the bought materials for the quantity", async () => {
    const fetchMock = renderDialog();
    expect(await screen.findByText("Adonan")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/production/bom/explode?product_id=p1&qty=1");

    expect(screen.getByText("Diproduksi")).toBeInTheDocument();
    expect(screen.getByText("DGH · susut 5%")).toBeInTheDocument();
    const bought = within(screen.getByText("Kebutuhan Bahan Beli").closest("section")!);
    expect(bought.getByText("Tepung")).toBeInTheDocument();
    expect(bought.getByText("Rp15.000")).toBeInTheDocument();
    expect(screen.getByText(/1 bahan kurang/)).toBeInTheDocument();
    expect(screen.getByText("2 tingkat")).toBeInTheDocument();
  });

  it("refetches for a new quantity and holds back an invalid one", async () => {
    const fetchMock = renderDialog();
    await screen.findByText("Adonan");
    const input = screen.getByLabelText(/Jumlah yang dibuat/);

    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText("Jumlah harus lebih dari 0")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "2,5" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/production/bom/explode?product_id=p1&qty=2.5")).toBe(true)
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("qty=0"))).toBe(false);
  });
});
