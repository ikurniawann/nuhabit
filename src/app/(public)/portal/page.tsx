"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Upload, X, CheckCircle, Phone, Mail, MapPin, Briefcase, ArrowUp } from "lucide-react";

// Validation schema
const formSchema = z.object({
  full_name: z.string().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  email: z.string().email("Format email tidak valid"),
  phone: z
    .string()
    .min(9, "Nomor terlalu pendek")
    .regex(/^(\+62|62|0)[0-9]{9,12}$/, "Format nomor WA tidak valid (contoh: 081234567890)"),
  domicile: z.string().min(2, "Domisili harus diisi").max(100, "Maksimal 100 karakter"),
  source: z.enum(["portal", "instagram", "jobstreet", "referral", "walk_in", "other"]),
  position_id: z.string().optional(),
  brand_id: z.string().optional(),
  notes: z.string().max(1000, "Catatan maksimal 1000 karakter").optional(),
  // New fields
  last_experience: z.string().max(200, "Maksimal 200 karakter").optional(),
  last_education: z.string().max(200, "Maksimal 200 karakter").optional(),
  availability: z.enum(["immediate", "1_week", "2_weeks", "1_month"]).optional(),
  expected_salary: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;
type PortalSource = FormValues["source"];

const logoUrl = "/brand/logo-forest.png";

export default function PortalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [positions, setPositions] = useState<{ id: string; title: string }[]>([]);
  const [jobOpeningId, setJobOpeningId] = useState<string | null>(null);
  const [isBrandReadOnly, setIsBrandReadOnly] = useState(false);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [salaryInput, setSalaryInput] = useState<string>("");

  // File states
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvPreview, setCvPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      source: "portal",
    },
  });

  const selectedBrand = watch("brand_id");

  // Format salary as IDR currency
  const formatSalary = (value: string) => {
    const numericValue = value.replace(/\D/g, "");
    if (!numericValue) return "";
    return "Rp " + new Intl.NumberFormat("id-ID").format(parseInt(numericValue, 10));
  };

  const handleSalaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    setSalaryInput(rawValue);
    setValue("expected_salary", rawValue);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const brandId = params.get("brand_id");
    const positionId = params.get("position_id");
    const openingId = params.get("job_opening_id");

    if (openingId) setJobOpeningId(openingId);
    if (brandId) setValue("brand_id", brandId);
    if (positionId) setValue("position_id", positionId);

    if (openingId) setIsBrandReadOnly(true);

    // Outlet (Business level Branch), posisi, dan auto-fill dari job opening
    // lewat satu endpoint publik (browser client butuh auth, portal tidak).
    let cancelled = false;
    (async () => {
      setPositionsLoading(true);
      try {
        const qs = openingId ? `?opening=${encodeURIComponent(openingId)}` : "";
        const res = await fetch(`/api/portal/options${qs}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          console.error("[Portal] Gagal memuat opsi:", json.error);
          return;
        }
        setBrands(json.data.outlets ?? []);
        setPositions(json.data.positions ?? []);
        const opening = json.data.opening;
        if (opening) {
          if (opening.brand_id && !brandId) setValue("brand_id", opening.brand_id);
          if (opening.position_id && !positionId) setValue("position_id", opening.position_id);
        }
      } catch (err) {
        if (!cancelled) console.error("[Portal] Gagal memuat opsi:", err);
      } finally {
        if (!cancelled) setPositionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setValue]);

  // File handlers
  const handleCvChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!validTypes.includes(file.type)) {
      setFileError("CV harus format PDF atau DOC");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFileError("CV maksimal 2MB");
      return;
    }

    setCvFile(file);
    setCvPreview(null);
    setFileError(null);
  }, []);

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setFileError("Foto harus format JPG/PNG");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFileError("Foto maksimal 2MB");
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setFileError(null);
  }, []);

  const removeCv = () => {
    setCvFile(null);
    setCvPreview(null);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
  };

  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    setSubmitError(null);

    try {
      const submitFormData = new FormData();
      submitFormData.append("full_name", data.full_name);
      submitFormData.append("email", data.email);
      submitFormData.append("phone", data.phone);
      submitFormData.append("domicile", data.domicile);
      submitFormData.append("source", data.source);
      if (data.position_id) submitFormData.append("position_id", data.position_id);
      if (data.brand_id) submitFormData.append("brand_id", data.brand_id);
      if (data.notes) submitFormData.append("notes", data.notes);
      if (jobOpeningId) submitFormData.append("job_opening_id", jobOpeningId);
      if (cvFile) submitFormData.append("cv", cvFile);
      if (photoFile) submitFormData.append("photo", photoFile);
      // New fields
      if (data.last_experience) submitFormData.append("last_experience", data.last_experience);
      if (data.last_education) submitFormData.append("last_education", data.last_education);
      if (data.availability) submitFormData.append("availability", data.availability);
      if (data.expected_salary) submitFormData.append("expected_salary", data.expected_salary);

      const res = await fetch("/api/portal/submit", {
        method: "POST",
        body: submitFormData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Terjadi kesalahan");
      }

      setSuccess(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Gagal mengirim lamaran");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="top" className="min-h-screen bg-[#f8f9fa] text-[#191c1d] career-roundo">
      <nav className="fixed top-0 z-50 w-full border-b border-[#bdc8e4] bg-[#f8f9fa]/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link href="/career" className="flex h-full items-center" aria-label="BCD Coffee careers">
            <img src={logoUrl} alt="NüHabit" className="h-full w-auto object-contain" />
          </Link>
          <Link
            href="/career"
            className="rounded-full bg-[#1d1dcc] px-6 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#3d5edc] active:scale-95"
          >
            Back to Careers
          </Link>
        </div>
      </nav>

      <main className="overflow-x-hidden pb-20 pt-36 sm:pt-40">
        <section className="mx-auto mb-10 max-w-[700px] px-4 text-center sm:px-6 lg:px-10">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#edeeef] text-[#1d1dcc]">
            <Briefcase className="h-5 w-5" />
          </div>
          <h1 className="mb-3 text-2xl font-semibold leading-tight sm:text-3xl">
            Submit Your Application
          </h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-[#40485c]">
            Isi formulir di bawah untuk melamar posisi yang tersedia.
          </p>
        </section>

        <section className="mx-auto max-w-[700px] px-4 sm:px-6 lg:px-10">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Personal Info */}
            <div className="rounded-lg border border-[#bdc8e4] bg-white p-5 sm:p-6">
              <h2 className="mb-4 text-base font-medium leading-tight">Informasi Diri</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Brand */}
                <div className="space-y-1.5">
                  <label htmlFor="brand_id" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Outlet / Brand
                  </label>
                  <select
                    id="brand_id"
                    value={watch("brand_id") || ""}
                    onChange={(e) => setValue("brand_id", e.target.value || undefined)}
                    disabled={isBrandReadOnly}
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{isBrandReadOnly ? "Auto-selected" : "Pilih Outlet (opsional)"}</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Position */}
                <div className="space-y-1.5">
                  <label htmlFor="position_id" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Posisi yang Dilamar
                  </label>
                  <select
                    id="position_id"
                    value={watch("position_id") || ""}
                    onChange={(e) => setValue("position_id", e.target.value || undefined)}
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {positionsLoading ? "Loading positions..." : (positions.length > 0 ? "Pilih Posisi" : "No positions available")}
                    </option>
                    {positions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  {positionsLoading && (
                    <p className="text-xs text-[#40485c]">Loading positions from database...</p>
                  )}
                  {!positionsLoading && positions.length === 0 && (
                    <p className="text-xs text-[#1d1dcc]">No active positions found in database</p>
                  )}
                </div>

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label htmlFor="full_name" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Nama Lengkap <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <input
                    id="full_name"
                    placeholder="Nama lengkap"
                    {...register("full_name")}
                    className={`flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.full_name ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
                  />
                  {errors.full_name && (
                    <p className="text-xs text-[#1d1dcc]">{errors.full_name.message}</p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Email <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#40485c]" />
                    <input
                      id="email"
                      type="email"
                      placeholder="email@contoh.com"
                      {...register("email")}
                      className={`flex h-10 w-full rounded-md border bg-transparent pl-9 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.email ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-[#1d1dcc]">{errors.email.message}</p>
                  )}
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label htmlFor="phone" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    No. WhatsApp <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#40485c]" />
                    <input
                      id="phone"
                      type="tel"
                      placeholder="081234567890"
                      {...register("phone")}
                      className={`flex h-10 w-full rounded-md border bg-transparent pl-9 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.phone ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
                    />
                  </div>
                  {errors.phone && (
                    <p className="text-xs text-[#1d1dcc]">{errors.phone.message}</p>
                  )}
                </div>

                {/* Domicile */}
                <div className="space-y-1.5">
                  <label htmlFor="domicile" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Domisili <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#40485c]" />
                    <input
                      id="domicile"
                      placeholder="Jakarta Selatan"
                      {...register("domicile")}
                      className={`flex h-10 w-full rounded-md border bg-transparent pl-9 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.domicile ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
                    />
                  </div>
                  {errors.domicile && (
                    <p className="text-xs text-[#1d1dcc]">{errors.domicile.message}</p>
                  )}
                </div>

                {/* Source */}
                <div className="space-y-1.5">
                  <label htmlFor="source" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Sumber Info <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <select
                    id="source"
                    value={watch("source") || "portal"}
                    onChange={(e) => setValue("source", e.target.value as PortalSource)}
                    className={`flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.source ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
                  >
                    <option value="portal">Website</option>
                    <option value="instagram">Instagram</option>
                    <option value="jobstreet">JobStreet</option>
                    <option value="referral">Referral</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="other">Lainnya</option>
                  </select>
                  {errors.source && (
                    <p className="text-xs text-[#1d1dcc]">{errors.source.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Additional Profile Info */}
            <div className="rounded-lg border border-[#bdc8e4] bg-white p-5 sm:p-6">
              <h2 className="mb-4 text-base font-medium leading-tight">Informasi Tambahan</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Last Experience */}
                <div className="space-y-1.5">
                  <label htmlFor="last_experience" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Pengalaman Kerja Terakhir
                  </label>
                  <input
                    id="last_experience"
                    placeholder="PT Company - Position (2 tahun)"
                    {...register("last_experience")}
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {errors.last_experience && (
                    <p className="text-xs text-[#1d1dcc]">{errors.last_experience.message}</p>
                  )}
                </div>

                {/* Last Education */}
                <div className="space-y-1.5">
                  <label htmlFor="last_education" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Pendidikan Terakhir
                  </label>
                  <input
                    id="last_education"
                    placeholder="S1/D3/SMA - Jurusan - Universitas"
                    {...register("last_education")}
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {errors.last_education && (
                    <p className="text-xs text-[#1d1dcc]">{errors.last_education.message}</p>
                  )}
                </div>

                {/* Availability */}
                <div className="space-y-1.5">
                  <label htmlFor="availability" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Ketersediaan Bergabung
                  </label>
                  <select
                    id="availability"
                    value={watch("availability") || ""}
                    onChange={(e) => setValue("availability", (e.target.value || undefined) as FormValues["availability"])}
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Pilih ketersediaan</option>
                    <option value="immediate">Secepatnya</option>
                    <option value="1_week">1 Minggu</option>
                    <option value="2_weeks">2 Minggu</option>
                    <option value="1_month">1 Bulan</option>
                  </select>
                </div>

                {/* Expected Salary */}
                <div className="space-y-1.5">
                  <label htmlFor="expected_salary" className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Ekspektasi Gaji (Rp)
                  </label>
                  <input
                    id="expected_salary"
                    type="text"
                    inputMode="numeric"
                    value={formatSalary(salaryInput)}
                    onChange={handleSalaryChange}
                    placeholder="Rp 0"
                    className="flex h-10 w-full rounded-md border border-[#bdc8e4] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* File Upload */}
            <div className="rounded-lg border border-[#bdc8e4] bg-white p-5 sm:p-6">
              <h2 className="mb-4 text-base font-medium leading-tight">Upload Dokumen</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* CV Upload */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    CV <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <span className="text-xs text-[#40485c]">PDF/DOC, maks 2MB</span>

                  {cvFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-[#bdc8e4] bg-[#f8f9fa] p-4">
                      <Upload className="h-5 w-5 shrink-0 text-[#1d1dcc]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#191c1d]">{cvFile.name}</p>
                        <p className="text-xs text-[#40485c]">
                          {(cvFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeCv}
                        className="rounded p-1 transition-colors hover:bg-[#bdc8e4]"
                      >
                        <X className="h-4 w-4 text-[#1d1dcc]" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#bdc8e4] p-6 transition-colors hover:border-[#1d1dcc] hover:bg-[#edeeef]">
                      <Upload className="h-5 w-5 text-[#40485c]" />
                      <span className="text-xs font-medium text-[#191c1d]">Upload CV</span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="hidden"
                        onChange={handleCvChange}
                      />
                    </label>
                  )}
                </div>

                {/* Photo Upload */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-[#40485c]">
                    Pas Foto <span className="text-[#1d1dcc]">*</span>
                  </label>
                  <span className="text-xs text-[#40485c]">JPG/PNG, maks 2MB</span>

                  {photoFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-[#bdc8e4] bg-[#f8f9fa] p-4">
                      {photoPreview && (
                        <img
                          src={photoPreview}
                          alt="Preview"
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#191c1d]">{photoFile.name}</p>
                        <p className="text-xs text-[#40485c]">
                          {(photoFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="rounded p-1 transition-colors hover:bg-[#bdc8e4]"
                      >
                        <X className="h-4 w-4 text-[#1d1dcc]" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#bdc8e4] p-6 transition-colors hover:border-[#1d1dcc] hover:bg-[#edeeef]">
                      <Upload className="h-5 w-5 text-[#40485c]" />
                      <span className="text-xs font-medium text-[#191c1d]">Upload Foto</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handlePhotoChange}
                      />
                    </label>
                  )}
                </div>

                {fileError && (
                  <div className="rounded-lg border border-[#1d1dcc] bg-[#e2eafd] p-4 text-sm text-[#1d1dcc]">
                    {fileError}
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-lg border border-[#bdc8e4] bg-white p-5 sm:p-6">
              <h2 className="mb-4 text-base font-medium leading-tight">Catatan (Opsional)</h2>
              <textarea
                placeholder="Info tambahan..."
                rows={3}
                {...register("notes")}
                className={`min-h-[100px] w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1d1dcc] disabled:cursor-not-allowed disabled:opacity-50 ${errors.notes ? "border-[#1d1dcc]" : "border-[#bdc8e4]"}`}
              />
              {errors.notes && (
                <p className="mt-1 text-xs text-[#1d1dcc]">{errors.notes.message}</p>
              )}
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="rounded-lg border border-[#1d1dcc] bg-[#e2eafd] p-4 text-sm text-[#1d1dcc]">
                {submitError}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !cvFile || !photoFile}
              className="w-full rounded-full bg-[#1d1dcc] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-all hover:bg-[#3d5edc] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Mengirim...
                </>
              ) : (
                "Kirim Lamaran"
              )}
            </button>

            {!cvFile && (
              <p className="-mt-3 text-center text-xs text-[#40485c]">
                * Wajib upload CV untuk mengirim lamaran
              </p>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-[#40485c]">
            Dengan mengirim lamaran, kamu menyetujui kebijakan privasi BCD Coffee
          </p>
        </section>
      </main>

      <footer className="w-full border-t border-[#bdc8e4] bg-[#f8f9fa] py-12">
        <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-2 lg:px-10">
          <div className="space-y-4">
            <div className="flex h-10 items-center">
              <img src={logoUrl} alt="NüHabit" className="h-full w-auto object-contain" />
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-[#40485c]">
              Designing emotional experiences at the intersection of technology, art, and service.
            </p>
            <p className="text-sm text-[#40485c]">© 2026 BCD Coffee. All rights reserved.</p>
          </div>
          <div className="flex flex-col justify-between gap-6 md:items-end">
            <div className="flex flex-wrap gap-4">
              {["LinkedIn", "Instagram", "Vimeo", "Privacy Policy", "Terms"].map((item) => (
                <a key={item} href="#" className="text-sm text-[#40485c] transition-colors hover:text-[#1d1dcc]">
                  {item}
                </a>
              ))}
            </div>
            <Link href="#top" className="group flex items-center gap-1 text-[#40485c]">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] transition-colors group-hover:text-[#1d1dcc]">
                Back to top
              </span>
              <ArrowUp className="h-3 w-3 text-[#1d1dcc]" />
            </Link>
          </div>
        </div>
      </footer>

      {/* Success Modal */}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-[#191c1d]/60 backdrop-blur-sm transition-opacity"
            onClick={() => {
              setSuccess(false);
              router.push("/career");
            }}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-lg animate-in fade-in zoom-in duration-300">
            <div className="overflow-hidden rounded-2xl bg-white p-8 shadow-2xl">
              {/* Icon */}
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#edeeef]">
                  <CheckCircle className="h-10 w-10 text-[#1d1dcc]" />
                </div>
              </div>

              {/* Title */}
              <h2 className="mb-3 text-center text-2xl font-semibold leading-tight text-[#191c1d]">
                Lamaran Terkirim!
              </h2>

              {/* Message */}
              <p className="mb-8 text-center text-base leading-relaxed text-[#40485c]">
                Terima kasih sudah melamar. Tim HRD kami akan menghubungi kamu
                melalui WhatsApp atau email dalam 1-3 hari kerja.
              </p>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <Link
                  href="/career"
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1d1dcc] px-8 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-all hover:bg-[#3d5edc] active:scale-95"
                >
                  Kembali ke Career Page
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setSuccess(false);
                    router.push("/career");
                  }}
                  className="w-full rounded-full border border-[#bdc8e4] bg-transparent px-8 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#191c1d] transition-all hover:bg-[#edeeef]"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
