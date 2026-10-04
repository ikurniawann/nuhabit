"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  slugify,
  withDepartment,
  withPosition,
  withTitle,
  type JobForm,
  type JobStatus,
} from "@/lib/recruitment/job-portal-form";
import { useJobBrands, useJobDepartments, useJobPositions } from "../queries";

const SELECT_CLASS = "h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm";

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

/** Dialog tambah/edit lowongan; state form di-reset tiap kali dialog dipasang. */
export function JobOpeningDialog({
  initial, saving, onCancel, onSave,
}: {
  initial: JobForm;
  saving: boolean;
  onCancel: () => void;
  onSave: (form: JobForm) => void;
}) {
  const [form, setForm] = useState(initial);
  const { data: brands = [] } = useJobBrands();
  const { data: positions = [] } = useJobPositions();
  const { data: departments = [] } = useJobDepartments();

  function updateField<K extends keyof JobForm>(key: K, value: JobForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {form.id ? "Edit Lowongan" : "Tambah Lowongan"}
          </h2>
          <p className="text-sm text-gray-500">Data published akan tampil di halaman /career.</p>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <FormField label="Master Posisi">
            <select
              value={form.position_id}
              onChange={(event) => setForm((current) => withPosition(current, event.target.value, positions, departments))}
              className={SELECT_CLASS}
            >
              <option value="">Pilih posisi</option>
              {positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.title}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Brand / Outlet">
            <select
              value={form.brand_id}
              onChange={(event) => updateField("brand_id", event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Semua brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Judul Lowongan">
            <Input
              value={form.title}
              onChange={(event) => {
                const title = event.target.value;
                setForm((current) => withTitle(current, title));
              }}
            />
          </FormField>

          <FormField label="Slug">
            <Input value={form.slug} onChange={(event) => updateField("slug", slugify(event.target.value))} />
          </FormField>

          <FormField label="Department">
            <select
              value={form.department_id}
              onChange={(event) => {
                const departmentId = event.target.value;
                setForm((current) => withDepartment(current, departmentId, departments));
              }}
              className={SELECT_CLASS}
            >
              <option value="">Pilih department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Lokasi">
            <Input value={form.location} onChange={(event) => updateField("location", event.target.value)} />
          </FormField>

          <FormField label="Employment Type">
            <select
              value={form.employment_type}
              onChange={(event) => updateField("employment_type", event.target.value)}
              className={SELECT_CLASS}
            >
              <option>Full-time</option>
              <option>Part-time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </FormField>

          <FormField label="Work Mode">
            <select
              value={form.work_mode}
              onChange={(event) => updateField("work_mode", event.target.value)}
              className={SELECT_CLASS}
            >
              <option>On-site</option>
              <option>Hybrid</option>
              <option>Remote</option>
            </select>
          </FormField>

          <FormField label="Headcount">
            <Input
              type="number"
              min={1}
              value={form.headcount}
              onChange={(event) => updateField("headcount", Number(event.target.value || 1))}
            />
          </FormField>

          <FormField label="Status">
            <select
              value={form.status}
              onChange={(event) => updateField("status", event.target.value as JobStatus)}
              className={SELECT_CLASS}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </FormField>

          <FormField label="Closing Date">
            <Input
              type="date"
              value={form.closing_date}
              onChange={(event) => updateField("closing_date", event.target.value)}
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField label="Deskripsi">
              <Textarea
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
                rows={4}
              />
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField label="Requirements">
              <Textarea
                value={form.requirements}
                onChange={(event) => updateField("requirements", event.target.value)}
                rows={4}
              />
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField label="Benefits">
              <Textarea
                value={form.benefits}
                onChange={(event) => updateField("benefits", event.target.value)}
                rows={3}
              />
            </FormField>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Batal
          </Button>
          <Button onClick={() => onSave(form)} disabled={saving} className="bg-pink-600 text-white hover:bg-pink-700">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}
