"use client";

import { useState } from "react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUGGESTED_MENU_ACTIONS } from "@/lib/iam/types";
import { cn } from "@/lib/utils";

function normalizeAction(raw: string): string | null {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");

  return value.length > 0 ? value : null;
}

interface PermissionActionPickerProps {
  value: string[];
  onChange: (actions: string[]) => void;
}

export function PermissionActionPicker({
  value,
  onChange,
}: PermissionActionPickerProps) {
  const [customInput, setCustomInput] = useState("");
  const [inputError, setInputError] = useState("");

  const suggestedSet = new Set<string>(SUGGESTED_MENU_ACTIONS);
  const customActions = value.filter((action) => !suggestedSet.has(action));

  function setActions(next: string[]) {
    onChange(next.length > 0 ? next : ["read"]);
  }

  function toggleSuggested(action: string) {
    if (value.includes(action)) {
      setActions(value.filter((item) => item !== action));
      return;
    }
    setActions([...value, action]);
  }

  function removeAction(action: string) {
    setActions(value.filter((item) => item !== action));
  }

  function addCustomAction() {
    const normalized = normalizeAction(customInput);

    if (!normalized) {
      setInputError("Enter a valid action name.");
      return;
    }

    if (value.includes(normalized)) {
      setInputError(`"${normalized}" is already selected.`);
      return;
    }

    setActions([...value, normalized]);
    setCustomInput("");
    setInputError("");
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Selected
        </p>
        {value.length === 0 ? (
          <p className="text-xs text-gray-400">No actions selected.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {value.map((action) => (
              <span
                key={action}
                className="inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50 py-1 pl-2.5 pr-1.5 text-xs font-medium capitalize text-pink-700"
              >
                {action}
                <button
                  type="button"
                  onClick={() => removeAction(action)}
                  className="rounded-full p-0.5 text-pink-500 hover:bg-pink-100 hover:text-pink-700"
                  aria-label={`Remove ${action}`}
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Suggested
        </p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_MENU_ACTIONS.map((action) => {
            const selected = value.includes(action);
            return (
              <button
                key={action}
                type="button"
                onClick={() => toggleSuggested(action)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  selected
                    ? "border-pink-200 bg-pink-50 text-pink-700"
                    : "border-gray-200/70 bg-gray-50/80 text-gray-600 hover:border-gray-300 hover:bg-gray-100",
                )}
              >
                {action}
              </button>
            );
          })}
        </div>
      </div>

      {customActions.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Custom
          </p>
          <div className="flex flex-wrap gap-2">
            {customActions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => removeAction(action)}
                className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium capitalize text-violet-700 hover:bg-violet-100"
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Add Custom Action
        </p>
        <div className="flex gap-2">
          <Input
            value={customInput}
            onChange={(event) => {
              setCustomInput(event.target.value);
              if (inputError) setInputError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomAction();
              }
            }}
            placeholder="e.g. approval, import, reconcile"
            className="h-9 bg-white text-sm"
          />
          <Button
            type="button"
            variant="outline"
            onClick={addCustomAction}
            className="h-9 shrink-0 gap-1.5"
          >
            <PlusIcon className="h-4 w-4" />
            Add
          </Button>
        </div>
        {inputError ? (
          <p className="mt-1.5 text-xs text-red-500">{inputError}</p>
        ) : (
          <p className="mt-1.5 text-xs text-gray-500">
            Use lowercase letters, numbers, hyphens, or underscores. Spaces
            become hyphens.
          </p>
        )}
      </div>
    </div>
  );
}
