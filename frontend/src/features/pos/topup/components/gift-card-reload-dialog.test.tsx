import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GiftCardReloadDialog } from "./gift-card-reload-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <GiftCardReloadDialog open onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

function fill(code: string, amount: string) {
  fireEvent.change(screen.getByLabelText("Kode gift card"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("Nominal (Rp)"), { target: { value: amount } });
}

describe("GiftCardReloadDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reloads the scanned code and reports the new balance", async () => {
    const fetchMock = stubFetch(200, { success: true, data: { ok: true, balanceAfter: 150000, statusAfter: "active" } });
    const onClose = renderDialog();
    expect(screen.getByRole("button", { name: "Isi ulang" })).toBeDisabled();

    fill(" gc-ab12 ", "100.000");
    fireEvent.change(screen.getByLabelText("Referensi pembayaran (opsional)"), { target: { value: "EDC-9" } });
    fireEvent.click(screen.getByRole("button", { name: /Isi Rp/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/pos/gift-card-reload");
    expect(JSON.parse(String(init.body))).toEqual({
      code: "gc-ab12",
      amount: 100000,
      payment_method: "cash",
      payment_reference: "EDC-9",
    });
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/^Gift card GC-AB12 terisi\. Saldo kini Rp/);
  });

  it("keeps the dialog open on a rejected code", async () => {
    stubFetch(400, { success: false, error: "Format kode gift card tidak valid" });
    const onClose = renderDialog();
    fill("xyz", "5000");
    fireEvent.click(screen.getByRole("button", { name: /Isi Rp/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Format kode gift card tidak valid"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
