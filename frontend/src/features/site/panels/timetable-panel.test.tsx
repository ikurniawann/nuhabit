import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TimetablePanel from "./timetable-panel";

function renderPanel(branchSlug?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TimetablePanel branchSlug={branchSlug} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const branches = [
  { slug: "kemang", name: "NüHabit Kemang" },
  { slug: "bsd", name: "NüHabit BSD" },
];

function timetable(slug: string, week: string) {
  return {
    branch: { slug, name: slug },
    week_start: week,
    sessions: [
      {
        id: "s1",
        starts_at: `${week}T23:30:00.000Z`, // Tuesday 06:30 WIB
        ends_at: `${week}T00:30:00.000Z`,
        duration_min: 60,
        class_type: { name: "Engine", color: "info" },
        coach_name: "Dita",
        capacity: 12,
        seats_left: 4,
        waitlist_open: false,
      },
      {
        id: "s2",
        starts_at: `${week}T00:30:00.000Z`, // Monday 07:30 WIB
        ends_at: `${week}T01:30:00.000Z`,
        duration_min: 60,
        class_type: { name: "Station", color: "lime" },
        coach_name: null,
        capacity: 12,
        seats_left: 0,
        waitlist_open: true,
      },
    ],
  };
}

function json(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
}

/** Answers the branches and sessions calls; returns the sessions URLs requested. */
function mockApi() {
  const calls: URL[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/api/public/site/branches") return json(branches);
    calls.push(url);
    return json(timetable(url.searchParams.get("branch") ?? "", url.searchParams.get("week") ?? ""));
  });
  return calls;
}

beforeEach(() => {
  // Wednesday 7 Oct 2026, 09:00 WIB.
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-07T02:00:00Z") });
  document.cookie = "nh_branch=; max-age=0";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TimetablePanel", () => {
  test("opens on today's tab for the prop branch and links rows into the member app", async () => {
    const calls = mockApi();
    renderPanel("bsd");

    await waitFor(() => expect(screen.getByRole("tab", { selected: true })).toHaveAccessibleName("Rabu 7 Okt"));
    expect(calls[0].searchParams.get("branch")).toBe("bsd");
    expect(calls[0].searchParams.get("week")).toBe("2026-10-05");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Cabang" })).toHaveValue("bsd"));
    expect(screen.getByText(/Belum ada kelas pada Rabu/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Senin 5 Okt" }));
    const row = screen.getByRole("link", { name: /Station/ });
    expect(row).toHaveAttribute("href", "/member/classes/s2");
    expect(row).toHaveTextContent("Penuh · daftar tunggu dibuka");

    fireEvent.click(screen.getByRole("tab", { name: "Selasa 6 Okt" }));
    const engine = screen.getByRole("link", { name: /Engine/ });
    expect(engine).toHaveAttribute("href", "/member/classes/s1");
    expect(engine).toHaveTextContent("Coach Dita");
    expect(engine).toHaveTextContent("4 kursi tersisa");
    expect(engine).toHaveTextContent("60 mnt");
  });

  test("falls back to the cookie branch, then the first public branch", async () => {
    document.cookie = "nh_branch=kemang";
    const calls = mockApi();
    const { unmount } = renderPanel();
    await waitFor(() => expect(calls[0]?.searchParams.get("branch")).toBe("kemang"));
    unmount();

    document.cookie = "nh_branch=; max-age=0";
    calls.length = 0;
    renderPanel();
    await waitFor(() => expect(calls[0]?.searchParams.get("branch")).toBe("kemang"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Cabang" })).toHaveValue("kemang"));
  });

  test("clamps week navigation to this week and eight weeks ahead", async () => {
    const calls = mockApi();
    renderPanel("bsd");
    const prev = screen.getByRole("button", { name: "Minggu sebelumnya" });
    const next = screen.getByRole("button", { name: "Minggu berikutnya" });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    for (let i = 0; i < 9; i++) fireEvent.click(next);
    await waitFor(() => expect(next).toBeDisabled());
    expect(calls.at(-1)?.searchParams.get("week")).toBe("2026-11-30");
    expect(screen.getByRole("tab", { selected: true })).toHaveAccessibleName("Senin 30 Nov");

    fireEvent.click(prev);
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("week")).toBe("2026-11-23"));
  });

  test("picking another branch reloads that branch's week", async () => {
    const calls = mockApi();
    renderPanel("bsd");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Cabang" })).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox", { name: "Cabang" }), { target: { value: "kemang" } });
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("branch")).toBe("kemang"));
  });
});
