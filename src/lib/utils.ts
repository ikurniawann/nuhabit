import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Tanpa ekstensi ini `rounded-card` dan `rounded-2xl` sama-sama lolos merge.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["card", "hero", "pill"],
      shadow: ["card", "float", "glow", "up"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
