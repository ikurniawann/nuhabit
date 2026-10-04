"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const MENU = [
  { href: "/dashboard/hris/candidates", label: "👤 Kandidat", active: true },
  { href: "/dashboard/hris/pipeline", label: "📋 Pipeline" },
  { href: "/dashboard/hris/talent-pool", label: "⭐ Talent Pool" },
  { href: "/dashboard/employees", label: "💼 Staff" },
  { href: "/dashboard/hris/attendance", label: "📅 Absensi" },
  { href: "/dashboard/hris/leaves", label: "📄 Cuti & Izin" },
  { href: "/dashboard/employees", label: "👨‍👩‍‍👦 Karyawan" },
];

interface CandidatesMobileHeaderProps {
  totalCount: number;
  onExport: () => void;
  onAdd: () => void;
}

/** Header mobile halaman Kandidat dengan menu HRIS di sheet samping. */
export function CandidatesMobileHeader({ totalCount, onExport, onAdd }: CandidatesMobileHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="lg:hidden sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="lg:hidden p-2 hover:bg-gray-100 rounded-lg" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-lg">HRIS Menu</h2>
              </div>
              <nav className="p-4 space-y-2">
                {MENU.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`block px-4 py-2 text-sm font-medium rounded-lg ${
                      item.active ? "bg-green-50 text-green-700" : "hover:bg-gray-50"
                    }`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Kandidat</h1>
            <p className="text-xs text-gray-500">{totalCount} kandidat</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="hidden sm:flex items-center justify-center p-2 hover:bg-gray-100 rounded-lg"
            aria-label="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
          <Button size="sm" onClick={onAdd}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
