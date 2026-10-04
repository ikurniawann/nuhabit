"use client";

import Image from "next/image";
import { useState } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import {
  AI_ASSISTANT_MODELS,
  AI_ASSISTANT_SCOPES,
  resolveAiAssistantModel,
  type AiAssistantSettings,
} from "@/lib/ai-assistant-config";

function LlmModelLogo({ model }: { model: (typeof AI_ASSISTANT_MODELS)[number] }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/12 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,.34)]">
      {model.logoSrc ? (
        <Image src={model.logoSrc} alt={`${model.label} logo`} width={28} height={28} className="size-6 object-contain" />
      ) : (
        <span className={`grid h-full w-full place-items-center bg-gradient-to-br ${model.logoClassName} text-[10px] font-black`}>{model.logo}</span>
      )}
    </span>
  );
}

/** Kartu Do di System Settings: konteks data dan model LLM. */
export function AssistantModelSettings({
  settings,
  onChange,
}: {
  settings: AiAssistantSettings;
  onChange: (next: Partial<AiAssistantSettings>) => void;
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const activeModel = AI_ASSISTANT_MODELS.find((model) => model.id === settings.model) ?? AI_ASSISTANT_MODELS[0];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground"><Bot className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Do</div>
          <div className="truncate text-xs leading-5 text-white/45">{settings.model}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/40">Context</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {AI_ASSISTANT_SCOPES.map((scope) => (
            <button
              key={scope.id}
              onClick={() => onChange({ scope: scope.id })}
              className={`min-h-11 rounded-2xl border px-3 py-2 text-center text-xs font-semibold transition ${settings.scope === scope.id ? "border-pink-300/60 bg-pink-500/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14)]" : "border-white/10 bg-black/15 text-white/60 hover:bg-white/10"}`}
              title={scope.description}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">LLM Model</div>
        <button
          type="button"
          onClick={() => setShowModelMenu((value) => !value)}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/12 bg-zinc-950/45 px-3 py-3 text-left text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_32px_rgba(0,0,0,.24)] outline-none transition hover:border-white/20 hover:bg-zinc-900/60 active:bg-zinc-950/80 focus-visible:bg-zinc-950/70 focus-visible:ring-2 focus-visible:ring-white/16"
          aria-haspopup="listbox"
          aria-expanded={showModelMenu}
        >
          <LlmModelLogo model={activeModel} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{activeModel.label}</div>
            <div className="truncate text-[11px] text-white/55">{activeModel.description}</div>
          </div>
          <ChevronDown className={`size-4 text-white/55 transition ${showModelMenu ? "rotate-180" : ""}`} />
        </button>

        {showModelMenu && (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[90] overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/95 p-1.5 text-white shadow-[0_24px_70px_rgba(0,0,0,.46)] backdrop-blur-2xl ring-1 ring-black/30" role="listbox" data-arkiv-ai-listbox="true">
            {AI_ASSISTANT_MODELS.map((model) => {
              const selected = settings.model === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange({ model: resolveAiAssistantModel(model.id) });
                    setShowModelMenu(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition active:bg-zinc-800/80 focus-visible:bg-zinc-800/70 focus-visible:outline-none ${selected ? "bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" : "text-white/72 hover:bg-white/[0.08] hover:text-white"}`}
                  role="option"
                  aria-selected={selected}
                >
                  <LlmModelLogo model={model} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{model.label}</span>
                    <span className="block truncate text-[11px] text-white/52">{model.description}</span>
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-white/75" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
