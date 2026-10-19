import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { flow, material } from "@/lib/purchasing/production-flow.test-fixtures";
import { ReceiveBatchDialog } from "./receive-batch-dialog";
import { ReturnMaterialsDialog } from "./return-materials-dialog";

// 3 kg of flour issued for 30000, 1 kg already returned; sugar untouched.
const returnFlow = flow({
  materials: [
    material({ qty_issued: 3, qty_returned: 1, qty_returnable: 2, issued_cost: 30000, returned_cost: 10000 }),
    material({ id: "m2", nama: "Gula", kode: "G" }),
  ],
});

describe("ReturnMaterialsDialog", () => {
  it("lists only returnable lines, caps the quantity and sends the lines", () => {
    const onSubmit = vi.fn();
    render(<ReturnMaterialsDialog flow={returnFlow} open submitting={false} onClose={() => {}} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText(/Jumlah Gula yang dikembalikan/)).not.toBeInTheDocument();
    const input = screen.getByLabelText("Jumlah Tepung yang dikembalikan (kg)");
    const submit = screen.getByRole("button", { name: "Kembalikan Bahan" });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "3" } });
    expect(screen.getByText("Melebihi yang bisa kembali")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "1" } });
    expect(screen.getByText(/Nilai kembali ke stok/)).toHaveTextContent(/10\.000/);
    fireEvent.change(screen.getByLabelText("Catatan"), { target: { value: "sisa" } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ lines: [{ material_id: "m1", qty: 1 }], catatan: "sisa" });
  });
});

describe("ReceiveBatchDialog with leftovers", () => {
  it("returns unused material with the final batch and keeps it out of the HPP", () => {
    const onSubmit = vi.fn();
    const f = flow({ ...returnFlow, wip: { ...flow().wip, wip_value: 20000, conversion_cost: 0, conversion_applied: 0, qty_scrap: 0 } });
    render(<ReceiveBatchDialog flow={f} open submitting={false} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Overhead"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Hasil baik"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Jumlah Tepung yang dikembalikan (kg)"), { target: { value: "2" } });

    expect(screen.getByText("Bahan sisa kembali ke stok").nextSibling).toHaveTextContent(/20\.000/);
    expect(screen.getByText("Biaya bahan").nextSibling).toHaveTextContent(/Rp\s?0/);

    fireEvent.click(screen.getByRole("switch", { name: "Batch terakhir" }));
    expect(screen.queryByLabelText("Jumlah Tepung yang dikembalikan (kg)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Batch terakhir" }));
    fireEvent.click(screen.getByRole("button", { name: "Terima Hasil" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ final: true, returns: [{ material_id: "m1", qty: 2 }] }));
  });
});
