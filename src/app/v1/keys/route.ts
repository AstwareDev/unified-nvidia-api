import { NextResponse } from "next/server";
import { getKeyStats } from "@/lib/nvidia/keys";

export const dynamic = "force-dynamic";

export function GET() {
  const stats = getKeyStats();
  const now = Date.now();

  return NextResponse.json({
    object: "list",
    total_keys: stats.length,
    available_keys: stats.filter((k) => k.cooldownUntil === null).length,
    data: stats.map((k) => ({
      id: k.id,
      requests: k.requests,
      successes: k.successes,
      rate_limits: k.rateLimits,
      errors: k.errors,
      available: k.cooldownUntil === null,
      cooldown_seconds_remaining:
        k.cooldownUntil === null
          ? 0
          : Math.ceil((k.cooldownUntil - now) / 1000),
    })),
  });
}
