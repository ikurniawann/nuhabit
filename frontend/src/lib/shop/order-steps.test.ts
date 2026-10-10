import { describe, expect, it } from "vitest";
import { orderStepIndex, orderSteps } from "./order-steps";

describe("order steps", () => {
  it("pickup orders end at picked up; shipped orders at delivered", () => {
    expect(orderSteps("pickup").map((step) => step.status)).toEqual(["pending", "paid", "ready_for_pickup", "picked_up"]);
    expect(orderSteps("ship").map((step) => step.status)).toEqual(["pending", "paid", "packing", "shipped", "completed"]);
  });

  it("finds the current step, treats unknown statuses as done and cancellations as none", () => {
    expect(orderStepIndex("pickup", "ready_for_pickup")).toBe(2);
    expect(orderStepIndex("ship", "shipped")).toBe(3);
    expect(orderStepIndex("ship", "mystery")).toBe(4);
    expect(orderStepIndex("ship", "cancelled")).toBe(-1);
    expect(orderStepIndex("pickup", "refund")).toBe(-1);
  });
});
