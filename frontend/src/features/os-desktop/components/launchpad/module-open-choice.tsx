"use client";

import { ChevronRight, ExternalLink, MonitorDot, X } from "lucide-react";
import type { ComponentType } from "react";
import { brandOsName } from "@/lib/branding";
import type { DesktopModule } from "../../lib/modules";

function ChoiceButton({
  icon: Icon,
  title,
  description,
  onClick,
  primary = false,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
        primary
          ? "border-pink-300/30 bg-pink-500/16 hover:border-pink-200/50 hover:bg-pink-500/24"
          : "border-white/12 bg-white/8 hover:border-white/24 hover:bg-white/12"
      }`}
    >
      <div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${primary ? "bg-accent text-accent-foreground shadow-lg" : "bg-white/12 text-white"}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs leading-5 text-white/55">{description}</div>
      </div>
      <ChevronRight className="size-4 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
    </button>
  );
}

/** Modul dibuka sebagai jendela di desktop atau di tab browser baru. */
export function ModuleOpenChoice({
  module,
  isLoggedIn,
  onClose,
  onOpenInside,
  onOpenNewTab,
}: {
  module: DesktopModule;
  isLoggedIn: boolean;
  onClose: () => void;
  onOpenInside: () => void;
  onOpenNewTab: () => void;
}) {
  const Icon = module.icon;
  const brandOs = brandOsName();

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xl" onClick={onClose}>
      <div
        className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-[28px] border border-white/18 bg-slate-950/88 shadow-[0_28px_90px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-5">
          <div className="flex items-center gap-4">
            <div className="relative grid size-14 place-items-center rounded-2xl border border-white/25 bg-white/12">
              <div className="absolute inset-1 rounded-[18px] bg-accent text-accent-foreground" />
              <Icon className="relative size-7 text-accent-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{module.name}</h2>
              <p className="text-xs text-white/50">{isLoggedIn ? module.subtitle : "Login required"}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/18 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <ChoiceButton primary icon={MonitorDot} title={`Buka di ${brandOs}`} description={`Module tampil sebagai window di desktop ${brandOs}.`} onClick={onOpenInside} />
          <ChoiceButton icon={ExternalLink} title="Open New Tab" description="Module dibuka di tab browser baru." onClick={onOpenNewTab} />
        </div>
      </div>
    </div>
  );
}
