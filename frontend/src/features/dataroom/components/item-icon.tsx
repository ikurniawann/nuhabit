"use client";

import {
  File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Presentation,
} from "lucide-react";
import { fileCategory } from "@/lib/dataroom/config";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  image: "text-rose-500", pdf: "text-red-600", doc: "text-blue-600", sheet: "text-emerald-600",
  slide: "text-orange-500", archive: "text-amber-600", video: "text-violet-600", audio: "text-cyan-600",
  text: "text-slate-500", other: "text-slate-400",
};

export function ItemIcon({ kind, mime, name, className }: { kind: "folder" | "file"; mime: string | null; name: string; className?: string }) {
  if (kind === "folder") return <Folder className={cn("text-amber-400 fill-amber-300/60", className)} />;
  const cat = fileCategory(mime, name);
  const Icon = {
    image: FileImage, pdf: FileText, doc: FileText, sheet: FileSpreadsheet, slide: Presentation,
    archive: FileArchive, video: FileVideo, audio: FileAudio, text: FileText, other: File,
  }[cat];
  return <Icon className={cn(COLORS[cat], className)} />;
}
