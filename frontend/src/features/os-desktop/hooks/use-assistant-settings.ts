"use client";

import { useState } from "react";
import {
  DEFAULT_AI_ASSISTANT_SETTINGS,
  resolveAiAssistantModel,
  resolveAiAssistantScope,
  type AiAssistantSettings,
} from "@/lib/ai-assistant-config";
import { STORAGE_KEYS, readStorage, writeStorage } from "@/lib/storage-keys";

function readAssistantSettings(): AiAssistantSettings {
  const raw = readStorage(STORAGE_KEYS.aiSettings);
  if (!raw) return DEFAULT_AI_ASSISTANT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<AiAssistantSettings>;
    return { model: resolveAiAssistantModel(parsed.model), scope: resolveAiAssistantScope(parsed.scope) };
  } catch {
    return DEFAULT_AI_ASSISTANT_SETTINGS;
  }
}

/** Model & konteks Do, tersimpan per browser. */
export function useAssistantSettings(): [AiAssistantSettings, (next: Partial<AiAssistantSettings>) => void] {
  const [settings, setSettings] = useState(readAssistantSettings);
  const update = (next: Partial<AiAssistantSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    writeStorage(STORAGE_KEYS.aiSettings, JSON.stringify(merged));
  };
  return [settings, update];
}
