import { fetchAPI, toQueryString, type ApiResult } from "./http";

// Reservasi & antrian.
// ============ RESERVATIONS ============

export async function getReservations(params?: { date?: string; status?: string }) {
  return fetchAPI<ApiResult<unknown[]>>(`/reservations${toQueryString(params)}`);
}

export async function createReservation(reservation: {
  customer_name: string;
  customer_phone: string;
  reservation_date: string;
  time_slot: string;
  pax_count: number;
  table_id?: string;
  customer_id?: string;
  deposit_amount?: number;
  notes?: string;
  special_requests?: string;
}) {
  return fetchAPI<ApiResult<unknown>>('/reservations', {
    method: 'POST',
    body: JSON.stringify(reservation),
  });
}

export async function updateReservationStatus(
  reservationId: string,
  status: string,
  additionalData?: { notes?: string }
) {
  return fetchAPI<ApiResult<unknown>>(`/reservations/${reservationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...additionalData }),
  });
}

export async function seatReservation(
  reservationId: string,
  payload?: { table_id?: string | null }
) {
  return fetchAPI<{
    success: boolean;
    data?: {
      reservation: unknown;
      order: { id: string; table_id?: string | null; order_number?: string };
      message?: string;
    };
    error?: string;
  }>(`/reservations/${reservationId}/seat`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}
