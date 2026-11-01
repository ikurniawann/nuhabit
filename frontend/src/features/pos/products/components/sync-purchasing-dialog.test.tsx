import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { SyncPurchasingDialog } from "./sync-purchasing-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const options = [
  { id: "11111111-aaaa", kode: "K1", nama: "Kopi Susu" },
  { id: "22222222-bbbb", kode: null, nama: "Teh Tarik" },
];

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body =
      init?.method === "POST"
        ? { success: true, data: { mode: "created", product: {} } }
        : { success: true, data: options };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SyncPurchasingDialog open posSkus={new Set(["PUR-K1"])} onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

describe("SyncPurchasingDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks synced items and posts the selected purchasing ids", async () => {
    const fetchMock = stubFetch();
    const onClose = renderDialog();

    expect(await screen.findByText("Teh Tarik")).toBeInTheDocument();
    expect(screen.getByText("PUR-22222222")).toBeInTheDocument();
    expect(screen.getAllByText("Sudah di POS")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Sinkronkan/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Teh Tarik/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sinkronkan (1)" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/pos/products/sync-purchasing");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ purchasing_product_ids: ["22222222-bbbb"] });
    expect(toast.success).toHaveBeenCalledWith("Sinkron selesai: 1 produk baru, 0 diperbarui");
  });

  it("filters the list by code or name", async () => {
    stubFetch();
    renderDialog();
    await screen.findByText("Kopi Susu");
    fireEvent.change(screen.getByLabelText("Cari barang purchasing"), { target: { value: "k1" } });
    expect(screen.getByText("Kopi Susu")).toBeInTheDocument();
    expect(screen.queryByText("Teh Tarik")).not.toBeInTheDocument();
  });
});
