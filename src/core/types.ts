/**
 * Core type definitions for the Mini Agent tool system.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ── Tool Definition ──

export type ToolPermission = "sandbox" | "allowlist" | "require-confirm";

export interface ToolContext {
  /** Current working directory */
  cwd: string;
  /** Allowed directories for file operations */
  allowedPaths: string[];
  /** Permission level */
  permission: ToolPermission;
  /** Signal to abort long-running operations */
  signal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  content: string;
  /** Optional metadata for monitoring */
  meta?: Record<string, unknown>;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolDefinition {
  /** OpenAI-compatible tool schema */
  schema: ChatCompletionTool;
  /** Implementation function */
  handler: ToolHandler;
  /** Permission level */
  permission: ToolPermission;
  /** Short description for help output */
  help: string;
}

// ── Registry ──

export interface RegisteredTool extends ToolDefinition {
  name: string;
}

export interface ToolRegistry {
  register(name: string, tool: ToolDefinition): void;
  unregister(name: string): boolean;
  get(name: string): RegisteredTool | undefined;
  getAll(): Map<string, RegisteredTool>;
  getSchemas(): ChatCompletionTool[];
  list(): string[];
}

// ── Pipeline ──

export interface PipelineStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface PipelineResult {
  steps: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
  finalContent: string;
  success: boolean;
}

// ── Monitor ──

export interface ToolStats {
  calls: number;
  errors: number;
  totalMs: number;
  avgMs: number;
  lastCall?: string;
}

export interface ToolMonitor {
  record(name: string, durationMs: number, success: boolean): void;
  getStats(name: string): ToolStats | undefined;
  getAllStats(): Map<string, ToolStats>;
  report(): string;
}

// ── Agent Options ──

export interface AgentOptions {
  systemPrompt?: string;
  maxTurns?: number;
  onToolCall?: (name: string, args: string, result: string) => void;
  enablePipeline?: boolean;
}
