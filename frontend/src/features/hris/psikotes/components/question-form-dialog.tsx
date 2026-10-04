"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MCQ_OPTION_KEYS,
  PAPI_SCALES,
  PAPI_SCALE_CODES,
  type InstrumentKind,
  type McqOptionKey,
  type PapiScaleCode,
} from "@/lib/recruitment/psikotes";
import { useCreateQuestion, useUpdateQuestion } from "../mutations";
import type {
  McqOption,
  PapiStatement,
  PsikotesInstrument,
  PsikotesQuestion,
  QuestionPayload,
} from "../types";

const OPTION_KEYS = MCQ_OPTION_KEYS;
const MIN_OPTIONS = 2;
const DEFAULT_OPTION_COUNT = 4;

/** Bentuk ulang row soal menjadi payload PUT (dipakai juga toggle aktif di daftar). */
export function toQuestionPayload(
  kind: InstrumentKind,
  question: PsikotesQuestion
): QuestionPayload | null {
  if (kind === "mcq") {
    if (!Array.isArray(question.options) || !question.answer_key) return null;
    return {
      body: question.body,
      options: question.options,
      answer_key: question.answer_key,
      sort_order: question.sort_order,
      is_active: question.is_active,
    };
  }
  if (kind === "forced_choice") {
    const pair = question.options as { a: PapiStatement; b: PapiStatement } | null;
    if (!pair?.a || !pair?.b) return null;
    return {
      body: question.body,
      options: pair,
      sort_order: question.sort_order,
      is_active: question.is_active,
    };
  }
  return null;
}

