"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { usePurchaseRequest } from "@/features/purchasing/pr/queries";
import {
  emptyPOForm,
  mapPOItemToForm,
  mapPRItemToForm,
  poFormFromExisting,
} from "@/lib/purchasing/po-form-items";
import { todayIsoDate } from "@/lib/purchasing/po-ui-detail";
import { usePOFormData, usePurchaseOrder } from "../queries";
import type { POFormData } from "../api";
import { POForm } from "./form/po-form";
import { PORequiresPR } from "./form/po-requires-pr";

function Message({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div
      className={`flex items-center justify-center py-20 text-sm ${tone === "error" ? "text-red-600" : "text-gray-500"}`}
    >
      {children}
    </div>
  );
}

const LOADING = <Message>Memuat formulir purchase order...</Message>;

type NewPOPageProps = {
  poId?: string;
};

/** Buat PO dari PR disetujui (?pr_id=), atau ubah PO draf bila `poId` diisi. */
export function NewPOPage({ poId }: NewPOPageProps = {}) {
  const searchParams = useSearchParams();
  const formDataQuery = usePOFormData();
  const prId = poId ? null : searchParams.get("pr_id");

  if (formDataQuery.isError) return <Message tone="error">Gagal memuat data formulir purchase order</Message>;
  if (!formDataQuery.data) return LOADING;
  if (poId) return <EditPOForm poId={poId} lookups={formDataQuery.data} />;
  if (!prId) return <PORequiresPR lookups={formDataQuery.data} />;
  return <CreatePOForm prId={prId} lookups={formDataQuery.data} />;
}

function CreatePOForm({ prId, lookups }: { prId: string; lookups: POFormData }) {
  const prQuery = usePurchaseRequest(prId);
  const pr = prQuery.data;
  const eligible = Boolean(pr && pr.status === "approved" && !pr.converted_po_id);
  const ineligible = Boolean(pr) && !eligible;

  useEffect(() => {
    if (ineligible) toast.error("Purchase request belum disetujui atau sudah memiliki purchase order");
  }, [ineligible]);

  if (prQuery.isLoading) return LOADING;
  if (prQuery.isError) {
    return (
      <Message tone="error">
        {prQuery.error instanceof Error ? prQuery.error.message : "Gagal memuat purchase request"}
      </Message>
    );
  }

  const sourcePR = eligible ? pr : undefined;
  return (
    <POForm
      key={sourcePR?.id ?? "no-pr"}
      title="Buat Purchase Order"
      description={
        sourcePR
          ? `Dari purchase request ${sourcePR.pr_number}. Qty dan harga masih bisa disesuaikan sebelum disimpan`
          : "Purchase request tidak dapat dipakai untuk membuat purchase order"
      }
      initialForm={emptyPOForm(sourcePR?.id, todayIsoDate())}
      initialItems={(sourcePR?.items ?? []).map((item) => mapPRItemToForm(item, lookups.materials, lookups.units))}
      prSource={
        sourcePR
          ? {
              id: sourcePR.id,
              pr_number: sourcePR.pr_number,
              badge: sourcePR.status,
              badgeClass: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
              detail: `${sourcePR.department_name || sourcePR.department?.name || "-"} · ${sourcePR.items?.length || 0} item`,
            }
          : null
      }
      lookups={lookups}
    />
  );
}

function EditPOForm({ poId, lookups }: { poId: string; lookups: POFormData }) {
  const router = useRouter();
  const detailQuery = usePurchaseOrder(poId);
  const po = detailQuery.data;
  const notDraft = Boolean(po) && po?.status.toLowerCase() !== "draft";

  useEffect(() => {
    if (!notDraft) return;
    toast.error("PO hanya bisa diedit saat status draft");
    router.replace(`/dashboard/purchasing/po/${poId}`);
  }, [notDraft, poId, router]);

  if (detailQuery.isLoading || notDraft) return LOADING;
  if (!po) return <Message tone="error">Gagal memuat purchase order</Message>;

  return (
    <POForm
      key={po.id}
      poId={po.id}
      title={`Ubah ${po.nomor_po || "Purchase Order"}`}
      description="Perbarui informasi purchase order draf. Item tidak dapat diubah."
      initialForm={poFormFromExisting(po, todayIsoDate())}
      initialItems={(po.items ?? []).map(mapPOItemToForm)}
      prSource={
        po.pr_id
          ? {
              id: po.pr_id,
              pr_number: po.pr_number || "Purchase Request terkait",
              badge: "Purchase Request",
              badgeClass: "bg-blue-100 text-blue-700 hover:bg-blue-100",
            }
          : null
      }
      lookups={lookups}
    />
  );
}
