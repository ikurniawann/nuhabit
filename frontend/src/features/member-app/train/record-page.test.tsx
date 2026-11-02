import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/member/train/record",
}));
vi.mock("../lib/geolocation", () => ({ useLocationPermission: () => ["prompt", vi.fn()] }));
vi.mock("../components/geo-map", () => ({ GeoMap: () => <div>Map</div> }));

import { RecordPage } from "./record-page";

describe("RecordPage navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    push.mockClear();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => success({
          coords: { latitude: -6.2, longitude: 106.8, accuracy: 5, altitude: null },
          timestamp: Date.now(),
        } as GeolocationPosition)),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("warns before an in-app link stops GPS and keeps a recoverable draft", async () => {
    const first = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecordPage />
    </QueryClientProvider>);
    const start = await screen.findByRole("button", { name: /Start GPS recording/ });
    expect(screen.queryByRole("button", { name: /Allow location/ })).not.toBeInTheDocument();
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledOnce();
    await screen.findByText(/GPS recording|GPS sedang merekam/);

    fireEvent.click(screen.getByRole("link", { name: /Feed/i }));
    expect(screen.getByRole("dialog", { name: "Leave recording?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Feed/i }));
    fireEvent.click(screen.getByRole("button", { name: "Leave and save draft" }));
    expect(push).toHaveBeenCalledWith("/member/train");
    expect(JSON.parse(window.localStorage.getItem("nuhabit-activity-draft-v1") ?? "null")).toMatchObject({ type: "RUN" });

    first.unmount();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecordPage />
    </QueryClientProvider>);
    expect(await screen.findByText(/Your activity was recovered/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue recording|Lanjut merekam/ }));
    expect(await screen.findByRole("button", { name: /Pause|Jeda/ })).toBeInTheDocument();
  });
});
