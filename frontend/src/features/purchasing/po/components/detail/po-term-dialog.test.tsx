import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { POTermDialog } from "./po-term-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/design-system", () => ({
  DsDateTimePicker: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));

function renderDialog() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { id: "t9" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <POTermDialog open onOpenChange={onOpenChange} poId="po-1" nextTermNo={2} schedulable={500} />
    </QueryClientProvider>
  );
  return { fetchMock, onOpenChange };
}

describe("POTermDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("needs a due date before it saves", () => {
    const { fetchMock } = renderDialog();
    expect(screen.getByLabelText("Deskripsi")).toHaveValue("Termin 2");
    fireEvent.click(screen.getByRole("button", { name: "Simpan Termin" }));
    expect(toast.error).toHaveBeenCalledWith("Masukkan jatuh tempo dan nominal termin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the unscheduled amount as the new term", async () => {
    const { fetchMock, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("Jatuh Tempo"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan Termin" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/purchasing/po/po-1/payment-terms", expect.objectContaining({ method: "POST" }));
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      description: "Termin 2",
      due_date: "2026-11-30",
      amount: 500,
      notes: null,
    });
  });
});
