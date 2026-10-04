// EPIC-039 Fase F — engine sinkronisasi marketplace.
// Arah: PUSH stok (NüHabit master, minus buffer per akun) dan PULL order
// (idempoten by order_sn; order READY_TO_SHIP → shop.orders source shopee
// + klaim stok). Stok tidak cukup saat pull → order TETAP dicatat (barang
// sudah terjual di Shopee) + sync_log error supaya admin rekonsiliasi.

import { query, queryOne } from "@/lib/db";
import { shopeeAdapter } from "./shopee";
import {
  type MarketplaceAccountRow,
  type MarketplaceAdapter,
  type MarketplaceOrder,
  MarketplaceError,
} from "./types";

export * from "./types";

export function resolveMarketplaceAdapter(channel: string): MarketplaceAdapter {
  if (channel === "shopee") return shopeeAdapter;
  throw new MarketplaceError(`Channel marketplace tidak dikenal: ${channel}`, 400);
}

export async function logSync(
  accountId: string | null,
  direction: "push_stock" | "pull_orders" | "auth",
  status: "ok" | "error",
  detail: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO shop.marketplace_sync_log (account_id, direction, status, detail)
     VALUES ($1::uuid, $2, $3, $4::jsonb)`,
    [accountId, direction, status, JSON.stringify(detail)]
  ).catch((err) => console.error("[marketplace] sync log failed:", err));
}

/** Refresh token bila hampir kedaluwarsa (< 10 menit); simpan hasilnya. */
export async function ensureFreshToken(
  account: MarketplaceAccountRow
): Promise<MarketplaceAccountRow> {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && expiresAt - Date.now() > 10 * 60 * 1000) {
    return account;
  }
  const adapter = resolveMarketplaceAdapter(account.channel_code);
  try {
    const bundle = await adapter.refreshToken(account);
    await query(
      `UPDATE shop.marketplace_accounts
       SET access_token=$2, refresh_token=$3, token_expires_at=$4,
           status='connected', updated_at=now()
       WHERE id = $1::uuid`,
      [account.id, bundle.accessToken, bundle.refreshToken, bundle.expiresAt.toISOString()]
    );
    return {
      ...account,
      access_token: bundle.accessToken,
      refresh_token: bundle.refreshToken,
      token_expires_at: bundle.expiresAt.toISOString(),
      status: "connected",
    };
  } catch (error) {
    await query(
      `UPDATE shop.marketplace_accounts SET status='expired', updated_at=now() WHERE id=$1::uuid`,
      [account.id]
    ).catch(() => {});
    throw error;
  }
}

type LinkRow = {
  id: string;
  product_id: string;
  sku_id: string | null;
  marketplace_item_id: string;
  marketplace_model_id: string | null;
};

/** Stok lokal efektif utk sebuah link (produk flat atau per SKU). */
async function localStockForLink(link: LinkRow): Promise<number> {
  if (link.sku_id) {
    const row = await queryOne<{ stock_quantity: string }>(
      "SELECT stock_quantity FROM pos.pos_product_skus WHERE id = $1::uuid",
      [link.sku_id]
    );
    return Number(row?.stock_quantity) || 0;
  }
  const row = await queryOne<{ inventory_quantity: string | null }>(
    "SELECT inventory_quantity FROM pos.pos_products WHERE id = $1::uuid",
    [link.product_id]
  );
  return Number(row?.inventory_quantity) || 0;
}

/** Push stok semua link sebuah akun. Return ringkasan utk UI/log. */
export async function pushAllStock(
  accountInput: MarketplaceAccountRow
): Promise<{ pushed: number; failed: number }> {
  const account = await ensureFreshToken(accountInput);
  const adapter = resolveMarketplaceAdapter(account.channel_code);
  const links = await query<LinkRow>(
    `SELECT id, product_id, sku_id, marketplace_item_id, marketplace_model_id
     FROM shop.marketplace_links WHERE account_id = $1::uuid`,
    [account.id]
  );

  let pushed = 0;
  let failed = 0;
  for (const link of links) {
    try {
      const stock = Math.max(0, (await localStockForLink(link)) - account.stock_buffer);
      await adapter.pushStock(
        account,
        { itemId: link.marketplace_item_id, modelId: link.marketplace_model_id },
        stock
      );
      await query(
        `UPDATE shop.marketplace_links
         SET last_pushed_stock=$2, last_push_at=now(), updated_at=now()
         WHERE id = $1::uuid`,
        [link.id, stock]
      );
      pushed++;
    } catch (error) {
      failed++;
      console.error(`[marketplace] push stock failed link=${link.id}:`, error);
    }
  }

  await logSync(account.id, "push_stock", failed === 0 ? "ok" : "error", {
    pushed,
    failed,
    total: links.length,
  });
  return { pushed, failed };
}

// Status Shopee yang berarti "sudah dibayar, harus diproses/dikirim"
const IMPORTABLE_STATUSES = new Set(["READY_TO_SHIP", "PROCESSED", "SHIPPED", "COMPLETED"]);
const STATUS_MAP: Record<string, string> = {
  READY_TO_SHIP: "paid",
  PROCESSED: "packing",
  SHIPPED: "shipped",
  COMPLETED: "completed",
};

async function claimStockForOrder(
  order: MarketplaceOrder,
  links: Map<string, LinkRow>
): Promise<{ claimed: boolean; missingLinks: string[] }> {
  const missingLinks: string[] = [];
  let allClaimed = true;

  for (const item of order.items) {
    const link = links.get(`${item.itemId}::${item.modelId ?? ""}`);
    if (!link) {
      missingLinks.push(item.itemName);
      allClaimed = false;
      continue;
    }
    const fn = link.sku_id
      ? { name: "pos_sell_merchandise_sku_stock", id: link.sku_id }
      : { name: "pos_sell_merchandise_stock", id: link.product_id };
    const row = await queryOne<{ result: { success?: boolean; reason?: string } }>(
      `SELECT public.${fn.name}($1::uuid, $2::numeric) AS result`,
      [fn.id, item.quantity]
    );
    if (row?.result?.success === false) {
      allClaimed = false;
    }
  }
  return { claimed: allClaimed, missingLinks };
}

/** Pull order akun → shop.orders (idempoten). Return ringkasan. */
export async function pullMarketplaceOrders(
  accountInput: MarketplaceAccountRow
): Promise<{ imported: number; skipped: number; stockIssues: number }> {
  const account = await ensureFreshToken(accountInput);
  const adapter = resolveMarketplaceAdapter(account.channel_code);

  // Sejak pull terakhir (mundur 15 menit utk tumpang tindih aman); default 3 hari
  const since = account.last_pull_at
    ? new Date(new Date(account.last_pull_at).getTime() - 15 * 60 * 1000)
    : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const orders = await adapter.pullOrders(account, since);

  const linkRows = await query<LinkRow>(
    `SELECT id, product_id, sku_id, marketplace_item_id, marketplace_model_id
     FROM shop.marketplace_links WHERE account_id = $1::uuid`,
    [account.id]
  );
  const links = new Map(
    linkRows.map((link) => [
      `${link.marketplace_item_id}::${link.marketplace_model_id ?? ""}`,
      link,
    ])
  );

  let imported = 0;
  let skipped = 0;
  let stockIssues = 0;

  for (const order of orders) {
    if (!IMPORTABLE_STATUSES.has(order.status)) {
      skipped++;
      continue;
    }

    // Idempoten: order_sn unik — yang sudah pernah diimpor hanya di-update statusnya
    const existing = await queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM shop.orders WHERE marketplace_order_sn = $1",
      [order.orderSn]
    );
    if (existing) {
      const mapped = STATUS_MAP[order.status];
      if (mapped && !["cancelled", "refund", "completed"].includes(existing.status)) {
        await query(
          `UPDATE shop.orders SET status=$2, updated_at=now()
           WHERE id=$1::uuid AND status <> $2`,
          [existing.id, mapped]
        );
      }
      skipped++;
      continue;
    }

    const { claimed, missingLinks } = await claimStockForOrder(order, links);
    if (!claimed) stockIssues++;

    const note = [
      `Order Shopee ${order.orderSn} (${order.status})`,
      missingLinks.length ? `ITEM TANPA MAPPING: ${missingLinks.join(", ")}` : null,
      !claimed ? "PERHATIAN: stok lokal tidak terpotong penuh — rekonsiliasi manual" : null,
    ]
      .filter(Boolean)
      .join("\n");

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO shop.orders (
         source_channel, marketplace_order_sn, status,
         customer_name, customer_phone, shipping_address,
         shipping_area_label, subtotal, shipping_cost, total, notes, paid_at
       ) VALUES ('shopee', $1, $2, $3, $4, $5, 'Shopee', $6, 0, $6, $7, now())
       RETURNING id`,
      [
        order.orderSn,
        STATUS_MAP[order.status] || "paid",
        order.recipientName || order.buyerName || "Pembeli Shopee",
        order.recipientPhone || "-",
        order.fullAddress || "Alamat dikelola Shopee",
        order.totalAmount,
        note,
      ]
    );

    if (inserted) {
      for (const item of order.items) {
        const link = links.get(`${item.itemId}::${item.modelId ?? ""}`);
        await query(
          `INSERT INTO shop.order_items (
             order_id, product_id, sku_id, product_name, quantity, unit_price, total
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
          [
            inserted.id,
            link?.product_id ?? null,
            link?.sku_id ?? null,
            item.itemName,
            item.quantity,
            item.price,
            item.price * item.quantity,
          ]
        );
      }
      imported++;
    }
  }

  await query(
    `UPDATE shop.marketplace_accounts SET last_pull_at=now(), updated_at=now()
     WHERE id = $1::uuid`,
    [account.id]
  );
  await logSync(account.id, "pull_orders", stockIssues === 0 ? "ok" : "error", {
    imported,
    skipped,
    stock_issues: stockIssues,
    fetched: orders.length,
  });

  return { imported, skipped, stockIssues };
}
