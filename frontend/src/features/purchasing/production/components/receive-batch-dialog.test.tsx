import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { flow } from "@/lib/purchasing/production-flow.test-fixtures";
import { ReceiveBatchDialog } from "./receive-batch-dialog";

// 10 planned with a 5% tolerance; batch 1 already used the 0.5 allowance.
const abnormalFlow = flow({
  order: { ...flow().order, overhead_cost: 1000, conversion_cost: 1000 },
  wip: {
    ...flow().wip,
    wip_value: 27500,
    conversion_cost: 1000,
    conversion_applied: 450,
    std_material_per_unit: 5000,
    scrap_tolerance_pct: 5,
    scrap_allowance: 0.5,
    qty_scrap: 1,
    qty_remaining: 5,
  },
});

describe("ReceiveBatchDialog", () => {
  it("splits the scrap into normal and abnormal and shows the expensed loss", () => {
    const onSubmit = vi.fn();
    render(<ReceiveBatchDialog flow={abnormalFlow} open submitting={false} onClose={() => {}} onSubmit={onSubmit} />);

    expect(screen.getByText(/Toleransi scrap 5% dari rencana = 0,5 unit, sisa jatah 0 unit/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hasil baik"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Scrap / reject"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Overhead"), { target: { value: "1000" } });

    expect(screen.getByText("Scrap di atas toleransi").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Kerugian produksi (scrap abnormal)").nextSibling).toHaveTextContent(/5\.610/);
    expect(screen.getByText("Perkiraan HPP / unit").nextSibling).toHaveTextContent(/5\.610/);

    expect(screen.getByRole("switch", { name: "Batch terakhir" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Terima Hasil" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ qty_good: 4, qty_scrap: 1, final: true, overhead_cost: 1000 }));
  });

  it("shows no loss while the scrap stays within the tolerance", () => {
    render(
      <ReceiveBatchDialog
        flow={flow({ wip: { ...flow().wip, scrap_allowance: 3 } })}
        open
        submitting={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Scrap / reject"), { target: { value: "1" } });
    expect(screen.getByText("Scrap normal (menaikkan HPP)").nextSibling).toHaveTextContent("1");
    expect(screen.queryByText("Kerugian produksi (scrap abnormal)")).not.toBeInTheDocument();
  });
});
