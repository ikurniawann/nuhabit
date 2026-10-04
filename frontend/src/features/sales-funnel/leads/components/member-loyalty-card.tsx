"use client";

import { formatDate, formatNumber } from "@/lib/format";
import { useEffect, useState } from "react";
import { Coins, CreditCard, Link2, Loader2, Unlink, UserPlus2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { formatRupiahOrDash } from "../../pipeline/types";
import {
  useCustomerSearch,
  useLinkLeadCustomer,
  useUnlinkLeadCustomer,
} from "../queries";
import type {
  CustomerOrderSummary,
  LinkedCustomer,
  SalesLead,
} from "../types";

interface MemberLoyaltyCardProps {
  lead: SalesLead;
  customer: LinkedCustomer | null;
  recentOrders: CustomerOrderSummary[];
}

export function MemberLoyaltyCard({
  lead,
  customer,
  recentOrders,
}: MemberLoyaltyCardProps) {
  // Prefill nomor PIC — API hanya mengizinkan tautan ke member dengan
  // no. WA yang sama (anti-IDOR), jadi kandidatnya langsung terlihat.
  const [search, setSearch] = useState(lead.pic_phone);
  const [query, setQuery] = useState(lead.pic_phone);
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const searchQuery = useCustomerSearch(query);
  const linkMutation = useLinkLeadCustomer(() => setSearch(""));
  const unlinkMutation = useUnlinkLeadCustomer();

  const results = searchQuery.data ?? [];

  if (customer) {
    return (
      <div className="rounded-2xl border border-gray-200/70 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Member Loyalty PIC
            </p>
            <p className="mt-0.5 text-sm text-gray-600">
              {customer.name ?? lead.pic_name}{" "}
              <Badge className="ml-1 border-0 bg-amber-100 font-normal capitalize text-amber-700">
                {customer.membership_tier ?? "regular"}
              </Badge>
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setUnlinking(true)}
            className="h-8 gap-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            <Unlink className="h-3.5 w-3.5" />
            Lepas
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-400">Total Belanja POS</p>
            <p className="font-semibold text-gray-900">
              {formatRupiahOrDash(customer.total_spent)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Kunjungan</p>
            <p className="text-gray-900">{customer.visit_count ?? 0}×</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Kunjungan Terakhir</p>
            <p className="text-gray-900">{formatDate(customer.last_visit, "—")}</p>
          </div>
          <div>
            <p className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Coins className="h-3 w-3" /> Ark Coin
            </p>
            <p className="text-gray-900">
              {formatNumber(customer.ark_coin_balance)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Total XP</p>
            <p className="text-gray-900">
              {formatNumber(customer.total_xp)}
            </p>
          </div>
        </div>

        {recentOrders.length > 0 ? (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <CreditCard className="h-3.5 w-3.5" /> Transaksi POS Terakhir
            </p>
            <ul className="space-y-1.5 text-sm">
              {recentOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between">
                  <span className="text-gray-500">
                    {formatDate(order.created_at, "—")}
                  </span>
                  <span className="font-medium text-gray-900">
                    {formatRupiahOrDash(order.total_amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ConfirmDialog
          open={unlinking}
          onOpenChange={setUnlinking}
          title="Lepas tautan member?"
          description={`PIC ${lead.pic_name} tidak lagi tertaut ke member "${customer.name ?? ""}". Data member tetap utuh.`}
          confirmLabel="Lepas Tautan"
          variant="danger"
          onConfirm={() => {
            unlinkMutation.mutate(lead.id);
            setUnlinking(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-5">
      <p className="text-sm font-semibold text-gray-900">Member Loyalty PIC</p>
      <p className="mt-0.5 text-xs text-gray-500">
        Tautkan {lead.pic_name} ke member loyalty untuk melihat riwayat POS &
        tier-nya di sini.
      </p>

      <div className="mt-3 space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari member by no. WA PIC (min. 3 karakter)"
          className="h-9 bg-white text-sm"
        />
        <p className="px-1 text-xs text-gray-400">
          Hanya member dengan no. WA yang sama dengan PIC yang bisa ditautkan.
        </p>
        {query.length >= 3 ? (
          searchQuery.isLoading ? (
            <div className="py-2 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-pink-600" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-1 text-xs text-gray-400">Tidak ada member cocok.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() =>
                      linkMutation.mutate({
                        leadId: lead.id,
                        payload: { customer_id: result.id },
                      })
                    }
                    disabled={linkMutation.isPending}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-pink-50"
                  >
                    <span>
                      <span className="font-medium text-gray-900">
                        {result.name ?? "Tanpa nama"}
                      </span>
                      <span className="ml-2 font-mono text-xs text-gray-500">
                        {result.phone}
                      </span>
                    </span>
                    <Link2 className="h-4 w-4 text-pink-500" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            linkMutation.mutate({
              leadId: lead.id,
              payload: { create_from_pic: true },
            })
          }
          disabled={linkMutation.isPending}
          className="h-9 w-full gap-1.5 rounded-lg border-pink-200 text-pink-700 hover:bg-pink-50"
        >
          {linkMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus2 className="h-3.5 w-3.5" />
          )}
          Jadikan {lead.pic_name} Member Baru
        </Button>
      </div>
    </div>
  );
}
