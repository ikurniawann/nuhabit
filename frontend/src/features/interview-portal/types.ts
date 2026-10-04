export type InterviewPortalStatus = "sent" | "in_progress" | "completed" | "expired";

export interface InterviewPortalSession {
  status: InterviewPortalStatus;
  candidate_name: string;
  position_title: string | null;
  webcam_consent: boolean | null;
  max_questions: number;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface InterviewPortalTurn {
  id: string;
  turn_no: number;
  question: string;
  answer_transcript: string | null;
  asked_at: string;
  answered_at: string | null;
}

export interface InterviewPortalCurrentTurn extends InterviewPortalTurn {
  question_audio_base64: string | null;
}

export interface InterviewPortalData {
  session: InterviewPortalSession;
  turns: InterviewPortalTurn[];
  current_turn: InterviewPortalCurrentTurn | null;
}

export interface InterviewAnswerResult {
  done: boolean;
  turn?: InterviewPortalCurrentTurn | null;
}

export type InterviewProctorEventType =
  | "tab_blur"
  | "fullscreen_exit"
  | "paste"
  | "disconnect"
  | "webcam_snapshot"
  | "face_not_detected"
  | "multiple_faces"
  | "camera_off";
