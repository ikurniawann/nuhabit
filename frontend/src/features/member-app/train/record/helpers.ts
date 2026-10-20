import type { ActivityType } from "../../lib/queries-train";

/** Resize an image file to a small JPEG data URL (stored with the activity). */
export function resizeImageToDataUrl(
  file: File,
  maxDim: number,
  quality = 0.7,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not read that image."));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

export function defaultTitle(type: ActivityType): string {
  const hour = new Date().getHours();
  const daypart =
    hour < 11
      ? "Morning"
      : hour < 15
        ? "Lunch"
        : hour < 19
          ? "Evening"
          : "Night";
  const noun = { RUN: "Run", RIDE: "Ride", WALK: "Walk", WORKOUT: "Workout" }[
    type
  ];
  return `${daypart} ${noun}`;
}
