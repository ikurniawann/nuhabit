import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trainApi } from "../../lib/queries-train";
import { SaveForm } from "./save-form";

describe("SaveForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lets a member explicitly save a GPS activity as a private note when no route was captured", async () => {
    const save = vi.spyOn(trainApi, "save").mockResolvedValue({ id: "activity-1" } as Awaited<ReturnType<typeof trainApi.save>>);
    const onSaved = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SaveForm type="RUN" strength={[]} laps={[]} points={[]} elapsedSec={90} distanceM={0} startedAt={Date.parse("2026-10-26T01:00:00Z")} gear={[]} onDiscard={vi.fn()} onResume={vi.fn()} onSaved={onSaved} />
    </QueryClientProvider>);

    const submit = screen.getByRole("button", { name: /Save activity|Simpan aktivitas/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Save this activity without a GPS route" }));
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("activity-1"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: "RUN", points: [], manualElapsedSec: 90, visibility: "PRIVATE" }));
  });
});
