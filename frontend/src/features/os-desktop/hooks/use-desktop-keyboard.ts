"use client";

import { useEffect } from "react";
import { matchDesktopShortcut, nextWindowInCycle } from "@/lib/desktop/window-manager";
import type { PanelAction } from "../lib/panels";
import type { WindowApi } from "./use-window-manager";

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean((target as HTMLElement | null)?.isContentEditable);
}

/**
 * Pintasan papan ketik ala desktop. Kombinasi yang dirampas browser
 * (⌘W/⌘M/⌘Tab) sengaja dihindari; lihat matchDesktopShortcut.
 */
export function useDesktopKeyboard({
  dispatch,
  todayOpen,
  commandOpen,
  contextMenuOpen,
  closeContextMenu,
  openAssistantShortcut,
  windowApi: api,
  topWindowId: top,
  visibleOrder,
}: {
  dispatch: (action: PanelAction) => void;
  todayOpen: boolean;
  commandOpen: boolean;
  contextMenuOpen: boolean;
  closeContextMenu: () => void;
  openAssistantShortcut: () => void;
  windowApi: WindowApi;
  topWindowId: string | null;
  visibleOrder: string[];
}) {
  /* Lapisan capture: jalan lebih dulu dan juga saat fokus di kolom ketik
     (⌘K, ⌘⇧A, Escape menutup lapisan sementara). */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "open", panel: "command" });
      }
      if (event.metaKey && event.shiftKey && (event.key.toLowerCase() === "a" || event.code === "KeyA")) {
        event.preventDefault();
        event.stopPropagation();
        openAssistantShortcut();
      }
      if (event.key === "Escape") {
        dispatch({ type: "escape" });
        closeContextMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [dispatch, closeContextMenu, openAssistantShortcut]);

  /* Lapisan jendela: tutup/kecilkan/pindah/tempel jendela teratas. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchDesktopShortcut(event);
      if (!action) return;
      // Saat mengetik hanya Escape yang boleh lewat.
      if (isTyping(event.target) && action !== "dismiss") return;

      switch (action) {
        case "search":
          event.preventDefault();
          dispatch({ type: "open", panel: "command" });
          return;
        case "today":
          event.preventDefault();
          dispatch({ type: "toggle", panel: "today" });
          return;
        case "lock":
          event.preventDefault();
          dispatch({ type: "open", panel: "locked" });
          return;
        case "dismiss":
          // Urutan tutup: panel Hari Ini → menu konteks → palet → jendela.
          if (todayOpen) dispatch({ type: "close", panel: "today" });
          else if (contextMenuOpen) closeContextMenu();
          else if (commandOpen) dispatch({ type: "close", panel: "command" });
          else if (top) api.closeById(top);
          return;
        case "close-window":
          if (!top) return;
          event.preventDefault();
          api.closeById(top);
          return;
        case "minimize-window":
          if (!top) return;
          event.preventDefault();
          api.setMinimized(top, true);
          return;
        case "cycle-next":
        case "cycle-prev": {
          const next = nextWindowInCycle(visibleOrder, top, action === "cycle-next" ? 1 : -1);
          if (!next) return;
          event.preventDefault();
          api.focus(next);
          return;
        }
        default:
          if (!top) return;
          event.preventDefault();
          api.send(top, action);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, top, visibleOrder, dispatch, todayOpen, commandOpen, contextMenuOpen, closeContextMenu]);
}
