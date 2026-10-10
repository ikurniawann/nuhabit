// Order progress steps for the public status page.

import type { DeliveryMethod } from "./types";

export type OrderStep = { status: string; label: string };

const SHIP_STEPS: OrderStep[] = [
  { status: "pending", label: "Awaiting payment" },
  { status: "paid", label: "Paid" },
  { status: "packing", label: "Packing" },
  { status: "shipped", label: "Shipped" },
  { status: "completed", label: "Delivered" },
];

const PICKUP_STEPS: OrderStep[] = [
  { status: "pending", label: "Awaiting payment" },
  { status: "paid", label: "Paid" },
  { status: "ready_for_pickup", label: "Ready for pickup" },
  { status: "picked_up", label: "Picked up" },
];

export const orderSteps = (method: DeliveryMethod): OrderStep[] =>
  method === "pickup" ? PICKUP_STEPS : SHIP_STEPS;

/**
 * Index of the current step, or -1 for cancelled and refunded orders. A
 * status outside the list (an old order) counts as the last step.
 */
export function orderStepIndex(method: DeliveryMethod, status: string): number {
  if (status === "cancelled" || status === "refund") return -1;
  const steps = orderSteps(method);
  const index = steps.findIndex((step) => step.status === status);
  return index === -1 ? steps.length - 1 : index;
}
