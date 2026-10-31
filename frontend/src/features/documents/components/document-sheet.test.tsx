import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectAxeClean, LETTERHEAD } from "../documents.test-util";
import {
  DocumentInfoGrid,
  DocumentInfoRow,
  DocumentItemsTable,
  DocumentLetterhead,
  DocumentLineInput,
  DocumentLineText,
  DocumentSheet,
  DocumentSummary,
  DocumentSummaryRow,
  DocumentTitleBand,
} from "./document-sheet";

function Sample({ number }: { number: string | null }) {
  return (
    <DocumentSheet aria-label="Dokumen contoh">
      <DocumentLetterhead letterhead={LETTERHEAD} branchName="Cabang Dago" />
      <DocumentTitleBand title="QUOTATION" number={number} placeholder="Otomatis setelah disimpan" />
      <DocumentInfoGrid
        left={
          <DocumentInfoRow label="Kepada">
            <DocumentLineText>PT Maju</DocumentLineText>
          </DocumentInfoRow>
        }
        right={
          <DocumentInfoRow label="Berlaku s.d." htmlFor="valid" required>
            <DocumentLineInput id="valid" type="date" required defaultValue="2026-11-30" />
          </DocumentInfoRow>
        }
      />
      <DocumentItemsTable label="Daftar item" columns={[{ label: "No" }, { label: "Deskripsi", required: true }, { label: "Aksi", srOnly: true }]}>
        <tr>
          <td>1</td>
          <td>Sewa venue</td>
          <td />
        </tr>
      </DocumentItemsTable>
      <DocumentSummary label="Ringkasan harga">
        <DocumentSummaryRow label="Subtotal" value="Rp1.000.000" />
        <DocumentSummaryRow tone="total" label="Total" value="Rp1.110.000" />
      </DocumentSummary>
    </DocumentSheet>
  );
}

describe("DocumentSheet", () => {
  it("renders the letterhead, number band, linked info rows, table and summary on a light sheet", async () => {
    const { container } = render(<Sample number="QT-2610-0001" />);
    const sheet = screen.getByRole("article", { name: "Dokumen contoh" });
    expect(sheet).toHaveClass("theme-light");

    expect(screen.getByRole("img", { name: "Logo PT NüHabit Indonesia" })).toBeInTheDocument();
    expect(screen.getByText("PT NüHabit Indonesia")).toBeInTheDocument();
    expect(screen.getByText("Jl. Merdeka 1, Bandung")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "halo@nuhabit.id" })).toHaveAttribute("href", "mailto:halo@nuhabit.id");
    expect(screen.getByText("NPWP: 01.234.567.8-901.000")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "QUOTATION" })).toBeInTheDocument();
    expect(screen.getByText("QT-2610-0001")).toBeInTheDocument();
    // The label names its input; the asterisk is visual only.
    expect(screen.getByLabelText(/^Berlaku s\.d\./)).toHaveValue("2026-11-30");

    const table = screen.getByRole("table", { name: "Daftar item" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["No", "Deskripsi *", "Aksi"]);
    const summary = screen.getByRole("region", { name: "Ringkasan harga" });
    expect(within(summary).getByText("Rp1.110.000")).toBeInTheDocument();
    await expectAxeClean(container);
  });

  it("shows the placeholder until the document has a number", () => {
    render(<Sample number={null} />);
    expect(screen.getByText("Otomatis setelah disimpan")).toBeInTheDocument();
  });

  it("holds the letterhead slot while the profile loads", () => {
    const { container } = render(<DocumentLetterhead letterhead={undefined} />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
