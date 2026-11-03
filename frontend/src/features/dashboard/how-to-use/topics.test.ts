import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS, visibleTopics } from "./topics";

const titles = (hrefs: string[]) => visibleTopics(hrefs).map((topic) => topic.title);

describe("visibleTopics", () => {
  it("gives an account with no menus only the general topics and its own ESS", () => {
    expect(titles([])).toEqual(["Quick search", "Akun, kata sandi, dan tema", "Notifikasi", "Absen dan cuti"]);
  });

  it("adds a module topic once the account's menus open it", () => {
    expect(titles(["/dashboard/gym/checkin"])).toContain("Check-in di front desk");
    expect(titles(["/dashboard/gym/checkin"])).not.toContain("Memproses pesanan toko online");
  });

  it("covers every topic for an account with every menu", () => {
    const every = GUIDE_TOPICS.flatMap((topic) => (topic.href ? [topic.href] : []));
    expect(visibleTopics(every)).toHaveLength(GUIDE_TOPICS.length);
  });
});
