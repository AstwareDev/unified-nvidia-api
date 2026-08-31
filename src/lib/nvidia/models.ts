import type { ReasoningEffort } from "./types";

const NEMOTRON_EFFORTS: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const KIMI_EFFORTS: ReasoningEffort[] = ["none", "low", "high", "max"];

const OPENAI_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

const DEEPSEEK_EFFORTS: ReasoningEffort[] = ["none", "low", "high", "max"];

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
    id: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    ownedBy: "moonshotai",
    description:
      "Moonshot AI Kimi K3. Reasoning traces with low/high/max effort, and thinking can be switched off.",
    reasoningEfforts: KIMI_EFFORTS,
    defaultEffort: "high",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 1_000_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    displayName: "Nemotron 3 Super 120B",
    ownedBy: "nvidia",
    description: "NVIDIA Nemotron 3 Super MoE. Balanced quality and latency.",
    reasoningEfforts: NEMOTRON_EFFORTS,
    defaultEffort: "medium",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 256_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    displayName: "Nemotron 3 Ultra 550B",
    ownedBy: "nvidia",
    description:
      "Largest Nemotron 3 MoE. Highest quality, noticeably slower first token.",
    reasoningEfforts: NEMOTRON_EFFORTS,
    defaultEffort: "medium",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 256_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    displayName: "Nemotron 3 Nano 30B",
    ownedBy: "nvidia",
    description: "Small, fast Nemotron 3 MoE. Good default for quick tests.",
    reasoningEfforts: NEMOTRON_EFFORTS,
    defaultEffort: "medium",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 256_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "deepseek-ai/deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro",
    ownedBy: "deepseek-ai",
    description:
      "DeepSeek V4 Pro, the largest V4 tier. Very slow cold starts — allow several minutes for a first response.",
    reasoningEfforts: DEEPSEEK_EFFORTS,
    defaultEffort: "high",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 1_000_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "deepseek-ai/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash",
    ownedBy: "deepseek-ai",
    description: "DeepSeek V4 Flash. Faster, lighter counterpart to V4 Pro.",
    reasoningEfforts: DEEPSEEK_EFFORTS,
    defaultEffort: "high",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 1_000_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "openai/gpt-oss-120b",
    displayName: "GPT-OSS 120B",
    ownedBy: "openai",
    description:
      "OpenAI GPT-OSS 120B. Upstream accepts only low/medium/high — thinking cannot be turned off.",
    reasoningEfforts: OPENAI_EFFORTS,
    defaultEffort: "medium",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 128_000,
    maxOutputTokens: DEFAULT_MAX_OUTPUT,
  },
  {
    id: "openai/gpt-oss-20b",
    displayName: "GPT-OSS 20B",
    ownedBy: "openai",
    description:
      "OpenAI GPT-OSS 20B. Upstream accepts only low/medium/high — thinking cannot be turned off.",
    reasoningEfforts: OPENAI_EFFORTS,
    defaultEffort: "medium",
    modalities: { input: ["text"], output: ["text"] },
    contextWindow: 128_000,
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
