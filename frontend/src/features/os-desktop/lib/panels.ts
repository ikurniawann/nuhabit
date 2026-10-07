/** Panel & jendela bawaan desktop yang dibuka/ditutup lewat dock, menu, dan pintasan. */

export const PANEL_NAMES = [
  "command",
  "library",
  "notifications",
  "waNotif",
  "assistant",
  "assistantShortcut",
  "files",
  "account",
  "wallpaper",
  "widgets",
  "settings",
  "about",
  "shortcuts",
  "today",
  "locked",
] as const;

export type PanelName = (typeof PANEL_NAMES)[number];
export type PanelState = Record<PanelName, boolean>;

export const CLOSED_PANELS = Object.fromEntries(PANEL_NAMES.map((name) => [name, false])) as PanelState;

/** Escape menutup lapisan sementara sekaligus; jendela biasa ditutup satu per satu. */
const ESCAPE_CLOSES: PanelName[] = ["command", "library", "notifications", "assistantShortcut"];

export type PanelAction =
  | { type: "open"; panel: PanelName }
  | { type: "close"; panel: PanelName }
  | { type: "toggle"; panel: PanelName }
  | { type: "escape" };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "open":
      return state[action.panel] ? state : { ...state, [action.panel]: true };
    case "close":
      return state[action.panel] ? { ...state, [action.panel]: false } : state;
    case "toggle":
      return { ...state, [action.panel]: !state[action.panel] };
    case "escape":
      return ESCAPE_CLOSES.some((name) => state[name])
        ? { ...state, ...Object.fromEntries(ESCAPE_CLOSES.map((name) => [name, false])) }
        : state;
  }
}
