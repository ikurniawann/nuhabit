import type { DesktopOverview } from "@/lib/desktop/overview";
import {
  MAX_NOTIFICATION_HISTORY,
  diffOverviewNotifications,
  type ActivityNotification,
} from "@/lib/desktop/notifications";

/**
 * Notifikasi aktivitas: setiap snapshot overview (poll atau SSE) dibandingkan
 * dengan snapshot sebelumnya; kenaikan melahirkan popup dan masuk riwayat
 * Notification Center.
 */

export interface ActivityFeedState {
  previous: DesktopOverview | null;
  history: ActivityNotification[];
  popups: ActivityNotification[];
}

/** Popup yang tampil bersamaan; yang lebih lama tergeser (tetap ada di riwayat). */
export const MAX_POPUPS = 4;

export const EMPTY_ACTIVITY_FEED: ActivityFeedState = { previous: null, history: [], popups: [] };

export type ActivityFeedAction =
  | { type: "snapshot"; overview: DesktopOverview }
  | { type: "dismiss"; id: string }
  | { type: "clear" };

export function activityFeedReducer(state: ActivityFeedState, action: ActivityFeedAction): ActivityFeedState {
  switch (action.type) {
    case "snapshot": {
      const fresh = diffOverviewNotifications(state.previous, action.overview);
      if (fresh.length === 0) return { ...state, previous: action.overview };
      return {
        previous: action.overview,
        history: [...fresh, ...state.history].slice(0, MAX_NOTIFICATION_HISTORY),
        popups: [...state.popups, ...fresh].slice(-MAX_POPUPS),
      };
    }
    case "dismiss":
      return { ...state, popups: state.popups.filter((n) => n.id !== action.id) };
    case "clear":
      return { ...state, history: [] };
  }
}
