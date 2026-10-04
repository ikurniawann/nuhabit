// src/components/motion/motion-primitives.test.tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FadeIn, PageTransition, Pressable } from "./motion-primitives";

beforeEach(() => {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

describe("motion primitives", () => {
  it("renders children for each primitive", () => {
    render(
      <PageTransition>
        <FadeIn>
          <Pressable>
            <span>hello</span>
          </Pressable>
        </FadeIn>
      </PageTransition>
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
