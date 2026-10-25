/**
 * PAR-Q+ health declaration (gym-care, /api/member-portal/gym/health). The
 * server owns the version and the question codes; the app owns the wording,
 * English keys translated in i18n-health.ts. A declaration is current for 12
 * months; any "yes" goes to a coach for review, never to the member's record
 * as a diagnosis.
 */

/** The seven PAR-Q+ general health questions, by server code. */
export const PARQ_QUESTIONS: Record<string, string> = {
  heart_condition: "Has a doctor ever said you have a heart condition or high blood pressure?",
  chest_pain: "Do you feel pain in your chest at rest, during daily activities, or when you exercise?",
  dizziness:
    "Do you lose your balance because of dizziness, or have you lost consciousness in the last 12 months? Answer no if the dizziness came from breathing hard during exercise.",
  chronic_condition: "Has a doctor ever diagnosed another chronic medical condition, besides heart disease or high blood pressure?",
  medication: "Do you currently take prescribed medication for a chronic medical condition?",
  bone_joint:
    "Do you have, or have you had in the last 12 months, a bone, joint or soft tissue (muscle, ligament, tendon) problem that more physical activity could make worse?",
  supervised_only: "Has a doctor ever said you should only do medically supervised physical activity?",
};

export interface ParqDeclaration {
  id: string;
  version: string;
  answers: Record<string, boolean>;
  has_yes: boolean;
  details: string;
  submitted_at: string;
  expires_at: string;
}

export interface ParqStatus {
  version: string;
  questions: { code: string }[];
  /** Fill it (again): never filled, an older version, or past 12 months. */
  due: boolean;
  last: ParqDeclaration | null;
}

export type ParqAnswers = Record<string, boolean | undefined>;

/** Question wording for a server code; an unknown code shows as is. */
export const questionText = (code: string) => PARQ_QUESTIONS[code] ?? code;

/** Every question of this version has a yes or no. */
export function answersComplete(answers: ParqAnswers, status: Pick<ParqStatus, "questions">): boolean {
  return status.questions.every((q) => typeof answers[q.code] === "boolean");
}

/** The answers to send: one boolean per question of this version. */
export function answersPayload(answers: ParqAnswers, status: Pick<ParqStatus, "questions">): Record<string, boolean> {
  return Object.fromEntries(status.questions.map((q) => [q.code, answers[q.code] === true]));
}

/** Home banner: first fill, refill after expiry or a new version, or none. */
export function parqBanner(status: Pick<ParqStatus, "due" | "last"> | undefined): "fill" | "refill" | null {
  if (!status?.due) return null;
  return status.last ? "refill" : "fill";
}

/** Start the form from the current declaration; a due one starts empty, so every answer is fresh. */
export function initialAnswers(status: ParqStatus): ParqAnswers {
  if (status.due || !status.last) return {};
  return { ...status.last.answers };
}
