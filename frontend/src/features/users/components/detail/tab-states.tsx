import type { ComponentType, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function TabSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
    </div>
  );
}

export function EmptyTabCard({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-gray-400">
        <Icon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        {children}
      </CardContent>
    </Card>
  );
}
