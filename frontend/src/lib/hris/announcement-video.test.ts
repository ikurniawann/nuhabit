import { describe, it, expect } from "vitest";
import { parseVideoUrl, embedUrlFor } from "./announcement-video";

describe("parseVideoUrl — YouTube", () => {
  it("parses watch URLs", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });

  it("parses youtu.be short links", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });

  it("parses embed, shorts, and extra query params", () => {
    expect(parseVideoUrl("https://youtube.com/embed/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")?.id).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("rejects malformed YouTube ids", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/watch")).toBeNull();
  });
});

describe("parseVideoUrl — Vimeo", () => {
  it("parses vimeo.com/<id>", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      id: "123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });

  it("parses player.vimeo.com/video/<id>", () => {
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789")?.id).toBe("123456789");
  });

  it("rejects non-numeric vimeo ids", () => {
    expect(parseVideoUrl("https://vimeo.com/abc")).toBeNull();
  });
});

describe("parseVideoUrl — rejection & safety", () => {
  it("rejects unknown providers and non-http schemes", () => {
    expect(parseVideoUrl("https://evil.example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    expect(parseVideoUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl("bukan url")).toBeNull();
  });
});

describe("embedUrlFor", () => {
  it("rebuilds embed URLs from stored provider+id", () => {
    expect(embedUrlFor("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
    expect(embedUrlFor("vimeo", "123456789")).toBe(
      "https://player.vimeo.com/video/123456789"
    );
  });

  it("returns null for tampered stored values", () => {
    expect(embedUrlFor("youtube", "'><script>")).toBeNull();
    expect(embedUrlFor("other", "123")).toBeNull();
  });
});
