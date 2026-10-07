"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, X, FileText } from "lucide-react";
import { uploadLeaveAttachment } from "../api";

const VALID_TYPES = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

interface LeaveAttachmentFieldProps {
  employeeId: string;
  /** Path lampiran tersimpan, atau "" saat dihapus/gagal. */
  onChange: (path: string) => void;
}

export function LeaveAttachmentField({ employeeId, onChange }: LeaveAttachmentFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const reset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    onChange("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!VALID_TYPES.includes(file.type)) {
      toast.error("Tipe File Tidak Valid: gunakan gambar JPG/PNG/WebP (foto dokumen)");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File Terlalu Besar: Ukuran file maksimal 5MB");
      return;
    }
    if (!employeeId) {
      toast.error("Pilih karyawan dulu sebelum meng-upload lampiran");
      return;
    }

    try {
      setUploading(true);
      setSelectedFile(file);
      const dataUrl = await readAsDataUrl(file);
      setPreviewUrl(dataUrl);
      onChange(await uploadLeaveAttachment(dataUrl, employeeId));
      toast.success(`Lampiran "${file.name}" tersimpan`);
    } catch (error) {
      reset();
      toast.error(
        error instanceof Error ? error.message : "Upload Gagal: Terjadi kesalahan saat upload file"
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Label>Lampiran (Opsional)</Label>
      {!selectedFile ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors mt-1">
          <input
            type="file"
            id="file-upload"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            {uploading ? (
              <>
                <Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin mb-2" />
                <p className="text-sm text-gray-500">Uploading...</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-1">Klik untuk upload atau drag & drop</p>
                <p className="text-xs text-gray-500">PDF, JPG, PNG (Max 5MB)</p>
              </>
            )}
          </label>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg p-4 mt-1">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt="Preview"
                  width={64}
                  height={64}
                  unoptimized
                  className="w-16 h-16 object-cover rounded"
                />
              ) : (
                <div className="w-16 h-16 bg-red-100 rounded flex items-center justify-center">
                  <FileText className="w-8 h-8 text-red-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-1">Upload surat dokter atau dokumen pendukung lainnya</p>
    </div>
  );
}
