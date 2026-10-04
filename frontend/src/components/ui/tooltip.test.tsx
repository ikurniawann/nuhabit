import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpHint } from "./help-hint";
import { TooltipProvider } from "./tooltip";

describe("HelpHint", () => {
  it("renders a help trigger when text exists", () => {
    render(
      <TooltipProvider>
        <HelpHint helpId="pos.void" role="supervisor" />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Bantuan")).toBeInTheDocument();
  });
  it("renders nothing for unknown helpId", () => {
    const { container } = render(
      <TooltipProvider>
        <HelpHint helpId="nope" />
      </TooltipProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
