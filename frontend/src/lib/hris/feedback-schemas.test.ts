import { describe, expect, it } from "vitest";
import { feedbackAssignmentUpdateSchema, feedbackCycleSchema } from "./feedback-schemas";

describe("feedback allowlists", () => {
  it("drops audit columns from a cycle body", () => {
    const parsed = feedbackCycleSchema.parse({ name: "Q4", created_by: "x", id: "y" });
    expect(parsed).toEqual({ name: "Q4" });
  });

  it("refuses approval states outside the approvals endpoint", () => {
    expect(feedbackAssignmentUpdateSchema.safeParse({ status: "approved" }).success).toBe(false);
    const ok = feedbackAssignmentUpdateSchema.parse({ status: "submitted", approved_by: "x" });
    expect(ok).toEqual({ status: "submitted" });
  });
});
