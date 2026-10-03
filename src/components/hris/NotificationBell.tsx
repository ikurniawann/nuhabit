"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Check, CheckCircle } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "approval" | "status_change" | "reminder" | "alert";
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_STYLES: Record<string, { dot: string; bg: string }> = {
  approval: { dot: "bg-blue-500", bg: "bg-blue-50" },
  status_change: { dot: "bg-green-500", bg: "bg-green-50" },
  reminder: { dot: "bg-yellow-500", bg: "bg-yellow-50" },
  alert: { dot: "bg-red-500", bg: "bg-red-50" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(dateStr).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/hris/notifications?limit=30");
      if (!res.ok) return;
      const json = await res.json();
      const data: Notification[] = json.data || [];
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.is_read).length);
    } catch {
      // Silent fail - notifications are non-critical
    }
  }, []);

  // Initial fetch + polling every 30s
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function markRead(id: string) {
    setMarking(id);
    try {
      await fetch("/api/hris/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_id: id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } finally {
      setMarking(null);
    }
  }

  async function markAllRead() {
    try {
      await fetch("/api/hris/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Silent fail
    }
  }

  function handleNotificationClick(n: Notification) {
    if (!n.is_read) markRead(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  // Sort: unread first, then by date
  const sorted = [...notifications].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-surface active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
        aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}
      >
        {unreadCount > 0 ? (
          <BellRing className="w-5 h-5" />
        ) : (
          <Bell className="w-5 h-5" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-[10.5px] font-bold text-accent-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(400px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-float">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <div>
              <h3 className="text-base font-semibold text-foreground">Notifikasi</h3>
              <p className="text-xs text-gray-500">
                {unreadCount > 0 ? `${unreadCount} belum dibaca` : "Semua sudah dibaca"}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-foreground hover:bg-black/5"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Tandai semua
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50">
            {sorted.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Tidak ada notifikasi</p>
              </div>
            ) : (
              sorted.map((n) => {
                const style = TYPE_STYLES[n.type] || TYPE_STYLES.alert;
                return (
                  <div
                    key={n.id}
                    className={`px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 ${!n.is_read ? style.bg : ""}`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Unread dot */}
                      <div className="mt-1.5 shrink-0">
                        {n.is_read ? (
                          <div className="w-2 h-2 rounded-full bg-gray-200" />
                        ) : (
                          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-tight ${n.is_read ? "text-gray-600" : "text-gray-900 font-medium"}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                      {/* Mark read button (single) */}
                      {!n.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                          disabled={marking === n.id}
                          className="shrink-0 mt-0.5 p-1 rounded hover:bg-white/80 text-gray-400 hover:text-green-600"
                          title="Tandai sudah dibaca"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-center">
              <button
                onClick={() => { setOpen(false); fetchNotifications(); }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
