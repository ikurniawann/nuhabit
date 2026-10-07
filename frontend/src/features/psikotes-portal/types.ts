export type PortalSessionStatus = "draft" | "sent" | "in_progress" | "completed" | "expired";
export type PortalTestStatus = "pending" | "in_progress" | "selesai" | "perlu_review" | "reviewed";
export type PortalInstrumentKind = "mcq" | "forced_choice" | "drawing";

export interface PortalSession {
  status: PortalSessionStatus;
  candidate_name: string;
  position_title: string | null;
  webcam_consent: boolean | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PortalTest {
  id: string;
  status: PortalTestStatus;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  has_attachment: boolean;
  instrument: {
    code: string;
    name: string;
    kind: PortalInstrumentKind;
    duration_seconds: number;
    instructions: string;
  };
}

/** Soal tersanitasi (tanpa kunci MCQ / kode skala PAPI). */
export interface PortalQuestion {
  id: string;
  body: string;
  options: { key: string; text: string }[] | { a: { text: string }; b: { text: string } };
}

export interface PortalTestStartData {
  test: PortalTest;
  questions: PortalQuestion[];
  saved_answers: Record<string, string>;
  ends_at: string | null;
}

export interface PortalSessionData {
  session: PortalSession;
  tests: PortalTest[];
}

export type ProctorEventType =
  | "tab_blur"
  | "fullscreen_exit"
  | "paste"
  | "disconnect"
  | "webcam_snapshot";

const TERMINAL_TEST_STATUSES: ReadonlySet<PortalTestStatus> = new Set(["selesai", "perlu_review", "reviewed"]);

/** Tes sudah selesai dikerjakan (terskor atau menunggu/sudah review HR). */
export const isTerminalTest = (test: PortalTest) => TERMINAL_TEST_STATUSES.has(test.status);
