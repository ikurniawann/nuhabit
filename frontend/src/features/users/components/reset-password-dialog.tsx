"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { useResetUserPassword } from "../mutations";

export type ResetPasswordTarget = {
  id: string;
  fullName: string;
};

interface ResetPasswordDialogProps {
  target: ResetPasswordTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResetPasswordDialog({ target, open, onOpenChange }: ResetPasswordDialogProps) {
  const mutation = useResetUserPassword();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleClose() {
    if (mutation.isPending) return;
    setTempPassword(null);
    setCopied(false);
    onOpenChange(false);
  }

  async function handleConfirm() {
    if (!target || mutation.isPending) return;
    try {
      const res = await mutation.mutateAsync(target.id);
      setTempPassword(res.tempPassword);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password");
      onOpenChange(false);
    }
  }

  async function handleCopy() {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const isSuccess = Boolean(tempPassword);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
        else onOpenChange(true);
      }}
    >
      <DialogPanel size="xs">
        <DialogPanelHeader>
          <DialogPanelTitle>{isSuccess ? "Password Reset" : "Reset Password?"}</DialogPanelTitle>
          <DialogPanelDescription>
            {isSuccess ? (
              <>
                A new temporary password was generated for{" "}
                <span className="font-medium text-gray-900">{target?.fullName}</span>. Share it
                securely with the employee.
              </>
            ) : (
              <>
                Generate a new temporary password for{" "}
                <span className="font-medium text-gray-900">{target?.fullName}</span>? Their current
                password will stop working immediately.
              </>
            )}
          </DialogPanelDescription>
        </DialogPanelHeader>

        {isSuccess ? (
          <DialogPanelBody className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-600">Temporary password</p>
              <div className="flex gap-2">
                <Input readOnly value={tempPassword ?? ""} className="h-10 font-mono text-sm" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 rounded-lg border-gray-200/80"
                  onClick={handleCopy}
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </DialogPanelBody>
        ) : null}

        <DialogFooter>
          {isSuccess ? (
            <Button
              type="button"
              onClick={handleClose}
              className="h-10 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white hover:bg-pink-700"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={mutation.isPending}
                className="h-10 rounded-lg border-gray-200/80"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={mutation.isPending}
                className="h-10 gap-2 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white hover:bg-pink-700"
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {mutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
