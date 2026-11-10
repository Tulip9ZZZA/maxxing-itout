/**
 * Tolerant JSON extraction from agent output.
 *
 * Agents are asked for fenced JSON blocks. They sometimes add prose around it,
 * use trailing commas, or forget the fence entirely. This parser handles the
 * realistic failure modes; when nothing parses it returns null and the caller
 * records a real gap instead of pretending the data exists.
 */

export function extractJson<T = unknown>(text: string): T | null {
  const candidates: string[] = [];

  const fence = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    candidates.push(match[1]!.trim());
  }

  const braced = findBalanced(text, "{", "}");
  for (const candidate of braced) candidates.push(candidate);
  const bracketed = findBalanced(text, "[", "]");
  for (const candidate of bracketed) candidates.push(candidate);

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed !== null) return parsed as T;
  }
  return null;
}

function tryParse(raw: string): unknown {
  const attempts = [raw, stripTrailingCommas(raw)];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function stripTrailingCommas(raw: string): string {
  return raw.replace(/,\s*([}\]])/g, "$1");
}

/** Extract balanced {..} or [..] regions, outermost-first, skipping strings. */
function findBalanced(text: string, open: string, close: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth > 0) inString = true;
      continue;
    }
    if (char === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (char === close) {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

/** Keyword-overlap test used by deterministic gate checks. Words of >=4 chars. */
export function keywordOverlap(a: string, b: string): boolean {
  const words = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4),
    );
  const wa = words(a);
  const wb = words(b);
  for (const w of wa) {
    if (wb.has(w)) return true;
  }
  return false;
}
