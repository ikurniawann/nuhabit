"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock,
  Dumbbell,
  Hourglass,
  Megaphone,
} from "lucide-react";
import { notificationKind, type NotificationKind } from "@/lib/member-app/home";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { useInvalidateAll, useNotifications } from "../lib/queries-home";
import { EmptyState, Spinner, formatDayTime } from "../ui";

const TYPE_ICON: Record<NotificationKind, typeof Bell> = {
  BOOKING_CONFIRMED: CheckCircle2,
  BOOKING_REMINDER: Clock,
  WAITLIST_PROMOTED: ArrowUpCircle,
  LOW_BALANCE: AlertTriangle,
  CREDIT_EXPIRY: Hourglass,
  VISIT_LOGGED: Dumbbell,
  SESSION_CHANGED: CalendarDays,
  ANNOUNCEMENT: Megaphone,
  OTHER: Bell,
};

export function NotificationsPage() {
  const t = useT();
  const { data: notifications, isLoading } = useNotifications();
  const invalidate = useInvalidateAll();
  const readAll = useMutation({
    mutationFn: () => memberApi("/notifications", { method: "POST", json: {} }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Spinner label={t("Loading notifications…")} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="nh-display text-3xl font-black">{t("Notifications")}</h1>
        <button
          className="text-sm font-bold text-nh-forest"
          onClick={() => readAll.mutate()}
          disabled={readAll.isPending}
        >
          {t("Mark all read")}
        </button>
      </div>
      {!notifications || notifications.length === 0 ? (
        <EmptyState title={t("Nothing here yet")} hint={t("Booking updates and reminders will show up here.")} />
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[notificationKind(n.type)];
            return (
              <div
                key={n.id}
                className={`nh-card flex gap-3 !p-3 ${n.readAt === null ? "!border-nh-forest/50" : "opacity-70"}`}
              >
                <Icon size={20} className="mt-0.5 shrink-0 text-nh-forest" />
                <div className="min-w-0">
                  <p className="text-sm font-black">{n.title}</p>
                  <p className="text-sm text-nh-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-nh-muted/60">{formatDayTime(n.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
