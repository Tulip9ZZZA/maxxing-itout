/**
 * Prompt loader. Prompts live as editable markdown in prompts/; this walks up
 * from the module location to find them, so it works under tsx, node dist/,
 * and tests without build-time copying.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cache: Map<string, string> | null = null;
let resolvedDir: string | null = null;

export function promptsDir(): string {
  if (resolvedDir) return resolvedDir;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, "prompts");
    if (existsSync(path.join(candidate, "terrain-gate.md"))) {
      resolvedDir = candidate;
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error("prompts directory not found (looked for prompts/terrain-gate.md upward)");
}

export function loadPrompt(name: string): string {
  if (!cache) cache = new Map();
  const cached = cache.get(name);
  if (cached) return cached;
  const filePath = path.join(promptsDir(), `${name}.md`);
  const content = readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`prompt file ${filePath} is empty`);
  }
  cache.set(name, content);
  return content;
}

/** Replace {{var}} tokens. Missing vars become empty strings, loudly. */
export function fillPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_whole, key: string) => {
    if (!(key in vars)) {
      throw new Error(`prompt variable {{${key}}} not provided`);
    }
    return vars[key]!;
  });
}
