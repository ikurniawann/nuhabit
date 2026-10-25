import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ID } from "./i18n";
import { NEWS_CATEGORY_LABEL } from "./queries-news";

const FILES = ["../news/news-page.tsx", "../news/news-detail-page.tsx", "../news/news-section.tsx"];

describe("news dictionary", () => {
  it("translates every key the news screens use", () => {
    const keys = new Set<string>(Object.values(NEWS_CATEGORY_LABEL));
    for (const file of FILES) {
      const source = readFileSync(path.resolve(__dirname, file), "utf8");
      for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
    }
    expect([...keys].filter((key) => !(key in ID))).toEqual([]);
  });
});
