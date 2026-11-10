/**
 * AgentClient — the seam between the Gauntlet and the Claude Agent SDK.
 *
 * The whole pipeline depends on this interface, never on the SDK directly, so
 * tests drive the pipeline with deterministic fake agents and the production
 * path uses the real SDK. One seam, two implementations.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

export interface AgentRunOptions {
  systemPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  canUseTool?: CanUseTool;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  text: string;
}

export interface AgentClient {
  run(prompt: string, opts: AgentRunOptions): Promise<AgentRunResult>;
}

export class SdkAgentClient implements AgentClient {
  async run(prompt: string, opts: AgentRunOptions): Promise<AgentRunResult> {
    const abortController = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) abortController.abort();
      else opts.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    const options: Options = {
      systemPrompt: opts.systemPrompt,
      permissionMode: opts.permissionMode ?? "acceptEdits",
    };
    if (opts.allowedTools) options.allowedTools = opts.allowedTools;
    if (opts.maxTurns !== undefined) options.maxTurns = opts.maxTurns;
    if (opts.cwd) options.cwd = opts.cwd;
    if (opts.model) options.model = opts.model;
    if (opts.canUseTool) options.canUseTool = opts.canUseTool;
    options.abortController = abortController;

    let assistantText = "";
    let resultText: string | null = null;

    const stream = query({ prompt, options });
    for await (const message of stream) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") assistantText += block.text;
        }
      } else if (message.type === "result" && message.subtype === "success") {
        resultText = message.result;
      } else if (message.type === "result") {
        // Turn exhaustion and execution errors must never masquerade as a
        // successful (possibly empty) answer downstream.
        throw new Error(`agent run failed: ${message.subtype}`);
      }
    }

    const text = (assistantText.trim().length > 0 ? assistantText : (resultText ?? "")).trim();
    return { text };
  }
}
