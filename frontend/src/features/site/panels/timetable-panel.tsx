"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Placeholder: the timetable agent replaces this file with the live schedule. */
export default function TimetablePanel({ branchSlug, onClose }: { branchSlug?: string; onClose(): void }) {
  return (
    <div className="space-y-4 text-sm text-body">
      <p>
        Jadwal kelas{branchSlug ? ` cabang ${branchSlug}` : ""} segera tampil di sini. Sementara itu, lihat jadwal
        lengkap di Area Member.
      </p>
      <Button asChild variant="ink">
        <Link href="/member/classes">Buka jadwal di Area Member</Link>
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}
