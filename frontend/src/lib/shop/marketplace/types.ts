// EPIC-039 Fase F — kontrak adapter marketplace (Shopee dulu; Tokopedia/
// TikTok Shop tinggal menambah adapter dengan interface yang sama).

import { ApiError } from "@/lib/api/auth";

export type MarketplaceChannel = "shopee";

export type MarketplaceAccountRow = {
  id: string;
  channel_code: MarketplaceChannel;
  shop_id: string;
  shop_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: "connected" | "expired" | "disconnected";
  stock_buffer: number;
  last_pull_at: string | null;
};

export type MarketplaceListing = {
  itemId: string;
  itemName: string;
  /** Item ber-variasi punya daftar model; tanpa variasi = [] */
  models: Array<{ modelId: string; modelName: string; modelSku: string | null }>;
};

export type MarketplaceOrderItem = {
  itemId: string;
  modelId: string | null;
  itemName: string;
  quantity: number;
  price: number;
};

export type MarketplaceOrder = {
  orderSn: string;
  status: string;
  buyerName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  fullAddress: string | null;
  totalAmount: number;
  items: MarketplaceOrderItem[];
};

export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  shopName?: string | null;
};

export interface MarketplaceAdapter {
  channel: MarketplaceChannel;
  /** URL otorisasi toko (owner klik → login Shopee → redirect balik) */
  buildAuthUrl(redirectUrl: string): string;
  /** Tukar code hasil redirect menjadi token toko */
  exchangeCode(code: string, shopId: string): Promise<TokenBundle>;
  refreshToken(account: MarketplaceAccountRow): Promise<TokenBundle>;
  /** Daftar listing utk mapping (item + model/variasi) */
  listListings(account: MarketplaceAccountRow): Promise<MarketplaceListing[]>;
  /** Push stok satu listing (model NULL = item tanpa variasi) */
  pushStock(
    account: MarketplaceAccountRow,
    target: { itemId: string; modelId: string | null },
    stock: number
  ): Promise<void>;
  /** Order berstatus siap-proses sejak `since` (dibayar di marketplace) */
  pullOrders(account: MarketplaceAccountRow, since: Date): Promise<MarketplaceOrder[]>;
}

/** Galat marketplace = ApiError (default 502) supaya apiHandler meneruskan status & pesannya. */
export class MarketplaceError extends ApiError {
  constructor(message: string, status = 502) {
    super(status, message);
    this.name = "MarketplaceError";
  }
}
