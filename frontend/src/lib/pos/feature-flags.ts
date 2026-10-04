/**
 * POS shift open/close workflow (opening cash, closing reconciliation).
 * Set `NEXT_PUBLIC_POS_SHIFT_MANAGEMENT_ENABLED=true` to re-enable.
 */
export const POS_SHIFT_MANAGEMENT_ENABLED =
  process.env.NEXT_PUBLIC_POS_SHIFT_MANAGEMENT_ENABLED === "true";
