import Link from "next/link";
import { ArrowLeftIcon, ClockIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ComingSoonPageProps = {
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
};

export function ComingSoonPage({
  title,
  description,
  backHref = "/dashboard",
  backLabel = "Kembali",
}: ComingSoonPageProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-2xl border-gray-200/70 shadow-sm">
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <ClockIcon className="h-7 w-7" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">Coming Soon</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-gray-500">{description}</p>
          <div className="mt-6">
            <Link href={backHref}>
              <Button variant="outline" className="gap-2">
                <ArrowLeftIcon className="h-4 w-4" />
                {backLabel}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
