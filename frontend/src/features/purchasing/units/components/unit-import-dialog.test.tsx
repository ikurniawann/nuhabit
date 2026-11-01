import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { UnitImportDialog } from "./unit-import-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UnitImportDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  );
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

describe("UnitImportDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("accepts CSV only", () => {
    const input = renderDialog();
    expect(input).toHaveAttribute("accept", ".csv");
    expect(screen.getByText("Format yang diterima: CSV")).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(["x"], "satuan.xlsx")] } });
    expect(toast.error).toHaveBeenCalledWith("Format file tidak valid", { description: "Silakan unggah file CSV." });
  });

  it("previews the rows and posts the file to the units import", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, imported: 1, skipped: 0, errors: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = renderDialog();

    const csv = "kode,nama,tipe,deskripsi,status\nKG,Kilogram,BESAR,,active\n";
    fireEvent.change(input, { target: { files: [new File([csv], "satuan.csv", { type: "text/csv" })] } });
    const importButton = await screen.findByRole("button", { name: /Impor 1/ });
    fireEvent.click(importButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/api/purchasing/import/units");
  });
});
