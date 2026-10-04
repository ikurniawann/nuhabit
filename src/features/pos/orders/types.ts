export type {
  Order,
  OrderItem,
  Customer,
} from "@/lib/pos-api";

export interface OrderListParams {
  status?: string;
  customer_id?: string;
  payment_status?: string;
  order_type?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  active_only?: boolean;
  limit?: number;
}
