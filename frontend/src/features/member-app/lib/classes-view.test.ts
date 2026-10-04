import { describe, expect, it } from "vitest";
import {
  branchNameOf,
  coverageFor,
  joinDot,
  toBookingView,
  toPackageView,
  toPaymentView,
  toSessionView,
  toTrainerViews,
  toWalletView,
  type RawCatalog,
  type RawSession,
} from "./classes-view";
import { classImage, classTypeKey } from "./images";

const catalog: RawCatalog = {
  branches: [
    { id: "b1", name: "Sulu Bandung" },
    { id: "b2", name: "Senopati" },
  ],
  class_types: [
    { id: "ct-sim", name: "Race Simulation", description: null, default_duration_min: 90, default_credit_cost: 2 },
    { id: "ct-mob", name: "Mobility & Recovery", description: null, default_duration_min: 45, default_credit_cost: 1 },
  ],
  packages: [
    { id: "pk-all", class_type_ids: null },
    { id: "pk-race", class_type_ids: ["ct-sim"] },
  ],
  coaches: [
    { id: "c1", branch_id: "b1" },
    { id: "c2", branch_id: null },
  ],
};

const session = (over: Partial<RawSession> = {}): RawSession => ({
  id: "s1",
  class_type_id: "ct-sim",
  class_type_name: "Race Simulation",
  coach_id: "c1",
  coach_name: "Rizky Ramadhan",
  branch_id: "b1",
  starts_at: "2026-10-05T01:00:00.000Z",
  ends_at: "2026-10-05T02:30:00.000Z",
  capacity: 12,
  credit_cost: 2,
  status: "published",
  confirmed_count: 3,
  waitlist_count: 0,
  seats_left: 9,
  my_booking: null,
  ...over,
});

describe("toSessionView", () => {
  it("maps to the reference view with upper-cased statuses and branch name", () => {
    const v = toSessionView(
      session({
        my_booking: { id: "bk", status: "waitlist", waitlist_position: 2, promotion_offered_at: null },
      }),
      catalog
    );
    expect(v.session.status).toBe("PUBLISHED");
    expect(v.branchName).toBe("Sulu Bandung");
    expect(v.spotsLeft).toBe(9);
    expect(v.myBooking).toEqual({ id: "bk", status: "WAITLIST", waitlistPosition: 2, promotionOfferedAt: null });
  });
});

describe("branchNameOf", () => {
  it("falls back to the only branch for unassigned rows", () => {
    expect(branchNameOf({ ...catalog, branches: [catalog.branches[0]!] }, null)).toBe("Sulu Bandung");
    expect(branchNameOf(catalog, null)).toBe("");
    expect(branchNameOf(catalog, "missing")).toBe("");
  });
});

describe("toTrainerViews", () => {
  const sessions = [
    toSessionView(session(), catalog),
    toSessionView(session({ id: "s2", class_type_id: "ct-mob", class_type_name: "Mobility & Recovery" }), catalog),
    toSessionView(session({ id: "s3", branch_id: "b2" }), catalog),
  ];
  const coaches = [
    { id: "c1", name: "Rizky Ramadhan", bio: null, specialization: "HYROX race coach" },
    { id: "c2", name: "Tara Widjaja", bio: "Mobility", specialization: null },
  ];

  it("counts upcoming classes and unique class names per coach, keeping idle coaches", () => {
    const [rizky, tara] = toTrainerViews(coaches, sessions, catalog);
    expect(rizky).toMatchObject({
      upcomingCount: 3,
      classTypeNames: ["Race Simulation", "Mobility & Recovery"],
      branchName: "Sulu Bandung",
    });
    expect(tara).toMatchObject({ upcomingCount: 0, classTypeNames: [], coach: { specialization: "", bio: "Mobility" } });
  });

  it("filters by branch: counts only that branch's classes, keeps unassigned coaches", () => {
    const views = toTrainerViews(coaches, sessions, catalog, "b2");
    expect(views.map((v) => [v.coach.id, v.upcomingCount])).toEqual([
      ["c1", 1],
      ["c2", 0],
    ]);
  });
});

