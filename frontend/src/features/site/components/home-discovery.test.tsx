import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberStories } from "./home-discovery";

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
