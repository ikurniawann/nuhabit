"use client";

// Fase E — Gelang Karyawan: pairing gelang NFC ↔ karyawan HRIS untuk
// akses gate GRATIS. Pengaturan sengaja di modul Ticketing (bukan profil
// karyawan): gelang = aset venue, wewenang pairing di ops venue.

import { useState } from "react";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import {
  useEmployeeOptions,
  usePairStaffPass,
  useRevokeStaffPass,
  useStaffPasses,
} from "../queries";

export function StaffPassesSection() {
  const [q, setQ] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const [uid, setUid] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  const passesQuery = useStaffPasses(q);
  const passes = passesQuery.data ?? [];
  const employeesQuery = useEmployeeOptions(employeeSearch);
  const employees = employeesQuery.data ?? [];

  const pairMutation = usePairStaffPass(() => {
    setUid("");
    setEmployeeSearch("");
    setEmployeeId("");
    setPairOpen(false);
  });
  const revokeMutation = useRevokeStaffPass();

  const handlePair = () => {
    if (!uid.trim() || !employeeId || pairMutation.isPending) return;
    pairMutation.mutate({ nfc_uid: uid.trim(), employee_id: employeeId });
  };

  return (
    <PurchasingListSection
      icon={UserGroupIcon}
      title="Gelang Karyawan (Free Access)"
      description="Karyawan pemegang gelang masuk gate gratis tanpa charge — bebas keluar-masuk. Karyawan nonaktif otomatis ditolak di gate."
      toolbar={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Cari nama / NIP / UID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-48"
          />
          <Button size="sm" onClick={() => setPairOpen(true)}>
            Pasangkan Gelang
          </Button>
        </div>
      }
    >
      {passesQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat gelang karyawan...</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">Karyawan</th>
                <th className="px-4 py-3 text-left font-semibold">Gelang</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {passes.map((pass) => (
                <TableRow key={pass.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{pass.full_name}</p>
                    <p className="text-xs text-gray-500">{pass.nip || "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-700">
                      {pass.nfc_uid}
                    </span>
                    {pass.band_label ? (
                      <p className="text-xs text-gray-400">{pass.band_label}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {pass.employee_active ? (
                      <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                        Aktif
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-red-100 font-normal text-red-700">
                        Karyawan nonaktif — cabut pairing
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeMutation.mutate(pass.id)}
                        disabled={revokeMutation.isPending}
                        className="h-8 px-3 text-gray-600 hover:bg-red-50 hover:text-red-600"
                      >
                        Cabut
                      </Button>
                    </div>
                  </td>
                </TableRow>
              ))}
              {passes.length === 0 ? (
                <TableRow>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                    Belum ada gelang karyawan — klik “Pasangkan Gelang”, tap
                    gelang tersedia, lalu pilih karyawan.
                  </td>
                </TableRow>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pasangkan Gelang ke Karyawan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff_uid">UID Gelang *</Label>
              <Input
                id="staff_uid"
                autoFocus
                placeholder="Fokuskan kursor lalu tap gelang di reader"
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                Gelang harus terdaftar di registry dan berstatus tersedia
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff_employee">Karyawan *</Label>
              <Input
                id="staff_employee"
                placeholder="Ketik nama / NIP untuk mencari…"
                value={employeeSearch}
                onChange={(e) => {
                  setEmployeeSearch(e.target.value);
                  setEmployeeId("");
                }}
              />
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200/70 p-1">
                {employeesQuery.isLoading ? (
                  <p className="px-2 py-3 text-center text-xs text-gray-400">
                    Memuat karyawan…
                  </p>
                ) : employees.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-gray-400">
                    Tidak ada karyawan aktif yang cocok
                  </p>
                ) : (
                  employees.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => setEmployeeId(employee.id)}
                      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                        employeeId === employee.id
                          ? "bg-pink-50 font-medium text-pink-700"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {employee.full_name}
                      {employee.nip ? (
                        <span className="ml-1.5 text-xs text-gray-400">
                          {employee.nip}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPairOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handlePair}
              disabled={!uid.trim() || !employeeId || pairMutation.isPending}
            >
              {pairMutation.isPending ? "Memasangkan…" : "Pasangkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PurchasingListSection>
  );
}
