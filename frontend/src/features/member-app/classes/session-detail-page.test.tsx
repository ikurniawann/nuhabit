import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "../lib/api";
import { WAIVER_REQUIRED } from "../lib/error-codes";
import { setLang } from "../lib/lang";
import type { SessionView, WalletView } from "../lib/classes-view";
import { SessionDetailPage } from "./session-detail-page";

const state = vi.hoisted(() => ({ session: null as unknown, wallet: null as unknown, book: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "s1" }),
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock("../lib/queries-classes", () => ({
  confirmSpot: vi.fn(),
  declineSpot: vi.fn(),
  useBookMutation: () => ({ isPending: false, mutateAsync: state.book }),
  useCancelMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useInvalidateAll: () => vi.fn(),
  useSession: () => ({ data: state.session, isLoading: false, isError: false, refetch: vi.fn() }),
  useWallet: () => ({ data: state.wallet }),
}));

const view = (over: Partial<SessionView>): SessionView => ({
  session: {
    id: "s1", classTypeId: "c1", branchId: null, coachId: null, status: "PUBLISHED", creditCost: 1, capacity: 10,
    startsAt: "2026-11-05T12:00:00Z", endsAt: "2026-11-05T13:00:00Z", timezone: "Asia/Jakarta",
  },
  classTypeName: "HYROX",
  branchName: "",
  coachName: "",
  spotsLeft: 5,
  confirmedCount: 5,
  waitlistCount: 0,
  myBooking: null,
  cancelDeadline: null,
  cancelInfo: null,
  waiverMissing: false,
  parqMissing: false,
  ...over,
} as SessionView);

const denial = (code: string) => new ApiError(409, "denied", code);
const waitForBookSettled = () => act(async () => { await Promise.resolve(); });

function open(over: Partial<SessionView> = {}) {
  state.session = view(over);
  state.wallet = { balance: 5, activePass: null } as unknown as WalletView;
  render(<SessionDetailPage />);
}

describe("SessionDetailPage booking blockers", () => {
  afterEach(() => setLang("id"));

  it("links to the waiver and the health declaration before the tap", () => {
    open({ waiverMissing: true, parqMissing: true });
    expect(screen.getByRole("link", { name: /Baca dan setujui waiver/ }).getAttribute("href")).toContain("/profile/waiver");
    expect(screen.getByRole("link", { name: /Isi deklarasi kesehatan/ }).getAttribute("href")).toContain("/profile/health");
    expect(screen.getByText(/Setujui waiver gym dulu/)).toBeTruthy();
  });

  it("does not repeat a denial the page already shows", async () => {
    state.book.mockRejectedValue(denial(WAIVER_REQUIRED));
    open({ waiverMissing: true });
    fireEvent.click(screen.getByRole("button", { name: /Pesan kelas ini/ }));
    await waitForBookSettled();
    expect(state.book).toHaveBeenCalled();
    expect(screen.getAllByText(/Setujui waiver gym dulu/)).toHaveLength(1);
  });

  it("explains a denial the class data did not predict", async () => {
    state.book.mockRejectedValue(denial(WAIVER_REQUIRED));
    open();
    fireEvent.click(screen.getByRole("button", { name: /Pesan kelas ini/ }));
    expect(await screen.findByRole("link", { name: /Baca dan setujui waiver/ })).toBeTruthy();
  });

  it("stays quiet when nothing is missing", () => {
    open();
    expect(screen.queryByRole("link", { name: /waiver/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /deklarasi/ })).toBeNull();
  });

  it("does not ask a booked member to sign again", () => {
    open({ waiverMissing: true, myBooking: { id: "b1", status: "CONFIRMED", waitlistPosition: null, promotionOfferedAt: null } as SessionView["myBooking"] });
    expect(screen.queryByRole("link", { name: /waiver/ })).toBeNull();
  });

  it("words minutes in the app language", () => {
    setLang("id");
    open();
    expect(screen.getAllByText(/\d+ menit/).length).toBeGreaterThan(0);
  });
});
