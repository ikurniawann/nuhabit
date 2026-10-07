'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api-client';
import { todayWib } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { EmploymentStatus } from '@/types/hris';

interface PromoteCandidateButtonProps {
  candidate: {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string;
    status: string;
    promoted_to_employee_id?: string | null;
    position?: { title?: string } | null;
  };
  onSuccess?: () => void;
}

export function PromoteCandidateButton({ candidate, onSuccess }: PromoteCandidateButtonProps) {
  const [open, setOpen] = useState(false);
  const [joinDate, setJoinDate] = useState(todayWib);
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>('probation');
  const promote = useMutation({
    mutationFn: () =>
      apiPost<{ nip?: string; contract_number?: string | null }>('/api/hris/promote', {
        candidate_id: candidate.id,
        join_date: joinDate,
        employment_status: employmentStatus,
      }),
    retry: false,
  });
  const loading = promote.isPending;

  const handlePromote = () => {
    promote.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`Berhasil mempromosikan ${candidate.full_name} menjadi karyawan!`, {
          description:
            `NIP: ${result.nip}` +
            (result.contract_number
              ? `. Draft kontrak ${result.contract_number} dibuat otomatis — cek tab Kontrak.`
              : ''),
        });
        setOpen(false);
        onSuccess?.();
      },
      onError: (error) => toast.error(error.message || 'Gagal mempromosikan kandidat'),
    });
  };

  // Don't show button if already promoted
  if (candidate.promoted_to_employee_id) {
    return (
      <Button variant="outline" disabled>
        ✓ Sudah Jadi Karyawan
      </Button>
    );
  }

  // Don't show button if status not eligible
  if (!['hired', 'talent_pool'].includes(candidate.status)) {
    return null;
  }

  return (
    <>
      <Button
        variant="default"
        onClick={() => setOpen(true)}
        className="bg-green-600 hover:bg-green-700"
      >
        🎉 Promote to Employee
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote Kandidat Jadi Karyawan</DialogTitle>
            <DialogDescription>
              Promosikan {candidate.full_name} dari Talent Pool menjadi Employee.
              Data akan otomatis dipindahkan dan NIP akan digenerate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Candidate Info */}
            <div className="rounded-lg border p-4 bg-muted/50">
              <h4 className="font-semibold mb-2">Data Kandidat</h4>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Nama</dt>
                  <dd className="font-medium">{candidate.full_name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Posisi</dt>
                  <dd className="font-medium">{candidate.position?.title || '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{candidate.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Telepon</dt>
                  <dd className="font-medium">{candidate.phone}</dd>
                </div>
              </dl>
            </div>

            {/* Employment Details */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="joinDate">Tanggal Bergabung</Label>
                <Input
                  id="joinDate"
                  type="date"
                  value={joinDate}
                  onChange={(e) => setJoinDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="employmentStatus">Status Karyawan</Label>
                <Select
                  value={employmentStatus}
                  onValueChange={(value) => setEmploymentStatus(value as EmploymentStatus)}
                >
                  <SelectTrigger id="employmentStatus">
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="probation">Probation (Masa Percobaan)</SelectItem>
                    <SelectItem value="contract">Kontrak</SelectItem>
                    <SelectItem value="permanent">Tetap</SelectItem>
                    <SelectItem value="internship">Magang</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              ℹ️ NIP akan digenerate otomatis (format: EMP-YYYY-XXXXX)
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Batal
            </Button>
            <Button
              onClick={handlePromote}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700"
            >
              {loading ? 'Memproses...' : '✓ Promote Sekarang'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
