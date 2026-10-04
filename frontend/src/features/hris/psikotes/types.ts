import type { InstrumentKind, McqOptionKey, PapiScaleCode } from "@/lib/recruitment/psikotes";

export interface InstrumentConfig {
  duration_seconds?: number;
  /** mcq: jumlah soal yang ditarik dari bank; null/undefined = semua soal aktif */
  question_count?: number | null;
  shuffle?: boolean;
  instructions?: string;
}

export interface PsikotesInstrument {
  id: string;
  code: string;
  name: string;
  kind: InstrumentKind;
  config: InstrumentConfig;
  is_active: boolean;
  sort_order: number;
  question_count: number;
  active_question_count: number;
  created_at: string;
  updated_at: string;
}

export interface McqOption {
  key: McqOptionKey;
  text: string;
}

export interface PapiStatement {
  text: string;
  scale: PapiScaleCode;
}

export interface PsikotesQuestion {
  id: string;
  instrument_id: string;
  body: string;
  /** mcq: McqOption[]; forced_choice: { a, b } */
  options: McqOption[] | { a: PapiStatement; b: PapiStatement } | null;
  /** mcq: { correct: key opsi }; forced_choice: null */
  answer_key: { correct: McqOptionKey } | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InstrumentUpdatePayload {
  name?: string;
  is_active?: boolean;
  config?: InstrumentConfig;
}

export interface McqQuestionPayload {
  body: string;
  options: McqOption[];
  answer_key: { correct: McqOptionKey };
  sort_order: number;
  is_active: boolean;
}

export interface PapiQuestionPayload {
  body: string;
  options: { a: PapiStatement; b: PapiStatement };
  sort_order: number;
  is_active: boolean;
}

export type QuestionPayload = McqQuestionPayload | PapiQuestionPayload;
