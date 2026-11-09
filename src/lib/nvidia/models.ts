import type { ReasoningEffort } from "./types";

const KIMI_EFFORTS: ReasoningEffort[] = ["none", "low", "high", "max"];

export type Modality = "text" | "image" | "audio" | "video";

export interface ModelInfo {
  id: string;
  displayName: string;
  ownedBy: string;
  description: string;
  reasoningEfforts: ReasoningEffort[];
  defaultEffort: ReasoningEffort;
  modalities: { input: Modality[]; output: Modality[] };
  contextWindow: number;
  maxOutputTokens: number;
}

const DEFAULT_MAX_OUTPUT = 120_000;

export const MODELS: ModelInfo[] = [
  {
    id: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    ownedBy: "moonshotai",
    description:
      "Moonshot AI Kimi K2.6. Reasoning traces with low/high/max effort, and thinking can be switched off.",
    reasoningEfforts: KIMI_EFFORTS,
    defaultEffort: "high",
    modalities: { input: ["text", "image"], output: ["text"] },
    contextWindow: 1_000_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelInfo | undefined {
  return BY_ID.get(id);
}

export function supportsEffort(model: ModelInfo, effort: string): boolean {
  return (model.reasoningEfforts as string[]).includes(effort);
}

export function canDisableThinking(model: ModelInfo): boolean {
  return supportsEffort(model, "none");
}

export function thinkingLevels(model: ModelInfo): ReasoningEffort[] {
  return model.reasoningEfforts.filter((e) => e !== "none");
}
