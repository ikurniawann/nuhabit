import { Suspense } from "react";
import { CalendarPage } from "@/features/events/components/calendar-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CalendarPage />
    </Suspense>
  );
}
