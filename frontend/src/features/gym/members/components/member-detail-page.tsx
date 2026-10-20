"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Coins, ExternalLink, Pencil, Ticket, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { METHOD_LABELS, type CreditPurchase } from "@/features/gym/credits/api";
import { BOOKING_BADGE, entryLabel } from "@/features/gym/scheduling/api";
import { WaiverDeskForm } from "@/features/gym/scheduling/components/waiver-desk-form";
import { GATE_DENIAL_LABEL } from "@/lib/gym/booking";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { MEMBER_KEYS, membersApi, type Member360, type MemberBooking } from "../api";
import { MemberNotes } from "./member-notes";
import { ProfileDialog } from "./profile-dialog";

const TABS = [
  { value: "profil", label: "Profil" },
  { value: "membership", label: "Membership & kredit" },
  { value: "booking", label: "Booking" },
  { value: "checkin", label: "Check-in" },
  { value: "pembelian", label: "Pembelian" },
  { value: "catatan", label: "Catatan" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

const PURCHASE_STATUS: Record<CreditPurchase["status"], { label: string; variant: "success" | "info" | "muted" | "warning" }> = {
  paid: { label: "Lunas", variant: "success" },
  pending: { label: "Menunggu bayar", variant: "info" },
  failed: { label: "Gagal", variant: "muted" },
  expired: { label: "Kedaluwarsa", variant: "muted" },
  refunded: { label: "Direfund", variant: "warning" },
};

const GENDER_LABEL = { male: "Laki-laki", female: "Perempuan" } as const;

/** Gym → Member → profil 360: kontak, membership, kredit, booking, check-in, pembelian, catatan staf. */
export function MemberDetailPage({ customerId }: { customerId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === requested) ? (requested as TabValue) : "profil";
  const [editing, setEditing] = useState(false);
  const detail = useQuery({ queryKey: MEMBER_KEYS.detail(customerId), queryFn: () => membersApi.detail(customerId) });

  const back = (
    <Link href="/dashboard/gym/members" className={buttonVariants({ variant: "ghost", size: "sm" })}>
      <ArrowLeft /> Semua member
    </Link>
  );
  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <TableNote>Memuat profil member…</TableNote>
        </Card>
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <TableNote tone="danger">{detail.error?.message ?? "Member tidak ditemukan"}</TableNote>
        </Card>
      </div>
    );
  }
  const m = detail.data;
  const p = m.profile;
  const activePass = m.credits.passes.find((x) => x.status === "active");

  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        kicker="Member"
        title={p.name ?? "Tanpa nama"}
        description={[p.phone, p.member_code, p.email].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Ubah profil
            </Button>
            <Link href={`/dashboard/gym/credits?member=${p.id}`} className={buttonVariants({ variant: "outline" })}>
              <Coins /> Kelola kredit
            </Link>
            <Link href={`/dashboard/crm/members/${p.crm_member_id}`} className={buttonVariants({ variant: "ghost" })}>
              <ExternalLink /> Profil CRM
            </Link>
          </>
        }
      />
      {!p.is_active && <Badge variant="destructive">Member nonaktif</Badge>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saldo kredit" value={formatNumber(m.credits.balance)} unit="kredit" icon={<Ticket />} tone="ink" />
        <StatCard
          label="Pass aktif"
          value={activePass ? `${formatNumber(activePass.days_left)} hari` : "Tidak ada"}
          hint={activePass ? `${activePass.package_name}, s.d. ${formatDate(activePass.ends_at)}` : undefined}
          icon={<CalendarCheck />}
        />
        <StatCard label="Kelas dihadiri" value={formatNumber(m.attendance.attended)} icon={<CalendarCheck />} />
        <StatCard
          label="Tidak hadir & batal terlambat"
          value={formatNumber(m.attendance.no_show + m.attendance.late_cancel)}
          hint={`${formatNumber(m.attendance.no_show)} tidak hadir, ${formatNumber(m.attendance.late_cancel)} batal terlambat`}
          icon={<UserX />}
          tone={m.attendance.no_show ? "warning" : "default"}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "profil") next.delete("tab");
          else next.set("tab", String(value));
          const search = next.toString();
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        }}
        className="w-full flex-col"
      >
        <TabsList variant="line">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value === "catatan" && m.notes.length > 0 && ` (${m.notes.length})`}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="profil" className="mt-4">
          <ProfileTab member={m} />
        </TabsContent>
        <TabsContent value="membership" className="mt-4">
          <MembershipTab member={m} />
        </TabsContent>
        <TabsContent value="booking" className="mt-4 space-y-4">
          <BookingTable title="Booking mendatang" rows={m.upcoming_bookings} empty="Tidak ada booking mendatang." />
          <BookingTable title="Riwayat kelas" rows={m.past_bookings} empty="Belum pernah booking kelas." />
        </TabsContent>
        <TabsContent value="checkin" className="mt-4">
          <CheckinTable member={m} />
        </TabsContent>
        <TabsContent value="pembelian" className="mt-4">
          <PurchaseTable purchases={m.credits.purchases} />
        </TabsContent>
        <TabsContent value="catatan" className="mt-4">
          <MemberNotes customerId={p.id} notes={m.notes} />
        </TabsContent>
      </Tabs>

      {editing && <ProfileDialog profile={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

function ProfileTab({ member }: { member: Member360 }) {
  const queryClient = useQueryClient();
  const p = member.profile;
  const c = p.emergency_contact;
  const w = p.waiver;
  return (
    <Card className="px-5 py-2">
      <h2 className="sr-only">Profil dan kontak</h2>
      <dl className="divide-y divide-border">
        <Row label="Nama">{p.name ?? "-"}</Row>
        <Row label="Nomor HP">
          <span className="font-mono">{p.phone}</span>
        </Row>
        <Row label="Email">{p.email ?? "-"}</Row>
        <Row label="Tanggal lahir">{formatDate(p.birth_date)}</Row>
        <Row label="Jenis kelamin">{p.gender ? GENDER_LABEL[p.gender] : "-"}</Row>
        <Row label="Kontak darurat">{c ? `${c.name} (${c.relation}) · ${c.phone}` : "Belum diisi"}</Row>
        <Row label="Waiver">
          {w.current ? (
            <Badge variant="success">Disetujui versi {w.version} · {formatDate(w.accepted_at)}</Badge>
          ) : w.accepted_at ? (
            <Badge variant="warning">Versi lama {w.version}, perlu setuju versi {w.current_version}</Badge>
          ) : (
            <Badge variant="destructive">Belum disetujui</Badge>
          )}
          {!w.current && (
            <div className="mt-2 font-normal">
              <WaiverDeskForm
                customerId={member.profile.id}
                onRecorded={() => void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.detail(member.profile.id) })}
              />
            </div>
          )}
        </Row>
        <Row label="Tier">{p.membership_tier ?? "-"}</Row>
        <Row label="Bergabung">{formatDate(p.joined_at)}</Row>
      </dl>
    </Card>
  );
}