interface QuestionFormDialogProps {
  instrument: PsikotesInstrument;
  /** null = tambah soal baru */
  question: PsikotesQuestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Form tambah/edit soal: editor MCQ (opsi + kunci) atau pasangan PAPI (A/B + skala). */
export function QuestionFormDialog({
  instrument,
  question,
  open,
  onOpenChange,
}: QuestionFormDialogProps) {
  const isMcq = instrument.kind === "mcq";
  const createQuestion = useCreateQuestion();
  const updateQuestion = useUpdateQuestion();
  const isPending = createQuestion.isPending || updateQuestion.isPending;

  const existingMcqOptions =
    question && Array.isArray(question.options) ? (question.options as McqOption[]) : null;
  const existingPapiPair =
    question && !Array.isArray(question.options)
      ? (question.options as { a: PapiStatement; b: PapiStatement } | null)
      : null;

  const [body, setBody] = useState(question?.body ?? "");
  const [options, setOptions] = useState<McqOption[]>(
    existingMcqOptions ??
      OPTION_KEYS.slice(0, DEFAULT_OPTION_COUNT).map((key) => ({ key, text: "" }))
  );
  const [correct, setCorrect] = useState<McqOptionKey>(question?.answer_key?.correct ?? "a");
  const [papiA, setPapiA] = useState<PapiStatement>(
    existingPapiPair?.a ?? { text: "", scale: "A" }
  );
  const [papiB, setPapiB] = useState<PapiStatement>(
    existingPapiPair?.b ?? { text: "", scale: "G" }
  );

  const setOptionText = (index: number, text: string) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, text } : o)));

  const addOption = () =>
    setOptions((prev) =>
      prev.length < OPTION_KEYS.length ? [...prev, { key: OPTION_KEYS[prev.length], text: "" }] : prev
    );

  const removeLastOption = () => {
    if (options.length <= MIN_OPTIONS) return;
    const next = options.slice(0, -1);
    setOptions(next);
    if (!next.some((o) => o.key === correct)) setCorrect(next[0].key);
  };

  const buildPayload = (): QuestionPayload | null => {
    if (isMcq) {
      if (!body.trim()) {
        toast.error("Soal wajib diisi");
        return null;
      }
      if (options.some((o) => !o.text.trim())) {
        toast.error("Semua opsi harus terisi");
        return null;
      }
      return {
        body: body.trim(),
        options: options.map((o) => ({ key: o.key, text: o.text.trim() })),
        answer_key: { correct },
        sort_order: question?.sort_order ?? 0,
        is_active: question?.is_active ?? true,
      };
    }
    if (!papiA.text.trim() || !papiB.text.trim()) {
      toast.error("Kedua pernyataan (A dan B) wajib diisi");
      return null;
    }
    if (papiA.scale === papiB.scale) {
      toast.error("Skala pernyataan A dan B tidak boleh sama");
      return null;
    }
    return {
      body: body.trim(),
      options: {
        a: { text: papiA.text.trim(), scale: papiA.scale },
        b: { text: papiB.text.trim(), scale: papiB.scale },
      },
      sort_order: question?.sort_order ?? 0,
      is_active: question?.is_active ?? true,
    };
  };

  const handleSave = () => {
    const payload = buildPayload();
    if (!payload) return;
    const onSuccess = () => {
      toast.success("Soal tersimpan");
      onOpenChange(false);
    };
    const onError = (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan soal");

    if (question) {
      updateQuestion.mutate(
        { id: question.id, instrumentId: instrument.id, payload },
        { onSuccess, onError }
      );
    } else {
      createQuestion.mutate({ instrumentId: instrument.id, payload }, { onSuccess, onError });
    }
  };

  const scaleSelect = (value: PapiScaleCode, onChange: (v: PapiScaleCode) => void) => (
    <Select value={value} onValueChange={(v) => onChange(v as PapiScaleCode)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih skala" />
      </SelectTrigger>
      <SelectContent>
        {PAPI_SCALE_CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {code} — {PAPI_SCALES[code]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {question ? "Edit Soal" : "Tambah Soal"} — {instrument.name}
          </DialogPanelTitle>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {isMcq ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Soal</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Contoh: 12 + 7 × 3 = ?"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Opsi Jawaban (pilih kunci)</Label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon" className="size-8"
                      aria-label="Hapus opsi terakhir"
                      onClick={removeLastOption}
                      disabled={options.length <= MIN_OPTIONS}
                    >
                      <X className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon" className="size-8"
                      aria-label="Tambah opsi"
                      onClick={addOption}
                      disabled={options.length >= OPTION_KEYS.length}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
                {options.map((option, index) => (
                  <div key={option.key} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct-option"
                      checked={correct === option.key}
                      onChange={() => setCorrect(option.key)}
                      aria-label={`Kunci jawaban ${option.key.toUpperCase()}`}
                      className="size-4 accent-emerald-600"
                    />
                    <span className="w-5 text-sm font-medium text-muted-foreground">
                      {option.key.toUpperCase()}
                    </span>
                    <Input
                      value={option.text}
                      onChange={(e) => setOptionText(index, e.target.value)}
                      maxLength={500}
                      placeholder={`Teks opsi ${option.key.toUpperCase()}`}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Kunci jawaban: <span className="font-medium">{correct.toUpperCase()}</span> —
                  tidak pernah dikirim ke kandidat.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Keterangan (opsional)</Label>
                <Input
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={500}
                  placeholder="Contoh: nomor soal di buku sumber"
                />
              </div>
              {(
                [
                  ["A", papiA, setPapiA],
                  ["B", papiB, setPapiB],
                ] as const
              ).map(([label, statement, setStatement]) => (
                <div key={label} className="space-y-2 rounded-lg border border-border p-3">
                  <Label className="text-xs font-medium">Pernyataan {label}</Label>
                  <Textarea
                    value={statement.text}
                    onChange={(e) => setStatement({ ...statement, text: e.target.value })}
                    rows={2}
                    maxLength={500}
                    placeholder={`Teks pernyataan ${label}`}
                  />
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Skala PAPI</Label>
                    {scaleSelect(statement.scale, (scale) => setStatement({ ...statement, scale }))}
                  </div>
                </div>
              ))}
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Simpan Soal
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
