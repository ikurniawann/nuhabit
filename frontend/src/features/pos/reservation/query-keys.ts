import type { ReservationListParams } from "./types";

export const reservationQueryKeys = {
  all: ["pos", "reservations"] as const,
  list: (params: ReservationListParams) => ["pos", "reservations", "list", params] as const,
  customers: () => ["pos", "reservations", "customers"] as const,
  tables: () => ["pos", "reservations", "tables"] as const,
};
