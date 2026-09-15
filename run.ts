/**
 * Maxxing — zero-to-pro acceleration agent.
 *
 * Run with:
 *   npx tsx run.ts "teach me how to solder from scratch"
 *
 * Requires:
 *   npm install
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const systemPrompt = readFileSync(
  path.join(__dirname, "SYSTEM_PROMPT.md"),
  "utf8",
);

async function main(): Promise<void> {
  const userPrompt =
    process.argv.slice(2).join(" ") ||
    "I've never done woodworking before. Get me to intermediate, fast.";

  const result = query({
    prompt: userPrompt,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt,
      cwd: __dirname,
      allowedTools: ["WebSearch", "Read", "Write", "Edit", "Glob", "Grep"],
      permissionMode: "acceptEdits",
    },
  });

  for await (const message of result) {
    if (message.type !== "assistant") continue;

    for (const block of message.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
