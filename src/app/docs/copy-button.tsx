"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-lg bg-[#76b900] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#86cf00]"
    >
      {copied ? "Copied ✓" : "Copy for AI"}
    </button>
  );
}
