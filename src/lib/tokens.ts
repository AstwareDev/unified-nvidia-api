import { encode } from "gpt-tokenizer/encoding/o200k_base";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function tokensPerSecond(
  tokens: number,
  elapsedMs: number,
): number | null {
  if (elapsedMs < 50 || tokens <= 0) return null;
  return (tokens / elapsedMs) * 1000;
}

export function formatTokensPerSecond(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)} tok/s`;
}
