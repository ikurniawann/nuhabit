"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Loader2, Plus, Upload, FileText, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Brand } from "@/types";
import type { CandidateSource } from "@/lib/recruitment/candidate-query";
import { extractCvFields } from "../api";
import { useCreateCandidate } from "../mutations";

interface AddFormValues {
  full_name: string;
  email: string;
  phone: string;
  domicile: string;
  source: CandidateSource;
  brand_id?: string;
  status: "applied" | "screening";
  notes?: string;
  last_experience?: string;
  last_education?: string;
  availability?: "immediate" | "1_week" | "2_weeks" | "1_month";
  expected_salary?: string;
}

const SOURCE_OPTIONS: [CandidateSource, string][] = [
  ["walk_in", "Walk-in"],
  ["referral", "Rekomendasi"],
  ["internal_referral", "Referral Internal"],
  ["jobfair", "Job Fair"],
  ["headhunter", "Headhunter"],
  ["portal", "Portal"],
  ["instagram", "Instagram"],
  ["jobstreet", "JobStreet"],
  ["other", "Lainnya"],
];

const OCR_FIELDS = ["full_name", "email", "phone", "domicile", "last_experience", "last_education", "notes"] as const;
const VALIDATED_FIELDS = new Set(["full_name", "email", "phone", "domicile"]);

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-red-500">{message}</p> : null;
}

/** Dialog tambah kandidat manual; dirender hanya saat terbuka supaya state selalu bersih. */
export function AddCandidateDialog({ brands, onClose }: { brands: Brand[]; onClose: () => void }) {
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrEmpty, setOcrEmpty] = useState(false);
  const cvFileRef = useRef<HTMLInputElement>(null);
  const form = useForm<AddFormValues>({ defaultValues: { status: "applied", source: "walk_in" } });
  const { errors, isSubmitting } = form.formState;
  const createMutation = useCreateCandidate();

  // OCR CV via OpenAI: isi otomatis Nama, Email, No HP, Domisili, dst.
  const ocr = useMutation({
    mutationFn: extractCvFields,
    onMutate: () => setOcrEmpty(false),
    onSuccess: (fields) => {
      for (const key of OCR_FIELDS) {
        const value = fields[key];
        if (value) form.setValue(key, value, { shouldValidate: VALIDATED_FIELDS.has(key) });
      }
      setOcrEmpty(!OCR_FIELDS.some((key) => fields[key]));
    },
  });
  const ocrError = ocr.error?.message ?? (ocrEmpty ? "Tidak ada data yang terbaca dari CV. Silakan isi manual." : null);
  const busy = createMutation.isPending || ocr.isPending;

  const handleCvFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvFile(file);
    ocr.reset();
    setOcrEmpty(false);
    if (ocrEnabled) ocr.mutate(file);
  };

  const handleOcrToggle = (checked: boolean) => {
    setOcrEnabled(checked);
    ocr.reset();
    setOcrEmpty(false);
    if (checked && cvFile) ocr.mutate(cvFile);
  };

  const handleSubmit = async (values: AddFormValues) => {
    try {
      await createMutation.mutateAsync({
        payload: {
          ...values,
          brand_id: values.brand_id || null,
          expected_salary: values.expected_salary ? parseInt(values.expected_salary, 10) : null,
        },
        cvFile,
      });
      onClose();
    } catch (error) {
      toast.error(`Gagal menyimpan: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[90vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Tambah Kandidat Manual</DialogTitle>
          <DialogDescription className="text-sm">Input kandidat dari walk-in, referral, dll.</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 mt-4">
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <Label className="text-xs font-medium">CV / Resume</Label>
            <input
              ref={cvFileRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={handleCvFileChange}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cvFileRef.current?.click()}
                disabled={busy}
                className="h-9 text-sm"
              >
                {cvFile ? <FileText className="w-4 h-4 mr-2 text-blue-600" /> : <Upload className="w-4 h-4 mr-2" />}
                {cvFile ? "Ganti File" : "Pilih File"}
              </Button>
              {cvFile && <span className="text-sm text-gray-600 truncate max-w-[200px]">{cvFile.name}</span>}
              <span className="text-xs text-gray-400">PDF, DOC, DOCX, JPG, PNG (max 10MB)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={ocrEnabled}
                onCheckedChange={(checked) => handleOcrToggle(checked === true)}
                disabled={ocr.isPending}
              />
              <span className="text-xs text-gray-700 flex items-center gap-1">
                <ScanText className="w-3.5 h-3.5 text-pink-600" />
                Isi otomatis dari CV (OCR AI) — Nama, Email, No. HP, Domisili, Pengalaman, Pendidikan & Catatan
              </span>
            </label>
            {ocr.isPending && (
              <p className="text-xs text-blue-600 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Membaca CV dengan AI...
              </p>
            )}
            {ocrError && <p className="text-xs text-red-500">{ocrError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Nama Lengkap <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="Nama lengkap"
                {...form.register("full_name", { required: "Nama lengkap wajib diisi" })}
                className="h-9 text-sm"
              />
              <FieldError message={errors.full_name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                type="email"
                placeholder="email@contoh.com"
                {...form.register("email", {
                  required: "Email wajib diisi",
                  pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: "Email tidak valid" },
                })}
                className="h-9 text-sm"
              />
              <FieldError message={errors.email?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                No. WhatsApp <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="081234567890"
                {...form.register("phone", { required: "No. WhatsApp wajib diisi" })}
                className="h-9 text-sm"
              />
              <FieldError message={errors.phone?.message} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Domisili <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="Kota"
                {...form.register("domicile", { required: "Domisili wajib diisi" })}
                className="h-9 text-sm"
              />
              <FieldError message={errors.domicile?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Outlet / Brand</Label>
              <Controller
                name="brand_id"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={brands.find((b) => b.id === field.value)?.name ?? "Pilih Outlet"} />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Sumber</Label>
              <Controller
                name="source"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Pilih Sumber" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Status Awal</Label>
            <Controller
              name="status"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-9 text-sm w-[180px]">
                    <SelectValue placeholder="Pilih Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="applied">Applied</SelectItem>
                    <SelectItem value="screening">Screening</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Catatan</Label>
            <Textarea
              placeholder="Catatan internal (opsional)"
              rows={3}
              {...form.register("notes")}
              className="text-sm resize-none"
            />
          </div>

          <div className="border-t border-gray-200 pt-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Informasi Tambahan</h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pengalaman Kerja Terakhir</Label>
                <Input
                  placeholder="PT Company - Position (2 tahun)"
                  {...form.register("last_experience")}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pendidikan Terakhir</Label>
                <Input
                  placeholder="S1/D3/SMA - Jurusan - Universitas/Sekolah"
                  {...form.register("last_education")}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status Ketersediaan</Label>
                <Controller
                  name="availability"
                  control={form.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Pilih ketersediaan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Secepatnya</SelectItem>
                        <SelectItem value="1_week">1 Minggu</SelectItem>
                        <SelectItem value="2_weeks">2 Minggu</SelectItem>
                        <SelectItem value="1_month">1 Bulan</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Ekspektasi Gaji (Rp)</Label>
                <Input
                  type="number"
                  placeholder="5000000"
                  {...form.register("expected_salary")}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting || busy} className="bg-pink-600 hover:bg-pink-700">
              {isSubmitting || createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
