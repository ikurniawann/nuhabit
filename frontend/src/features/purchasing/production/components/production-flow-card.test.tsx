import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { flow } from "@/lib/purchasing/production-flow.test-fixtures";
import { ProductionFlowCard } from "./production-flow-card";

const intermediate = {
  material_id: "m9",
  raw_material_id: "rm9",
  kode: "K",
  nama: "Krim",
  satuan: "kg",
  qty_needed: 3,
  qty_onhand: 0.5,
  qty_on_sub_orders: 0,
  shortage_qty: 2.5,
};

function renderCard(over: Parameters<typeof flow>[0], onCreateSubOrders = vi.fn(), onReturn = vi.fn()) {
  render(
    <ProductionFlowCard
      flow={flow(over)}
      busy={false}
      batchRoute={(id) => `/batch/${id}`}
      orderRoute={(id) => `/order/${id}`}
      onIssue={() => {}}
      onReturn={onReturn}
      onReceive={() => {}}
      onCreateSubOrders={onCreateSubOrders}
    />
  );
  return { onCreateSubOrders, onReturn };
}

describe("ProductionFlowCard sub-orders", () => {
  it("shows intermediate shortages and asks for sub-orders", () => {
    const { onCreateSubOrders } = renderCard({ intermediates: [intermediate], can_create_sub_orders: true });
    expect(screen.getByRole("heading", { name: "Bahan Setengah Jadi" })).toBeInTheDocument();
    const row = screen.getByText("Krim").closest("tr") as HTMLElement;
    expect(within(row).getByText("2,5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buat Sub-order" }));
    expect(onCreateSubOrders).toHaveBeenCalledOnce();
  });

  it("lists sub-orders with links and disables the button once covered", () => {
    renderCard({
      intermediates: [{ ...intermediate, qty_on_sub_orders: 4, shortage_qty: 0 }],
      sub_orders: [
        {
          id: "s1",
          nomor_produksi: "PROD-202610-0002",
          status: "DRAFT",
          production_context: "raw_material",
          output_type: "FINISHED_GOOD",
          item_kode: "K",
          item_nama: "Krim",
          planned_qty: 4,
          created_at: "2026-10-19T03:00:00Z",
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Buat Sub-order" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "PROD-202610-0002" })).toHaveAttribute("href", "/order/s1");
    expect(screen.getByText("Cukup")).toBeInTheDocument();
  });

  it("links a sub-order to its parent and offers Kembalikan Bahan", () => {
    const { onReturn } = renderCard({
      order: { ...flow().order, parent_order_id: "p1", parent_nomor_produksi: "PROD-202610-0001" },
    });
    expect(screen.getByRole("link", { name: "PROD-202610-0001" })).toHaveAttribute("href", "/order/p1");
    fireEvent.click(screen.getByRole("button", { name: "Kembalikan Bahan" }));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
