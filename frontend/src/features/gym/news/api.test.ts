import { describe, expect, it } from "vitest";
import { initialNewsForm, newsState, toNewsPayload, type NewsArticle } from "./api";

const article: NewsArticle = {
  id: "a1",
  slug: "event-oktober",
  title: "Event Oktober",
  excerpt: "Ringkas",
  cover_image_url: null,
  body_md: "Isi",
  status: "published",
  published_at: "2026-10-01T02:00:00.000Z",
  updated_at: "2026-10-01T02:00:00.000Z",
  audience: "both",
  member_category: "event",
  pinned: true,
  branch_ids: ["b1"],
};

describe("news form", () => {
  it("round-trips an article through the form", () => {
    const payload = toNewsPayload(initialNewsForm(article));
    expect(payload).toEqual({
      title: "Event Oktober",
      member_category: "event",
      excerpt: "Ringkas",
      body_md: "Isi",
      cover_image_url: null,
      status: "published",
      published_at: "2026-10-01T02:00:00.000Z",
      pinned: true,
      also_on_site: true,
      branch_ids: ["b1"],
    });
  });

  it("sends blanks as null and a new article as a member-only draft", () => {
    const form = { ...initialNewsForm(null), title: "  Tips  ", excerpt: "  " };
    const payload = toNewsPayload(form);
    expect(payload.title).toBe("Tips");
    expect(payload.excerpt).toBeNull();
    expect(payload.published_at).toBeNull();
    expect(payload.status).toBe("draft");
    expect(payload.also_on_site).toBe(false);
    expect(payload.branch_ids).toEqual([]);
  });
});

describe("newsState", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  it("tells drafts, scheduled and live articles apart", () => {
    expect(newsState({ status: "draft", published_at: null }, now)).toBe("draft");
    expect(newsState({ status: "published", published_at: "2026-11-01T00:00:00Z" }, now)).toBe("scheduled");
    expect(newsState({ status: "published", published_at: "2026-10-01T00:00:00Z" }, now)).toBe("live");
  });
});
