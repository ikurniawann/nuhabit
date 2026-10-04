"use client";

// Inspired by sonner toast implementation
// Simple toast hook for HRIS components

import { useState, useEffect, useCallback } from "react";

interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

interface UseToastReturn {
  toast: (props: Omit<Toast, "id">) => void;
  toasts: Toast[];
  dismiss: (id: string) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(({ title, description, variant = "default" }: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = { id, title, description, variant };
    
    setToasts((prev) => [...prev, newToast]);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toast, toasts, dismiss };
}

// Global toast context (optional, for advanced usage)
const globalToastFn: ((props: Omit<Toast, "id">) => void) | null = null;

export const toast = (props: Omit<Toast, "id">) => {
  if (globalToastFn) {
    globalToastFn(props);
  } else {
    console.log("Toast:", props);
  }
};
