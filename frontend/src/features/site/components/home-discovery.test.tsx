import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SitePanelsProvider } from "../shell/panels";
import { MemberStories, UpcomingSessions } from "./home-discovery";

describe("MemberStories", () => {
  it("shows only supplied member stories with a name and quote", () => {
    expect(renderToStaticMarkup(<MemberStories stories={[]} />)).toBe("");
    const html = renderToStaticMarkup(<MemberStories stories={[
      { name: "Ayu", role: "Member", quote: "I finished my first race.", outcome: "First race", image_url: "/ayu.jpg" },
      { name: "", role: "Member", quote: "Unattributed", outcome: "", image_url: "" },
    ]} />);
    expect(html).toContain("Ayu");
    expect(html).toContain("I finished my first race.");
    expect(html).toContain("/ayu.jpg");
    expect(html).not.toContain("Unattributed");
  });
});

describe("UpcomingSessions", () => {
  const branch = { slug: "dago", name: "Dago", address: null, city: "Bandung", postcode: null, lat: null, lng: null, phone: null, instagram: null, hero_image_url: null };
  const session = (id: string, seats: number, waitlist = false) => ({
    id,
    starts_at: "2026-10-20T23:30:00Z",
    ends_at: "2026-10-21T00:30:00Z",
    duration_min: 60,
    class_type: { name: "Engine", color: "#daff59" },
    coach_name: "Rani",
    capacity: 12,
    seats_left: seats,
    waitlist_open: waitlist,
  });

  it("shows each session's time, class and seat state as a tile", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SitePanelsProvider>
          <UpcomingSessions branch={branch} sessions={[session("a", 4), session("b", 0, true), session("c", 0)]} />
        </SitePanelsProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain("Classes at Dago");
    expect(html).toContain("06:30");
    expect(html).toContain("Coach Rani");
    expect(html).toContain("4 seats left");
    expect(html).toContain("Waitlist open");
    expect(html).toContain(">Full<");
  });

  it("renders nothing without a branch", () => {
    expect(renderToStaticMarkup(<UpcomingSessions branch={null} sessions={[]} />)).toBe("");
  });
});
