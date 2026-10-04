import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DsButton,
  DsCard,
  DsCardContent,
  DsCardTitle,
  DsDataTable,
  DsTextbox,
} from "@/components/design-system";

describe("design-system", () => {
  it("DsButton renders xs, md, lg sizes", () => {
    const { rerender } = render(<DsButton size="xs">XS</DsButton>);
    expect(screen.getByRole("button", { name: "XS" })).toHaveAttribute("data-slot", "button");

    rerender(<DsButton size="md">MD</DsButton>);
    expect(screen.getByRole("button", { name: "MD" })).toBeInTheDocument();

    rerender(<DsButton size="lg">LG</DsButton>);
    expect(screen.getByRole("button", { name: "LG" })).toBeInTheDocument();
  });

  it("DsTextbox shows label and error", () => {
    render(<DsTextbox label="Nama" error="Wajib diisi" />);
    expect(screen.getByText("Nama")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Wajib diisi");
  });

  it("DsCard renders title", () => {
    render(
      <DsCard>
        <DsCardContent>
          <DsCardTitle>Judul</DsCardTitle>
        </DsCardContent>
      </DsCard>
    );
    expect(screen.getByText("Judul")).toBeInTheDocument();
  });

  it("DsDataTable renders rows and empty state", () => {
    const { rerender } = render(
      <DsDataTable
        columns={[{ id: "name", header: "Nama", cell: (row: { name: string }) => row.name }]}
        data={[{ name: "Alice" }]}
        rowKey={(row) => row.name}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();

    rerender(
      <DsDataTable
        columns={[{ id: "name", header: "Nama", cell: (row: { name: string }) => row.name }]}
        data={[]}
        rowKey={(row) => row.name}
        emptyMessage="Kosong"
      />
    );
    expect(screen.getByText("Kosong")).toBeInTheDocument();
  });
});
