import { describe, expect, it } from "vitest";
import { CONTENT_DEFAULTS, withDefaults } from "./content-defaults";

describe("withDefaults", () => {
  it("fills every key when the API gave nothing", () => {
    for (const key of Object.keys(CONTENT_DEFAULTS) as (keyof typeof CONTENT_DEFAULTS)[]) {
      expect(withDefaults(key, null)).toEqual(CONTENT_DEFAULTS[key]);
      expect(withDefaults(key, "junk")).toEqual(CONTENT_DEFAULTS[key]);
    }
  });

  it("keeps stored values and fills missing nested fields", () => {
    const home = withDefaults("home", { hero: { title: "Judul" }, partners: [{ name: "A", logo_url: "/a.png" }] });
    expect(home.hero.title).toBe("Judul");
    expect(home.hero.cta_label).toBe("Coba Gratis");
    expect(home.partners).toEqual([{ name: "A", logo_url: "/a.png" }]);
    expect(home.mission).toEqual({ quote: "", author: "" });
  });

  it("lets a stored list replace the default list", () => {
    const training = withDefaults("training", { laws: { items: ["Satu"] } });
    expect(training.laws).toEqual({ title: "Hukum NüHabit", items: ["Satu"] });
  });

  it("does not mutate the defaults", () => {
    withDefaults("social", { instagram: "x" });
    expect(CONTENT_DEFAULTS.social.instagram).toBe("");
  });
});