function MembershipTab({ member }: { member: Member360 }) {
  const { passes, lots } = member.credits;
  const liveLots = lots.filter((l) => l.remaining > 0 && !l.expired);
  return (
    <div className="space-y-4">
      <Card className="py-0">
        <h2 className="px-5 pt-4 text-sm font-semibold">Pass</h2>
        {passes.length === 0 ? (
          <TableNote>Belum pernah membeli pass.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pass</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passes.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.package_name}</TableCell>
                  <TableCell>
                    {formatDate(x.starts_at)} s.d. {formatDate(x.ends_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {x.status === "active" ? (
                      <Badge variant="success">Aktif · {formatNumber(x.days_left)} hari lagi</Badge>
                    ) : (
                      <Badge variant="muted">{x.status === "refunded" ? "Refund" : "Berakhir"}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Card className="py-0">
        <h2 className="px-5 pt-4 text-sm font-semibold">Lot kredit aktif</h2>
        {liveLots.length === 0 ? (
          <TableNote>Tidak ada kredit aktif.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sumber</TableHead>
                <TableHead className="text-right">Sisa</TableHead>
                <TableHead>Kedaluwarsa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveLots.map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell>{lot.package_name ?? "Bonus / penyesuaian"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(lot.remaining)} / {formatNumber(lot.credits)}
                  </TableCell>
                  <TableCell>{formatDate(lot.expires_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function BookingTable({ title, rows, empty }: { title: string; rows: MemberBooking[]; empty: string }) {
  return (
    <Card className="py-0">
      <h2 className="px-5 pt-4 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <TableNote>{empty}</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kelas</TableHead>
              <TableHead>Jadwal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Kredit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => {
              const badge = BOOKING_BADGE[b.status];
              return (
                <TableRow key={b.id}>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <Link href={`/dashboard/gym/sessions/${b.session_id}`} className="font-medium text-forest hover:underline">
                      {b.class_type_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{[b.coach_name, b.branch_name].filter(Boolean).join(" · ")}</p>
                  </TableCell>
                  <TableCell>{formatDateTime(b.starts_at)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Badge variant={badge.variant}>
                      {b.status === "waitlist" && b.waitlist_position ? `Waitlist #${b.waitlist_position}` : badge.label}
                    </Badge>
                    {b.late_cancel && <span className="ml-2 text-xs text-warning">batal terlambat</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(b.credit_cost)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function CheckinTable({ member }: { member: Member360 }) {
  const rows = member.checkins;
  return (
    <Card className="py-0">
      <h2 className="px-5 pt-4 text-sm font-semibold">Riwayat check-in</h2>
      {rows.length === 0 ? (
        <TableNote>Belum pernah scan di gate.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Kelas</TableHead>
              <TableHead>Hasil</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell>{formatDateTime(v.created_at)}</TableCell>
                <TableCell>{v.class_type_name ?? "-"}</TableCell>
                <TableCell className="whitespace-normal">
                  {v.decision === "allowed" ? (
                    <Badge variant="success">
                      {entryLabel(v.entry_kind, v.credit_delta)}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">{v.reason ? GATE_DENIAL_LABEL[v.reason] : "Ditolak"}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function PurchaseTable({ purchases }: { purchases: CreditPurchase[] }) {
  return (
    <Card className="py-0">
      <h2 className="px-5 pt-4 text-sm font-semibold">Pembelian paket & pass</h2>
      {purchases.length === 0 ? (
        <TableNote>Belum ada pembelian.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paket</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Pembayaran</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.map((x) => {
              const status = PURCHASE_STATUS[x.status];
              return (
                <TableRow key={x.id}>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <p className="font-medium">{x.package_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {x.kind === "pass" ? "Pass" : `${formatNumber(x.credits)} kredit`} ·{" "}
                      {x.channel === "member_portal" ? "Aplikasi member" : "Front desk"}
                    </p>
                  </TableCell>
                  <TableCell>{formatDate(x.paid_at ?? x.created_at)}</TableCell>
                  <TableCell>{x.payment_method ? METHOD_LABELS[x.payment_method] : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(x.total_idr)}</TableCell>
                  <TableCell>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
