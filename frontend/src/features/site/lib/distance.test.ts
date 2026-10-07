import { describe, expect, it } from "vitest";
import { formatKm, haversineKm, sortByDistance } from "./distance";

const bandung = { lat: -6.9175, lng: 107.6191 };
const jakarta = { lat: -6.2088, lng: 106.8456 };

describe("haversineKm", () => {
  it("measures Bandung to Jakarta at about 118 km", () => {
    const km = haversineKm(bandung, jakarta);
    expect(km).toBeGreaterThan(115);
    expect(km).toBeLessThan(122);
  });

  it("is zero for the same point", () => {
    expect(haversineKm(bandung, bandung)).toBe(0);
  });
});

describe("sortByDistance", () => {
  const branches = [
    { slug: "jkt", lat: jakarta.lat, lng: jakarta.lng },
    { slug: "no-coords", lat: null, lng: null },
    { slug: "bdg", lat: bandung.lat, lng: bandung.lng },
    { slug: "bdg-2", lat: -6.9, lng: 107.6 },
  ];

  it("orders by distance from the origin and leaves unlocated branches last", () => {
    const ranked = sortByDistance(branches, bandung);
    expect(ranked.map((r) => r.item.slug)).toEqual(["bdg", "bdg-2", "jkt", "no-coords"]);
    expect(ranked[0].km).toBe(0);
    expect(ranked[3].km).toBeNull();
  });

  it("does not mutate the input", () => {
    const copy = [...branches];
    sortByDistance(branches, jakarta);
    expect(branches).toEqual(copy);
  });
});

describe("formatKm", () => {
  it("shows metres under a kilometre and one decimal above", () => {
    expect(formatKm(0.45)).toBe("450 m");
    expect(formatKm(2.345)).toBe("2.3 km");
    expect(formatKm(118)).toBe("118 km");
  });
});
