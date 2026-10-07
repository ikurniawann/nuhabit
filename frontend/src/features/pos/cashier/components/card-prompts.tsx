"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CardPrompt } from "../use-cashier-nfc";

/** Kartu tanpa member → tautkan/buat member; saldo ARK kurang → tawarkan top up. */
export function CardPrompts(props: {
  prompt: CardPrompt | null;
  formatArk: (value: number) => string;
  onDismiss: () => void;
  onCreateMember: (uid: string) => void;
  onTopup: (uid: string) => void;
}) {
  const { prompt } = props;
  const onOpenChange = (open: boolean) => {
    if (!open) props.onDismiss();
  };
  return (
    <>
      <AlertDialog open={prompt?.kind === "create"} onOpenChange={onOpenChange}>
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>Card ID has no member</AlertDialogTitle>
            <AlertDialogDescription>
              This card ID ({prompt?.kind === "create" ? prompt.uid : null}) is not linked to a member yet.
              Link it to an existing customer or create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (prompt?.kind !== "create") return;
                props.onDismiss();
                props.onCreateMember(prompt.uid);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={prompt?.kind === "topup"} onOpenChange={onOpenChange}>
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>Insufficient ARK balance</AlertDialogTitle>
            <AlertDialogDescription>
              {prompt?.kind === "topup"
                ? `Your remaining balance is ${props.formatArk(prompt.balance)}. Balance is insufficient for this payment. Would you like to top up?`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (prompt?.kind !== "topup") return;
                props.onDismiss();
                props.onTopup(prompt.uid);
              }}
            >
              Yes, top up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