describe("toBookingView", () => {
  it("nests booking and session like the reference", () => {
    const v = toBookingView(
      {
        id: "bk",
        status: "checked_in",
        promotion_offered_at: null,
        session_id: "s1",
        branch_id: "b2",
        starts_at: "2026-10-05T01:00:00.000Z",
        class_type_name: "Race Simulation",
      },
      catalog
    );
    expect(v).toEqual({
      booking: { id: "bk", status: "CHECKED_IN", promotionOfferedAt: null },
      session: { id: "s1", startsAt: "2026-10-05T01:00:00.000Z" },
      classTypeName: "Race Simulation",
      branchName: "Senopati",
    });
  });
});

describe("wallet coverage", () => {
  const lot = (id: string, packageId: string | null, expired = false) => ({
    id,
    package_id: packageId,
    package_name: packageId ? `Pack ${packageId}` : null,
    credits: 10,
    remaining: 4,
    expires_at: "2026-12-01T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    expired,
  });
  const raw = (lots: ReturnType<typeof lot>[]) => ({
    balance: 4,
    expiring_credits: 0,
    lots,
    entries: [{ id: "e1", type: "class_deduction", amount: -2, note: null, created_at: "2026-10-02T00:00:00.000Z" }],
  });

  it("maps lots to packages with coverage names and ledger types upper-cased", () => {
    const w = toWalletView(raw([lot("l1", "pk-race"), lot("l2", null)]), catalog);
    expect(w.myPackages[0]).toMatchObject({ lotId: "l1", coverageIds: ["ct-sim"], coverageNames: ["Race Simulation"] });
    expect(w.myPackages[1]).toMatchObject({ name: "Bonus credits", coverageIds: null, coverageNames: null });
    expect(w.entries[0]).toMatchObject({ type: "CLASS_DEDUCTION", amount: -2, description: null });
  });

  it("coverageFor: null without active packages, else whether any active one covers the class", () => {
    expect(coverageFor(toWalletView(raw([]), catalog), "ct-mob")).toBeNull();
    expect(coverageFor(toWalletView(raw([lot("l1", "pk-race", true)]), catalog), "ct-mob")).toBeNull();
    expect(coverageFor(toWalletView(raw([lot("l1", "pk-race")]), catalog), "ct-mob")).toBe(false);
    expect(coverageFor(toWalletView(raw([lot("l1", "pk-race")]), catalog), "ct-sim")).toBe(true);
    expect(coverageFor(toWalletView(raw([lot("l1", "pk-race"), lot("l2", "pk-all")]), catalog), "ct-mob")).toBe(true);
  });
});

describe("toPackageView / toPaymentView", () => {
  it("names the classes a restricted package covers", () => {
    const base = { name: "X", credits: 5, price_idr: 500_000, validity_days: 30, can_buy: true, blocked_reason: null };
    expect(toPackageView({ ...base, id: "pk-race" }, catalog).coverageNames).toEqual(["Race Simulation"]);
    expect(toPackageView({ ...base, id: "pk-all" }, catalog).coverageNames).toBeNull();
  });

  it("maps the purchase method to a channel", () => {
    const base = {
      id: "p1",
      status: "pending" as const,
      package_name: "Starter 5",
      credits: 5,
      total_idr: 450_000,
      qr_string: "QR",
      expires_at: null,
      simulated: true,
    };
    expect(toPaymentView({ ...base, payment_method: "qris" }).payment.channel).toBe("QRIS");
    expect(toPaymentView({ ...base, payment_method: "ark_coin" }).payment.channel).toBe("ARK_COIN");
  });
});

describe("classTypeKey / classImage", () => {
  it("recovers the reference class key from seed class names", () => {
    expect(classTypeKey("HYROX Fundamentals")).toBe("cls_fund");
    expect(classTypeKey("Race Simulation")).toBe("cls_sim");
    expect(classTypeKey("Strength Circuit")).toBe("cls_str");
    expect(classTypeKey("Engine Builder")).toBe("cls_eng");
    expect(classTypeKey("Mobility & Recovery")).toBe("cls_mob");
    expect(classTypeKey("Saturday WOD")).toBe("cls_wod");
    expect(classTypeKey("Benchmark Test")).toBe("cls_test");
    expect(classTypeKey("Yoga")).toBeNull();
  });

  it("serves images from the member asset path", () => {
    expect(classImage("Engine Builder")).toBe("/member-assets/img/class-eng.jpg");
    expect(classImage("Yoga")).toBeNull();
  });
});

describe("joinDot", () => {
  it("skips empty parts", () => {
    expect(joinDot("A", "", null, "B")).toBe("A · B");
  });
});
