"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeedbackCycles } from "../queries";
import { FeedbackApprovalsTab } from "./feedback-approvals-tab";
import { FeedbackAssignmentsTab } from "./feedback-assignments-tab";
import { FeedbackCyclesTab } from "./feedback-cycles-tab";
import { FeedbackResultsTab } from "./feedback-results-tab";

/**
 * HRIS → Feedback 360°: siklus, penugasan penilai (diri, atasan, rekan,
 * bawahan), antrean persetujuan penilaian diri, dan hasil per karyawan.
 * Karyawan mengisi penilaiannya di ESS (/dashboard/me/feedback-360).
 */
export function FeedbackAdminPage() {
  const cyclesQuery = useFeedbackCycles();
  const cycles = cyclesQuery.data ?? [];
  const [tab, setTab] = useState("cycles");
  const [selectedCycle, setSelectedCycle] = useState("");
  // Default: siklus terbaru sampai pengguna memilih yang lain.
  const cycleId = cycles.some((c) => c.id === selectedCycle) ? selectedCycle : (cycles[0]?.id ?? "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UsersRound className="h-6 w-6 text-brand-text" />
          Feedback 360°
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Penilaian perilaku dari diri sendiri, atasan, rekan, dan bawahan dalam lima kategori. Hasilnya digabung
          dengan KPI menjadi nilai akhir per karyawan.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="cycles">Siklus</TabsTrigger>
          <TabsTrigger value="assignments">Penugasan</TabsTrigger>
          <TabsTrigger value="approvals">Persetujuan</TabsTrigger>
          <TabsTrigger value="results">Hasil</TabsTrigger>
        </TabsList>

        <TabsContent value="cycles">
          <FeedbackCyclesTab
            cycles={cycles}
            loading={cyclesQuery.isLoading}
            error={cyclesQuery.error}
            onOpenCycle={(id) => {
              setSelectedCycle(id);
              setTab("assignments");
            }}
          />
        </TabsContent>
        <TabsContent value="assignments">
          <FeedbackAssignmentsTab cycles={cycles} cycleId={cycleId} onCycleChange={setSelectedCycle} />
        </TabsContent>
        <TabsContent value="approvals">
          <FeedbackApprovalsTab />
        </TabsContent>
        <TabsContent value="results">
          <FeedbackResultsTab cycles={cycles} cycleId={cycleId} onCycleChange={setSelectedCycle} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
