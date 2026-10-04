"use client";

import { useState } from "react";
import type { FieldValues, UseFormHandleSubmit } from "react-hook-form";
import { toast } from "sonner";
import { firstFormErrorMessage } from "@/lib/purchasing/pr-ui-form";

export type PrSubmitAction = "draft" | "submit";

/**
 * Submit form PR sebagai draf atau ajukan. Galat validasi dan galat server tampil
 * sebagai toast; NEXT_REDIRECT dilempar ulang tanpa toast supaya redirect jalan.
 */
export function usePrFormSubmit<T extends FieldValues>(
  handleSubmit: UseFormHandleSubmit<T>,
  onSubmit: (data: T, action: PrSubmitAction) => void | Promise<void>
) {
  const [submitAction, setSubmitAction] = useState<PrSubmitAction | null>(null);

  const submitWithAction = (action: PrSubmitAction) =>
    handleSubmit(
      async (data) => {
        setSubmitAction(action);
        try {
          await onSubmit(data, action);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gagal menyimpan purchase request";
          if (!message.includes("NEXT_REDIRECT")) toast.error(message);
          throw error;
        } finally {
          setSubmitAction(null);
        }
      },
      (formErrors) => {
        const message = firstFormErrorMessage(formErrors);
        toast.error(
          message
            ? `Lengkapi formulir: ${message}`
            : "Periksa kembali formulir, masih ada field wajib yang belum diisi"
        );
      }
    )();

  return { submitAction, submitWithAction };
}
