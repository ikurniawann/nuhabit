"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  DsButton,
  DsCard,
  DsCardContent,
  DsCardDescription,
  DsCardHeader,
  DsCardTitle,
  DsDataTable,
  DsDateTimePicker,
  DsDropdownSearch,
  DsTextbox,
} from "@/components/design-system";

const dropdownOptions = [
  { value: "hr", label: "Human Resources" },
  { value: "finance", label: "Finance" },
  { value: "ops", label: "Operations" },
];

const tableRows = [
  { id: "1", name: "Budi Santoso", role: "Admin", status: "Aktif" },
  { id: "2", name: "Siti Aminah", role: "HRD", status: "Aktif" },
  { id: "3", name: "Andi Wijaya", role: "Staff", status: "Nonaktif" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <DsCard>
      <DsCardHeader>
        <DsCardTitle>{title}</DsCardTitle>
        {description ? <DsCardDescription>{description}</DsCardDescription> : null}
      </DsCardHeader>
      <DsCardContent>{children}</DsCardContent>
    </DsCard>
  );
}

export function DesignSystemShowcase() {
  const [text, setText] = useState("BCD Coffee OS");
  const [dept, setDept] = useState("hr");
  const [joinedAt, setJoinedAt] = useState("2026-06-24 09:00");
  const [page, setPage] = useState(1);

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Design System</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preview komponen global — import dari{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">@/components/design-system</code>
        </p>
      </div>

      <Section title="DsButton" description="Ukuran: xs, md (default), lg">
        <div className="flex flex-wrap items-center gap-3">
          <DsButton size="xs" variant="outline">
            XS Outline
          </DsButton>
          <DsButton size="md">MD Primary</DsButton>
          <DsButton size="lg" className="bg-pink-600 hover:bg-pink-700">
            LG Pink
          </DsButton>
          <DsButton size="md" loading>
            Loading
          </DsButton>
          <DsButton size="md" variant="destructive">
            Destructive
          </DsButton>
        </div>
      </Section>

      <Section title="DsTextbox" description="Label, hint, error, icon">
        <div className="grid max-w-xl gap-4">
          <DsTextbox
            label="Nama lengkap"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ketik nama..."
            hint="Contoh field dengan hint"
          />
          <DsTextbox
            label="Cari"
            leftIcon={<MagnifyingGlassIcon className="h-4 w-4" />}
            placeholder="Cari karyawan..."
          />
          <DsTextbox label="Email" error="Format email tidak valid" placeholder="email@perusahaan.com" />
        </div>
      </Section>

      <Section title="DsDropdownSearch" description="Dropdown dengan pencarian">
        <div className="max-w-md">
          <DsDropdownSearch
            label="Departemen"
            options={dropdownOptions}
            value={dept}
            onChange={setDept}
            placeholder="Pilih departemen..."
            allowClear
          />
        </div>
      </Section>

      <Section title="DsDateTimePicker" description="Tanggal + waktu (locale ID)">
        <div className="grid max-w-md gap-4">
          <DsDateTimePicker
            label="Tanggal & waktu join"
            value={joinedAt}
            onChange={setJoinedAt}
          />
          <DsDateTimePicker label="Tanggal saja" dateOnly value="2026-06-24" onChange={() => {}} />
        </div>
      </Section>

      <Section title="DsCard" description="Wrapper card standar list/detail">
        <DsCard className="max-w-md">
          <DsCardHeader>
            <DsCardTitle>Contoh Card</DsCardTitle>
            <DsCardDescription>Border lembut, padding konsisten</DsCardDescription>
          </DsCardHeader>
          <DsCardContent>
            <p className="text-sm text-gray-600">Isi card bisa berupa form, info, atau tabel.</p>
          </DsCardContent>
        </DsCard>
      </Section>

      <DsDataTable
        title="DsDataTable"
        description="Tabel generik dengan pagination"
        columns={[
          { id: "name", header: "Nama", cell: (row) => row.name },
          { id: "role", header: "Role", cell: (row) => row.role },
          {
            id: "status",
            header: "Status",
            align: "center",
            cell: (row) => (
              <span
                className={
                  row.status === "Aktif"
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                }
              >
                {row.status}
              </span>
            ),
          },
          {
            id: "actions",
            header: "Aksi",
            align: "right",
            cell: () => (
              <DsButton size="xs" variant="outline">
                Edit
              </DsButton>
            ),
          },
        ]}
        data={tableRows}
        rowKey={(row) => row.id}
        pagination={{
          page,
          totalPages: 3,
          totalItems: tableRows.length * 3,
          pageSize: 3,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
