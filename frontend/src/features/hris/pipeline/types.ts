import type { Candidate, PipelineStage } from "@/types";

export interface UpdateCandidateStagePayload {
  id: string;
  status: PipelineStage;
}

export type { Candidate, PipelineStage };
export type * from "@/lib/recruitment/pipeline-types";
