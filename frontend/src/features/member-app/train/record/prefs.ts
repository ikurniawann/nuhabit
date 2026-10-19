import { useState, useSyncExternalStore } from "react";

/** Recording preferences survive reloads (localStorage, per browser). */
const prefGet = (key: string): boolean => {
  try {
    return localStorage.getItem(`hyrox.rec.${key}`) === "1";
  } catch {
    return false;
  }
};
const prefSet = (key: string, value: boolean) => {
  try {
    localStorage.setItem(`hyrox.rec.${key}`, value ? "1" : "0");
  } catch {
    /* private mode */
  }
};
const noSubscribe = () => () => {};

/** A saved toggle: false on the server, the stored value after hydration, persisted on change. */
export function usePref(key: string): [boolean, (next: boolean) => void] {
  const saved = useSyncExternalStore(
    noSubscribe,
    () => prefGet(key),
    () => false,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const set = (next: boolean) => {
    setOverride(next);
    prefSet(key, next);
  };
  return [override ?? saved, set];
}
