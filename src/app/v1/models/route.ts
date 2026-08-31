import { NextResponse } from "next/server";
import {
  canDisableThinking,
  MODELS,
  thinkingLevels,
} from "@/lib/nvidia/models";
import { MAX_OUTPUT_TOKENS } from "@/lib/nvidia/validate";

export const dynamic = "force-dynamic";

export function GET() {
  const created = 1735689600;

  return NextResponse.json({
    object: "list",
    data: MODELS.map((model) => ({
      id: model.id,
      object: "model" as const,
      created,
      owned_by: model.ownedBy,
      display_name: model.displayName,
      description: model.description,
      reasoning_efforts: model.reasoningEfforts,
      thinking_levels: thinkingLevels(model),
      default_reasoning_effort: model.defaultEffort,
      supports_reasoning: true,
      can_disable_thinking: canDisableThinking(model),
      modalities: model.modalities,
      input_modalities: model.modalities.input,
      output_modalities: model.modalities.output,
      context_window: model.contextWindow,
      max_output_tokens: Math.min(model.maxOutputTokens, MAX_OUTPUT_TOKENS),
    })),
  });
}
