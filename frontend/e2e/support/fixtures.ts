import { test as base, expect } from "@playwright/test";

export type PageWatch = { pageErrors: string[]; consoleErrors: string[] };

/**
 * Every test records uncaught page errors and console errors. Uncaught
 * errors fail the test; console errors land in the report as an annotation.
 */
export const test = base.extend<{ watch: PageWatch }>({
  watch: [
    async ({ page }, provide, testInfo) => {
      const watch: PageWatch = { pageErrors: [], consoleErrors: [] };
      page.on("pageerror", (error) => watch.pageErrors.push(`${page.url()}: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") watch.consoleErrors.push(`${page.url()}: ${message.text()}`);
      });
      await provide(watch);
      if (watch.consoleErrors.length > 0) {
        testInfo.annotations.push({ type: "console errors", description: watch.consoleErrors.join("\n") });
      }
      expect(watch.pageErrors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
