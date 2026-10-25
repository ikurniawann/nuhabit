"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TicketPlus } from "lucide-react";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { GymApiError } from "@/features/gym/shared";
import { COMPLAINT_KEYS, PRIORITY_LABEL, STATUS_LABEL, complaintsApi, ticketHref } from "../api";

/**
 * "Jadikan tiket" di inbox CRM: tiket keluhan dari percakapan ini, diisi dari
 * kontak, member, dan tanda komplain percakapan. Percakapan yang sudah punya
 * tiket menampilkan tiketnya.
 */
export function InboxTicketPanel({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const { can } = useIamAccess();
  const canCreate = can("gym.complaints", "create");
  const canRead = can("gym.complaints", "read") || canCreate;
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options, enabled: canRead });
  const view = useQuery({
    queryKey: COMPLAINT_KEYS.conversation(conversationId),
    queryFn: () => complaintsApi.conversation(conversationId),
    enabled: canRead,
  });
  const create = useMutation({
    mutationFn: () => complaintsApi.fromConversation(conversationId, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: COMPLAINT_KEYS.conversation(conversationId) }),
  });
  if (!canRead || !view.data) return null;
  const { ticket, suggestion } = view.data;
  const category = options.data?.categories.find((c) => c.code === suggestion.category)?.label ?? suggestion.category;
  const taken = create.error instanceof GymApiError && create.error.code === "COMPLAINT_EXISTS";

  return (
    <section className="space-y-2 border-t border-slate-200 p-4 text-xs">
      <h3 className="font-semibold tracking-wide text-slate-500 uppercase">Tiket keluhan</h3>
      {ticket ? (
        <Link href={ticketHref(ticket.id)} className="block rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
          <span className="block font-medium text-slate-800">
            {ticket.code} · {STATUS_LABEL[ticket.status]}
          </span>
          <span className="block truncate text-slate-500">{ticket.title}</span>
        </Link>
      ) : (
        <>
          <p className="text-slate-500">
            Kategori {category.toLowerCase()}, prioritas {PRIORITY_LABEL[suggestion.priority].toLowerCase()}
            {suggestion.sla_breached && " (naik karena SLA balas terlewat)"}.
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-800 px-3 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <TicketPlus className="size-3.5" />}
              Jadikan tiket
            </button>
          )}
          {create.error && !taken && <p className="text-red-700">{create.error.message}</p>}
        </>
      )}
    </section>
  );
}
