"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTalentPool, useActiveBrands } from "../queries";
import { useUpdateCandidateStatus, useSendCandidateNotification } from "../mutations";
import type { TalentPoolCandidate } from "../types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StarIcon,
  PhoneIcon,
  VideoCameraIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

function getDaysAgo(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function CandidateRow({
  candidate,
  onAction,
}: {
  candidate: TalentPoolCandidate;
  onAction: (action: string, c: TalentPoolCandidate) => void;
}) {
  const daysAgo = getDaysAgo(candidate.last_contacted_at);
  const needsContact = daysAgo > 30;
  const isHot = daysAgo <= 14 && daysAgo !== Infinity;

  return (
    <Card className="hover:shadow-md transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 truncate">{candidate.full_name}</h3>
              <Badge className="bg-yellow-100 text-yellow-700 text-xs">Pool</Badge>
              {needsContact && (
                <Badge className="bg-orange-100 text-orange-700 text-xs">Perlu Dihubungi</Badge>
              )}
              {isHot && !needsContact && (
                <Badge className="bg-green-100 text-green-700 text-xs">Hangat</Badge>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {candidate.positions?.title || "Tanpa Posisi"} ·{" "}
              {candidate.brands?.name || "Semua Outlet"}
            </p>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
              <span>{candidate.phone}</span>
              <span>·</span>
              <span>{candidate.domicile}</span>
              <span>·</span>
              <span>Di pool {getDaysAgo(candidate.created_at)} hari</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-200 hover:bg-green-50"
              onClick={() => onAction("whatsapp", candidate)}
            >
              <PhoneIcon className="w-4 h-4 mr-1" /> WA
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={() => onAction("interview", candidate)}
            >
              <VideoCameraIcon className="w-4 h-4 mr-1" /> Jadwalkan
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-purple-600 border-purple-200 hover:bg-purple-50"
              onClick={() => onAction("activate", candidate)}
            >
              <ArrowsRightLeftIcon className="w-4 h-4 mr-1" /> Aktifkan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAction("view", candidate)}
            >
              Detail
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => onAction("archive", candidate)}
            >
              <ArchiveBoxIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TalentPoolPage() {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [selectedCandidate, setSelectedCandidate] = useState<TalentPoolCandidate | null>(null);
  const [actionDialog, setActionDialog] = useState<string | null>(null);
  const [whatsappMsg, setWhatsappMsg] = useState("");

  const { data: rawCandidates, isLoading: loading, refetch } = useTalentPool(selectedBrand);
  const { data: brandsData } = useActiveBrands();
  const brands = brandsData ?? [];

  const updateStatusMutation = useUpdateCandidateStatus();
  const sendNotificationMutation = useSendCandidateNotification();
  const saving = updateStatusMutation.isPending || sendNotificationMutation.isPending;

  const candidates = useMemo(() => {
    let results = [...(rawCandidates ?? [])];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          c.phone.includes(search) ||
          c.email.toLowerCase().includes(q)
      );
    }
    results.sort((a, b) => {
      const aHot = getDaysAgo(a.last_contacted_at) <= 14;
      const bHot = getDaysAgo(b.last_contacted_at) <= 14;
      if (aHot && !bHot) return -1;
      if (!aHot && bHot) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return results;
  }, [rawCandidates, search]);

  function handleAction(action: string, candidate: TalentPoolCandidate) {
    setSelectedCandidate(candidate);
    if (action === "view" || action === "interview") {
      router.push(`/dashboard/hris/candidates/${candidate.id}`);
    } else if (action === "whatsapp") {
      setWhatsappMsg(
        `Halo ${candidate.full_name}! Kami dari Tim Rekrutmen ingin mengupdate status lamaran Anda.`
      );
      setActionDialog("whatsapp");
    } else if (action === "activate") {
      setActionDialog("activate");
    } else if (action === "archive") {
      setActionDialog("archive");
    }
  }

  async function handleConfirmAction() {
    if (!selectedCandidate) return;
    try {
      if (actionDialog === "activate") {
        await updateStatusMutation.mutateAsync({ id: selectedCandidate.id, status: "applied" });
      } else if (actionDialog === "archive") {
        await updateStatusMutation.mutateAsync({ id: selectedCandidate.id, status: "archived" });
      } else if (actionDialog === "whatsapp") {
        await sendNotificationMutation.mutateAsync({
          candidate_id: selectedCandidate.id,
          channel: "whatsapp",
          message: whatsappMsg,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aksi gagal");
    } finally {
      setActionDialog(null);
      setSelectedCandidate(null);
    }
  }

  const needsContactCount = candidates.filter((c) => getDaysAgo(c.last_contacted_at) > 30).length;
  const hotCount = candidates.filter(
    (c) => getDaysAgo(c.last_contacted_at) <= 14 && getDaysAgo(c.last_contacted_at) !== Infinity
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Talent Pool</h1>
          <p className="text-gray-500 text-sm mt-1">
            {candidates.length} kandidat potensial
            {needsContactCount > 0 && ` · ${needsContactCount} perlu dihubungi`}
            {hotCount > 0 && ` · ${hotCount} hangat`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Cari nama, telepon, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refetch()}
            className="pl-9"
          />
        </div>
        <Select value={selectedBrand} onValueChange={(v) => setSelectedBrand(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue
              placeholder={brands.find((b) => b.id === selectedBrand)?.name ?? "Semua Outlet"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Outlet</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-20">
          <StarIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Belum ada kandidat di Talent Pool</p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <CandidateRow key={c.id} candidate={c} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* WhatsApp Dialog */}
      <Dialog open={actionDialog === "whatsapp"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kirim WhatsApp</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Ke: <span className="font-medium">{selectedCandidate?.full_name}</span>
          </p>
          <textarea
            className="w-full border border-gray-300 rounded-lg p-3 text-sm"
            rows={4}
            value={whatsappMsg}
            onChange={(e) => setWhatsappMsg(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              Batal
            </Button>
            <Button onClick={handleConfirmAction} disabled={saving}>
              {saving ? "Mengirim..." : "Kirim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate / Archive Confirm Dialog */}
      <Dialog open={actionDialog === "activate" || actionDialog === "archive"} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog === "activate" ? "Aktifkan Kandidat" : "Arsipkan Kandidat"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            {actionDialog === "activate"
              ? `Kandidat "${selectedCandidate?.full_name}" akan dikembalikan ke stage "Baru"?`
              : `Arsipkan kandidat "${selectedCandidate?.full_name}"? Kandidat keluar dari talent pool tanpa ditolak.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              Batal
            </Button>
            <Button
              variant={actionDialog === "archive" ? "destructive" : "default"}
              onClick={handleConfirmAction}
              disabled={saving}
            >
              {saving ? "Memproses..." : actionDialog === "activate" ? "Aktifkan" : "Arsipkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
