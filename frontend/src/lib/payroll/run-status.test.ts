import { describe, it, expect } from "vitest";
import {
  canTransitionRunStatus,
  canDeleteRun,
  canCalculateRun,
} from "./run-status";

describe("canTransitionRunStatus", () => {
  it("allows only the forward chain draft→processing→completed→paid", () => {
    expect(canTransitionRunStatus("draft", "processing")).toBe(true);
    expect(canTransitionRunStatus("processing", "completed")).toBe(true);
    expect(canTransitionRunStatus("completed", "paid")).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(canTransitionRunStatus("draft", "completed")).toBe(false);
    expect(canTransitionRunStatus("draft", "paid")).toBe(false);
    expect(canTransitionRunStatus("processing", "paid")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(canTransitionRunStatus("processing", "draft")).toBe(false);
    expect(canTransitionRunStatus("completed", "processing")).toBe(false);
    expect(canTransitionRunStatus("paid", "completed")).toBe(false);
  });

  it("rejects any transition out of paid", () => {
    expect(canTransitionRunStatus("paid", "draft")).toBe(false);
    expect(canTransitionRunStatus("paid", "processing")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionRunStatus("cancelled", "paid")).toBe(false);
    expect(canTransitionRunStatus("draft", "cancelled")).toBe(false);
  });
});

describe("canDeleteRun / canCalculateRun", () => {
  it("paid runs are undeletable", () => {
    expect(canDeleteRun("paid")).toBe(false);
    expect(canDeleteRun("draft")).toBe(true);
    expect(canDeleteRun("completed")).toBe(true);
  });

  it("only draft runs are calculable", () => {
    expect(canCalculateRun("draft")).toBe(true);
    expect(canCalculateRun("processing")).toBe(false);
    expect(canCalculateRun("completed")).toBe(false);
    expect(canCalculateRun("paid")).toBe(false);
  });
});
