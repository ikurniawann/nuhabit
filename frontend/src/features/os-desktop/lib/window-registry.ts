/**
 * Daftar jendela terbuka: urutan fokus (terakhir = paling depan), status
 * dikecilkan, dan perintah snap/maximize yang menunggu dijalankan jendelanya.
 * Murni; perekatan ke React ada di hooks/use-window-manager.
 */

export type WindowCommand = "snap-left" | "snap-right" | "maximize" | "restore";
export type WindowRecord = { title: string; minimized: boolean };

export interface WindowRegistryState {
  order: string[];
  windows: Record<string, WindowRecord>;
  command: { id: string; kind: WindowCommand; nonce: number } | null;
}

export const EMPTY_WINDOW_REGISTRY: WindowRegistryState = { order: [], windows: {}, command: null };

export type WindowRegistryAction =
  | { type: "register"; id: string; title: string }
  | { type: "release"; id: string }
  | { type: "focus"; id: string }
  | { type: "minimize"; id: string; value: boolean }
  | { type: "command"; id: string; kind: WindowCommand };

function focus(state: WindowRegistryState, id: string): WindowRegistryState {
  const order = state.order[state.order.length - 1] === id ? state.order : [...state.order.filter((item) => item !== id), id];
  // Fokus selalu memunculkan kembali jendela yang dikecilkan (klik ikon dock).
  const windows = state.windows[id]?.minimized
    ? { ...state.windows, [id]: { ...state.windows[id], minimized: false } }
    : state.windows;
  return order === state.order && windows === state.windows ? state : { ...state, order, windows };
}

export function windowRegistryReducer(state: WindowRegistryState, action: WindowRegistryAction): WindowRegistryState {
  switch (action.type) {
    case "register":
      return focus(
        {
          ...state,
          windows: {
            ...state.windows,
            [action.id]: { title: action.title, minimized: state.windows[action.id]?.minimized ?? false },
          },
        },
        action.id
      );
    case "release": {
      if (!state.order.includes(action.id) && !(action.id in state.windows)) return state;
      const windows = { ...state.windows };
      delete windows[action.id];
      return { ...state, order: state.order.filter((item) => item !== action.id), windows };
    }
    case "focus":
      return focus(state, action.id);
    case "minimize": {
      const record = state.windows[action.id];
      if (!record) return state;
      const windows = { ...state.windows, [action.id]: { ...record, minimized: action.value } };
      // Dikecilkan = tidak lagi paling depan; jendela di bawahnya mengambil alih.
      const order =
        action.value && state.order[state.order.length - 1] === action.id
          ? [action.id, ...state.order.filter((item) => item !== action.id)]
          : state.order;
      return { ...state, windows, order };
    }
    case "command":
      return { ...state, command: { id: action.id, kind: action.kind, nonce: (state.command?.nonce ?? 0) + 1 } };
  }
}

/** Jendela yang terlihat (tidak dikecilkan), urut dari belakang ke depan. */
export function visibleWindowOrder(state: WindowRegistryState): string[] {
  return state.order.filter((id) => state.windows[id] && !state.windows[id].minimized);
}

/** Jendela paling depan yang benar-benar terlihat. */
export function topWindowId(state: WindowRegistryState): string | null {
  return visibleWindowOrder(state).at(-1) ?? null;
}
