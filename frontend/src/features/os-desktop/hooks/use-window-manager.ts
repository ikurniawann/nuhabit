"use client";

import { createContext, useContext, useMemo, useReducer, useRef } from "react";
import {
  EMPTY_WINDOW_REGISTRY,
  topWindowId,
  visibleWindowOrder,
  windowRegistryReducer,
  type WindowCommand,
  type WindowRegistryState,
} from "../lib/window-registry";

/**
 * Manajer jendela ala desktop sungguhan: urutan fokus, minimize ke dock,
 * snap ke tepi. Logika murninya di lib/window-registry dan
 * @/lib/desktop/window-manager (teruji); di sini hanya perekatan ke React.
 */

export type WindowApi = {
  register: (id: string, title: string, onClose: () => void) => void;
  release: (id: string) => void;
  focus: (id: string) => void;
  setMinimized: (id: string, value: boolean) => void;
  closeById: (id: string) => void;
  send: (id: string, kind: WindowCommand) => void;
};

export const WindowApiContext = createContext<WindowApi | null>(null);
export const WindowStateContext = createContext<WindowRegistryState>(EMPTY_WINDOW_REGISTRY);

export function useWindowApi() {
  return useContext(WindowApiContext);
}

export function useWindowState() {
  return useContext(WindowStateContext);
}

export function useWindowManager() {
  const [state, dispatch] = useReducer(windowRegistryReducer, EMPTY_WINDOW_REGISTRY);
  const closers = useRef<Record<string, () => void>>({});

  const api = useMemo<WindowApi>(
    () => ({
      register: (id, title, onClose) => {
        closers.current[id] = onClose;
        dispatch({ type: "register", id, title });
      },
      release: (id) => {
        delete closers.current[id];
        dispatch({ type: "release", id });
      },
      focus: (id) => dispatch({ type: "focus", id }),
      setMinimized: (id, value) => dispatch({ type: "minimize", id, value }),
      closeById: (id) => closers.current[id]?.(),
      send: (id, kind) => dispatch({ type: "command", id, kind }),
    }),
    []
  );

  const visibleOrder = useMemo(() => visibleWindowOrder(state), [state]);
  return { api, state, topWindowId: topWindowId(state), visibleOrder };
}
