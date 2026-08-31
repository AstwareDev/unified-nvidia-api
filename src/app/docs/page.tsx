import fs from "node:fs/promises";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { CopyButton } from "./copy-button";

export const dynamic = "force-static";

export const metadata = {
  title: "API docs · Unified NVIDIA API",
  description:
    "Copyable integration guide for the OpenAI-compatible NVIDIA gateway.",
};

async function readGuide(): Promise<string> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "AI_API_GUIDE.md"),
      "utf8",
    );
  } catch {
    return "AI_API_GUIDE.md could not be read on the server.";
  }
}

export default async function DocsPage() {
  const guide = await readGuide();

  return (
    <div className="min-h-full bg-black text-zinc-100 font-sans">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Image
            src="/nvidia-color.svg"
            alt="NVIDIA"
            width={26}
            height={26}
            className="size-[26px]"
          />
          <div className="h-6 w-px bg-zinc-700" />
          <h1 className="text-sm font-semibold tracking-tight">
            API docs
            <span className="ml-2 font-normal text-zinc-500">
              paste this into an AI assistant
            </span>
          </h1>
          <Link
            href="/"
            className="ml-auto text-xs text-zinc-500 transition-colors hover:text-[#9ede2b]"
          >
            ← Console
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-400">
            Everything an AI needs to call this API correctly — models, the
            per-model reasoning levels, the thinking toggle, streaming, and
            error codes.
          </p>
          <CopyButton text={guide} />
        </div>

        <div className="overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <Markdown>{guide}</Markdown>
        </div>
      </main>
    </div>
  );
}
