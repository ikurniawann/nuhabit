import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { PRSubmitButton } from "./pr-submit-button";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PRSubmitButton prId="pr-1" />
    </QueryClientProvider>
  );
}

describe("PRSubmitButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks for confirmation, then posts the submit", async () => {
    const fetchMock = stubFetch(200, { success: true, data: { id: "pr-1", status: "pending_head" } });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Ajukan" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Ajukan Sekarang" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Purchase request diajukan untuk persetujuan"));
    expect(fetchMock).toHaveBeenCalledWith("/api/purchasing/pr/pr-1/submit", expect.objectContaining({ method: "POST" }));
  });

  it("shows the server error", async () => {
    stubFetch(403, { success: false, error: "Anda tidak memiliki akses" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Ajukan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ajukan Sekarang" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Anda tidak memiliki akses"));
  });
});
