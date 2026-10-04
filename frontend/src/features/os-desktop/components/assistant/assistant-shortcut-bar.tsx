"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Bot, ChevronDown, Send } from "lucide-react";

/**
 * Bilah tanya cepat (⌘⇧A) di atas dock. Klik di luar bilah menutupnya;
 * kirim membuka jendela Do dengan pertanyaan itu.
 */
export function AssistantShortcutBar({
  inputRef,
  value,
  onChange,
  onSubmit,
  onNewChat,
  onDismiss,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onNewChat: () => void;
  onDismiss: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !formRef.current?.contains(event.target)) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [onDismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[92px]">
      <div className="arkiv-assistant-shortcut-glow absolute bottom-[46px] h-36 w-[min(920px,calc(100vw-24px))] rounded-[48px] bg-gradient-to-r from-pink-300/18 via-pink-200/24 to-pink-400/18 blur-3xl" />
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit();
        }}
        className="arkiv-assistant-shortcut-shell pointer-events-auto relative flex w-[min(720px,calc(100vw-32px))] items-center gap-3 rounded-[24px] border border-white/22 bg-white/12 px-4 py-3 shadow-[0_26px_90px_rgba(0,0,0,.48)] backdrop-blur-2xl focus-within:border-pink-200/55"
      >
        <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <Bot className="size-5" />
        </div>
        <label className="relative flex min-w-0 flex-1 cursor-text items-center">
          <span className="pointer-events-none min-w-0 truncate text-[15px] font-medium text-white">{value || "What can I help you with today?"}</span>
          {focused && <span className="ml-0.5 h-6 w-0.5 shrink-0 animate-pulse rounded-full bg-pink-300" />}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Tanya Do"
            className="arkiv-assistant-shortcut-input absolute inset-0 h-full w-full cursor-text appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
          />
        </label>
        <button
          type="button"
          className="hidden shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white/55 transition hover:bg-white/8 sm:flex"
          onClick={onNewChat}
        >
          New Chat
          <ChevronDown className="size-3.5" />
        </button>
        <button
          type="submit"
          disabled={!value.trim()}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-lg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
          title="Buka Do"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
