import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectAxeClean, LETTERHEAD } from "@/features/documents/documents.test-util";
import { formatRupiah } from "@/lib/format";
import { InvoiceSheet, splitPpn, type InvoiceSheetValues } from "./invoice-sheet";

const INFO = {
  org: "SD Harapan",
  pic: "Ibu Sari, Kepala Sekolah",
  event: "Field trip (Field Trip)",
  reference: "QT-2610-0001",
  term: "DP (50%)",
  invoiceDate: "2026-10-05T03:00:00Z",
  eventDate: "2026-12-01",
};

const VALUES: InvoiceSheetValues = { label: "DP 50%", amount: "5550000", dueDate: "2026-10-20", note: "" };

describe("InvoiceSheet", () => {
  it("splits DPP and PPN out of an amount that includes PPN", () => {
    expect(splitPpn(5550000, 11)).toEqual({ dpp: 5000000, ppn: 550000 });
    expect(splitPpn(1000, 0)).toEqual({ dpp: 1000, ppn: 0 });
  });

  it("edits the line, due date and note in place with labelled fields", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <InvoiceSheet
        letterhead={LETTERHEAD}
        number={null}
        numberPlaceholder="Otomatis setelah diajukan"
        info={INFO}
        values={VALUES}
        onChange={onChange}
        ppnPercent={11}
      />
    );
    expect(screen.getByRole("heading", { level: 2, name: "INVOICE" })).toBeInTheDocument();
    expect(screen.getByText("Otomatis setelah diajukan")).toBeInTheDocument();
    expect(screen.getByText("QT-2610-0001")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Keterangan tagihan"), { target: { value: "DP" } });
    expect(onChange).toHaveBeenLastCalledWith({ label: "DP" });
    fireEvent.change(screen.getByLabelText("Nominal tagihan"), { target: { value: "Rp 1.000" } });
    expect(onChange).toHaveBeenLastCalledWith({ amount: "1000" });
    fireEvent.change(screen.getByLabelText("Jatuh tempo"), { target: { value: "2026-10-31" } });
    expect(onChange).toHaveBeenLastCalledWith({ dueDate: "2026-10-31" });

    const summary = screen.getByRole("region", { name: "Ringkasan tagihan" });
    expect(within(summary).getByText(formatRupiah(5000000))).toBeInTheDocument();
    expect(within(summary).getByText(formatRupiah(550000))).toBeInTheDocument();
    expect(within(summary).queryByText("Sudah dibayar")).toBeNull();
    await expectAxeClean(container);
  });

  it("is read-only without onChange and shows paid and outstanding", async () => {
    const { container } = render(
      <InvoiceSheet
        letterhead={LETTERHEAD}
        number="INV-2610-0007"
        numberPlaceholder=""
        info={INFO}
        values={{ ...VALUES, note: "Transfer ke BCA" }}
        ppnPercent={0}
        paid={2000000}
      />
    );
    expect(screen.getByText("INV-2610-0007")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("Transfer ke BCA")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Ringkasan tagihan" });
    expect(within(summary).queryByText("DPP")).toBeNull();
    expect(within(summary).getByText(formatRupiah(3550000))).toBeInTheDocument();
    await expectAxeClean(container);
  });
});
