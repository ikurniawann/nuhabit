/* eslint-disable @next/next/no-img-element -- blob: preview is local, next/image does not support it */
"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Upload, X } from "lucide-react";
import { FormSection } from "./form-field";
import type { ApplicationFiles } from "./use-application-files";

const LABEL = "text-xs font-bold uppercase tracking-[0.12em] text-[#2a332e]";
const sizeMb = (file: File) => `${(file.size / 1024 / 1024).toFixed(2)} MB`;

function SelectedFile({ file, preview, onRemove }: { file: File; preview?: ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#e3dbcc] bg-white p-4">
      {preview}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#131a1c]">{file.name}</p>
        <p className="text-xs text-[#2a332e]">{sizeMb(file)}</p>
      </div>
      <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="rounded p-1 transition-colors hover:bg-[#e3dbcc]">
        <X className="h-4 w-4 text-[#00281a]" />
      </button>
    </div>
  );
}

function DropZone({ label, accept, onChange }: { label: string; accept: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#e3dbcc] p-6 transition-colors hover:border-[#00281a] hover:bg-[#f7f9f7]">
      <Upload className="h-5 w-5 text-[#2a332e]" />
      <span className="text-xs font-medium text-[#131a1c]">{label}</span>
      <input type="file" accept={accept} className="hidden" onChange={onChange} />
    </label>
  );
}

/** Upload a CV (PDF/DOC) and a photo (JPG/PNG/WebP), each up to 2MB. */
export function DocumentSection({ files }: { files: ApplicationFiles }) {
  return (
    <FormSection title="Documents">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL}>
            CV <span className="text-[#00281a]">*</span>
          </label>
          <span className="text-xs text-[#2a332e]">PDF/DOC, up to 2MB</span>
          {files.cvFile ? (
            <SelectedFile
              file={files.cvFile}
              preview={<Upload className="h-5 w-5 shrink-0 text-[#00281a]" />}
              onRemove={files.removeCv}
            />
          ) : (
            <DropZone
              label="Upload CV"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={files.onCvChange}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className={LABEL}>
            Photo <span className="text-[#00281a]">*</span>
          </label>
          <span className="text-xs text-[#2a332e]">JPG/PNG, up to 2MB</span>
          {files.photoFile ? (
            <SelectedFile
              file={files.photoFile}
              preview={
                files.photoPreview && (
                  <img src={files.photoPreview} alt="Preview" className="h-12 w-12 rounded object-cover" />
                )
              }
              onRemove={files.removePhoto}
            />
          ) : (
            <DropZone label="Upload Photo" accept="image/jpeg,image/png,image/webp" onChange={files.onPhotoChange} />
          )}
        </div>

        {files.fileError && (
          <div className="rounded-lg border border-[#00281a] bg-[#eeffb1] p-4 text-sm text-[#00281a]">
            {files.fileError}
          </div>
        )}
      </div>
    </FormSection>
  );
}
