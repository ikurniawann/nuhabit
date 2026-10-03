"use client";

import { useState } from "react";
import { useSettingsBrands, useSettingsPositions } from "../queries";
import {
  useCreateSettingsBrand,
  useCreateSettingsPosition,
  useUpdateSettingsBrand,
  useUpdateSettingsPosition,
} from "../mutations";

export function SettingsPage() {
  const { data: brands = [], isLoading: loadingBrands } = useSettingsBrands();
  const { data: positions = [], isLoading: loadingPositions } = useSettingsPositions();
  const createBrandMutation = useCreateSettingsBrand();
  const updateBrandMutation = useUpdateSettingsBrand();
  const createPositionMutation = useCreateSettingsPosition();
  const updatePositionMutation = useUpdateSettingsPosition();

  const [msg, setMsg] = useState({ type: "", text: "" });
  const [brandForm, setBrandForm] = useState({ name: "", industry: "F&B" });
  const [posForm, setPosForm] = useState({
    brand_id: "",
    title: "",
    department: "Operations",
    level: "Staff",
  });

  const loading = loadingBrands || loadingPositions;
  const saving =
    createBrandMutation.isPending ||
    updateBrandMutation.isPending ||
    createPositionMutation.isPending ||
    updatePositionMutation.isPending;

  const showMsg = (type: string, text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: "", text: "" }), 3000);
  };

  const createBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createBrandMutation.mutateAsync(brandForm);
      showMsg("success", "Outlet berhasil ditambahkan");
      setBrandForm({ name: "", industry: "F&B" });
    } catch (error) {
      showMsg("error", error instanceof Error ? error.message : "Gagal menambahkan outlet");
    }
  };

  const createPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPositionMutation.mutateAsync(posForm);
      showMsg("success", "Posisi berhasil ditambahkan");
      setPosForm({ brand_id: "", title: "", department: "Operations", level: "Staff" });
    } catch (error) {
      showMsg("error", error instanceof Error ? error.message : "Gagal menambahkan posisi");
    }
  };

  const toggleBrand = async (id: string, is_active: boolean) => {
    try {
      await updateBrandMutation.mutateAsync({ id, payload: { is_active: !is_active } });
    } catch (error) {
      showMsg("error", error instanceof Error ? error.message : "Gagal memperbarui outlet");
    }
  };

  const togglePosition = async (
    position: { id: string; title: string; department: string; level: string; is_active: boolean; brand_id?: string | null }
  ) => {
    try {
      await updatePositionMutation.mutateAsync({
        id: position.id,
        payload: {
          title: position.title,
          department: position.department,
          level: position.level,
          is_active: !position.is_active,
          brand_id: position.brand_id ?? undefined,
        },
      });
    } catch (error) {
      showMsg("error", error instanceof Error ? error.message : "Gagal memperbarui posisi");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan</h1>
        <p className="text-gray-500 text-sm mt-1">
          Kelola outlet, posisi, dan konfigurasi sistem
        </p>
      </div>

      {msg.text && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            msg.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Outlet / Brand</h2>
          </div>
          <div className="p-6 space-y-4">
            <form onSubmit={createBrand} className="flex gap-2">
              <input
                type="text"
                value={brandForm.name}
                onChange={(e) => setBrandForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nama outlet"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <select
                value={brandForm.industry}
                onChange={(e) => setBrandForm((f) => ({ ...f, industry: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>F&B</option>
                <option>Retail</option>
                <option>Hospitality</option>
                <option>Lainnya</option>
              </select>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                +
              </button>
            </form>

            <div className="divide-y divide-gray-100">
              {brands.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{b.name}</p>
                    <p className="text-xs text-gray-500">{b.industry}</p>
                  </div>
                  <button
                    onClick={() => toggleBrand(b.id, b.is_active)}
                    disabled={updateBrandMutation.isPending}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      b.is_active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {b.is_active ? "Aktif" : "Nonaktif"}
                  </button>
                </div>
              ))}
              {brands.length === 0 && !loading && (
                <p className="text-sm text-gray-400 py-4 text-center">Belum ada outlet</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Posisi</h2>
          </div>
          <div className="p-6 space-y-4">
            <form onSubmit={createPosition} className="space-y-2">
              <select
                value={posForm.brand_id}
                onChange={(e) => setPosForm((f) => ({ ...f, brand_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Pilih Outlet</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={posForm.title}
                onChange={(e) => setPosForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Nama posisi (cth: Coach, Front Desk, Kasir)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <div className="flex gap-2">
                <select
                  value={posForm.department}
                  onChange={(e) => setPosForm((f) => ({ ...f, department: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>Operations</option>
                  <option>Kitchen</option>
                  <option>Front Office</option>
                  <option>Management</option>
                  <option>Admin</option>
                </select>
                <select
                  value={posForm.level}
                  onChange={(e) => setPosForm((f) => ({ ...f, level: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>Staff</option>
                  <option>Supervisor</option>
                  <option>Manager</option>
                  <option>Senior</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Tambah Posisi
              </button>
            </form>

            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {positions.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{p.title}</p>
                    <p className="text-xs text-gray-500">
                      {p.brands?.name ?? "Semua"} · {p.department} · {p.level}
                    </p>
                  </div>
                  <button
                    onClick={() => togglePosition(p)}
                    disabled={updatePositionMutation.isPending}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      p.is_active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {p.is_active ? "Aktif" : "Nonaktif"}
                  </button>
                </div>
              ))}
              {positions.length === 0 && !loading && (
                <p className="text-sm text-gray-400 py-4 text-center">Belum ada posisi</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
