import type { ComponentType, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Kartu tengah layar untuk status portal kandidat (psikotes, interview, offer). */
export function StatusShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4">
      <Card className="w-full max-w-md p-6 text-center">{children}</Card>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <StatusShell>
      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
    </StatusShell>
  );
}

interface StatusScreenProps {
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  title: ReactNode;
  children: ReactNode;
}

export function StatusScreen({ icon: Icon, iconClassName, title, children }: StatusScreenProps) {
  return (
    <StatusShell>
      <Icon className={`mx-auto mb-3 size-8 ${iconClassName}`} />
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </StatusShell>
  );
}
