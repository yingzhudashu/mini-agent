import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// Toolbox types
// ============================================================================

export type ToolPermission = "sandbox" | "allowlist" | "require-confirm";

export interface Toolbox {
  id: string;
  name: string;
  description: string;
  keywords: string[];
}

export interface ToolContext {
  cwd: string;
  allowedPaths: string[];
  permission: ToolPermission;
  signal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  content: string;
  meta?: Record<string, unknown>;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolDefinition {
  schema: ChatCompletionTool;
  handler: ToolHandler;
  permission: ToolPermission;
  help: string;
  /** Which toolbox this tool belongs to. If unset, tool is always included. */
  toolbox?: string;
}

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
  getSchemasByToolboxes(ids: string[]): ChatCompletionTool[];
  getByToolboxes(ids: string[]): Map<string, RegisteredTool>;
}

// ============================================================================
// Model Config
// ============================================================================

export interface ModelConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingLevel: "disabled" | "light" | "medium" | "heavy";
  thinkingBudget: number;
  contextWindow: number;
  stream: boolean;
  retryCount: number;
}

// ============================================================================
// Agent Config
// ============================================================================

export interface AgentConfig {
  maxTurns: number;
  toolTimeout: number;
  httpTimeout: number;
  contextReserveRatio: number;
  contextOverflowStrategy: "summarize" | "truncate" | "error";
  compressMessages: boolean;
  toolSelectionStrategy: "all" | "toolbox" | "auto";
  autoExecuteConfirmed: boolean;
  allowParallelTools: boolean;
  responseLanguage: string;
  responseFormat: "text" | "markdown" | "structured";
  debug: boolean;
  logTokenUsage: boolean;
}

// ============================================================================
// Planning types
// ============================================================================

export interface SuggestedConfig {
  maxTurns?: number;
  toolTimeout?: number;
  contextOverflowStrategy?: "summarize" | "truncate" | "error";
  toolSelectionStrategy?: "all" | "toolbox" | "auto";
  modelOverrides?: Partial<ModelConfig>;
  thinkingLevel?: "disabled" | "light" | "medium" | "heavy";
  chunkExecution?: boolean;
  chunkTokenBudget?: number;
  parallelism?: "sequential" | "safe-parallel" | "full-parallel";
  riskLevel?: "low" | "medium" | "high";
}

export interface PlanStep {
  stepNumber: number;
  description: string;
  requiredToolboxes: string[];
  expectedInput: string;
  expectedOutput: string;
  dependsOn?: number;
}

export interface PlanChunk {
  chunkNumber: number;
  steps: PlanStep[];
  estimatedTokens: number;
  chunkSystemPrompt: string;
}

export interface StructuredPlan {
  summary: string;
  steps: PlanStep[];
  requiredToolboxes: string[];
  suggestedConfig: SuggestedConfig;
  estimatedTokens: {
    promptTokens: number;
    completionTokens: number;
    toolResultTokens: number;
    total: number;
  };
  contextStrategy: {
    mode: "normal" | "chunked" | "summarize" | "truncate";
    chunks?: PlanChunk[];
    reason: string;
  };
  requiresConfirmation: boolean;
  confirmationMessage?: string;
  riskLevel: "low" | "medium" | "high";
  estimatedCost: {
    inputTokens: number;
    outputTokens: number;
    totalUSD: number;
  };
  outputSpec: {
    language: string;
    format: "text" | "markdown" | "structured";
    expectedDeliverable: string;
  };
  fallbackPlan: {
    degradeToSimple: boolean;
    degradedMaxTurns: number;
  };
}

// ============================================================================
// Pipeline types
// ============================================================================

export interface PipelineStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface PipelineResult {
  steps: { tool: string; args: Record<string, unknown>; result: ToolResult }[];
  finalContent: string;
  success: boolean;
}

// ============================================================================
// Stats types
// ============================================================================

export interface ToolStats {
  calls: number;
  totalMs: number;
  successCount: number;
  failCount: number;
  errors: string[];
}

export interface ToolMonitor {
  record(tool: string, durationMs: number, success: boolean): void;
  getStats(tool: string): ToolStats | undefined;
  getAllStats(): Map<string, ToolStats>;
  report(): string;
}
