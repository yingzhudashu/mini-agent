/**
 * @file types.ts — 核心类型定义
 * @description
 *   定义整个 Agent 工具系统的类型体系，包括：
 *   1. 工具定义（ToolDefinition）— 单个工具的完整描述
 *   2. 工具注册表（ToolRegistry）— 管理所有可用工具的接口
 *   3. 工具流水线（Pipeline）— 顺序执行多个工具的类型
 *   4. 性能监控（ToolMonitor）— 工具调用统计的类型
 *   5. Agent 选项（AgentOptions）— Agent 运行时的配置选项
 *
 * @module core/types
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// 一、工具定义相关类型
// ============================================================================

/**
 * 工具权限等级
 *
 * 三级权限设计：
 * - `sandbox`       — 安全操作，无需用户确认（如读文件、列目录、查时间）
 * - `allowlist`     — 中等风险，受白名单限制（如命令执行）
 * - `require-confirm` — 破坏性操作，必须用户确认后才能执行（如删除文件）
 */
export type ToolPermission = "sandbox" | "allowlist" | "require-confirm";

/**
 * 工具执行上下文
 *
 * 每次调用工具时传入的环境信息，包含：
 * - 当前工作目录（影响相对路径解析）
 * - 允许访问的目录列表（沙箱边界）
 * - 当前权限等级
 * - 可选的取消信号（用于中断长时间运行的操作）
 */
export interface ToolContext {
  /** 当前工作目录，用于解析相对路径 */
  cwd: string;
  /** 允许访问的目录列表，文件操作必须在此范围内 */
  allowedPaths: string[];
  /** 当前工具的权限等级，决定安全检查策略 */
  permission: ToolPermission;
  /** 可选的 AbortSignal，用于中断长时间运行的操作（如网络请求、大命令执行） */
  signal?: AbortSignal;
}

/**
 * 工具执行结果
 *
 * 所有工具的 handler 必须返回此格式的结果，确保统一的响应结构。
 *
 * @example
 *   { success: true, content: "文件已读取", meta: { lines: 42 } }
 *   { success: false, content: "文件不存在" }
 */
export interface ToolResult {
  /** 操作是否成功。true 表示成功，false 表示失败 */
  success: boolean;
  /** 结果内容（人类可读的文本），将传递给 LLM 作为工具调用的返回值 */
  content: string;
  /**
   * 可选的元数据，用于监控和调试
   * 例如：读取行数、文件大小、执行耗时等
   * 不会传递给 LLM，仅用于内部统计
   */
  meta?: Record<string, unknown>;
}

/**
 * 工具处理器函数类型
 *
 * 接收 LLM 解析出的参数对象和执行上下文，返回执行结果。
 *
 * @param args  - LLM 生成的参数，格式为 JSON 对象，键名对应 OpenAI tool schema 中的 properties
 * @param ctx   - 执行上下文，包含工作目录、沙箱路径、权限等信息
 * @returns     执行结果的 Promise
 *
 * @example
 *   // 读取文件工具的 handler 签名
 *   async function readFileHandler(
 *     args: { path: string; offset?: number; limit?: number },
 *     ctx: ToolContext
 *   ): Promise<ToolResult> {
 *     const content = await fs.readFile(args.path, "utf-8");
 *     return { success: true, content };
 *   }
 */
export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

/**
 * 工具类别 — 用于动态工具筛选
 *
 * 每个类别对应一组相关工具。Agent 根据用户输入的意图匹配类别，
 * 只将相关工具的 schema 发送给 LLM，节省 token 消耗。
 *
 * 设计原则：
 * - 类别数量应远小于工具总数（理想：3-5 个类别）
 * - 每个类别内的工具共享相似的用途或操作域
 * - "core" 类别的工具始终发送（如 get_time、get_date 等基础能力）
 */
export type ToolCategory =
  | "file_read"      // 文件读取
  | "file_write"     // 文件写入/编辑
  | "dir_ops"        // 目录操作（列出、创建、移动、删除）
  | "exec"           // 命令执行
  | "web"            // 网络访问
  | "core"           // 核心基础能力（始终发送）
  | string;          // 允许扩展自定义类别

/**
 * 工具定义 — 描述一个工具的完整信息
 *
 * 每个工具由五个部分组成：
 * 1. schema    — OpenAI 兼容的工具描述（告诉 LLM 这个工具能做什么、需要什么参数）
 * 2. handler   — 实际执行函数（Agent 调用时运行）
 * 3. permission — 权限等级（决定是否需要用户确认）
 * 4. help      — 简短帮助文本（用于 .tools 命令显示）
 * 5. category  — 工具类别（用于动态筛选，可选）
 *
 * @example
 *   const myTool: ToolDefinition = {
 *     schema: { type: "function", function: { name: "greet", description: "...", parameters: {} } },
 *     handler: async (args) => ({ success: true, content: "Hello!" }),
 *     permission: "sandbox",
 *     help: "打招呼",
 *     category: "core",
 *   };
 */
export interface ToolDefinition {
  /** OpenAI 兼容的工具 schema，定义工具名称、描述和参数结构 */
  schema: ChatCompletionTool;
  /** 实际执行的函数，接收 LLM 解析的参数和上下文，返回执行结果 */
  handler: ToolHandler;
  /** 权限等级，决定该工具是否需要用户确认 */
  permission: ToolPermission;
  /** 简短描述，用于 `.tools` 命令和监控报告中的显示 */
  help: string;
  /** 工具类别，用于动态筛选。不设置则该工具始终被发送 */
  category?: ToolCategory;
}

// ============================================================================
// 二、工具注册表相关类型
// ============================================================================

/**
 * 已注册的工具 — 在 ToolDefinition 基础上增加了工具名称
 *
 * 注册后，工具有了唯一的名称标识，可通过 registry.get(name) 查找。
 */
export interface RegisteredTool extends ToolDefinition {
  /** 工具的唯一名称，对应 OpenAI tool schema 中的 function.name */
  name: string;
}

/**
 * 工具注册表接口
 *
 * 提供工具的动态管理：注册、卸载、查询、列出。
 * 支持运行时动态增减工具，无需修改 Agent 核心代码。
 *
 * 设计思想：
 * - 将工具注册与 Agent 核心解耦，工具可独立开发和测试
 * - 不同场景（CLI / Web / API）可注册不同的工具集
 * - 支持热插拔：运行时可以卸载不需要的工具
 *
 * @example
 *   const registry = new DefaultToolRegistry();
 *   registry.register("read_file", readFileTool);
 *   registry.register("write_file", writeFileTool);
 *
 *   // 获取所有工具的 schema 传给 LLM
 *   const schemas = registry.getSchemas();
 *
 *   // 运行时卸载
 *   registry.unregister("delete_file");
 */
export interface ToolRegistry {
  /**
   * 注册一个新工具
   * @param name - 工具的唯一名称
   * @param tool - 工具定义（schema + handler + permission + help）
   * @throws 如果工具名称已存在，抛出错误
   */
  register(name: string, tool: ToolDefinition): void;
  /**
   * 卸载一个工具
   * @param name - 要卸载的工具名称
   * @returns 如果工具存在并被成功卸载，返回 true；否则返回 false
   */
  unregister(name: string): boolean;
  /**
   * 按名称查找工具
   * @param name - 工具名称
   * @returns 找到的工具定义，未找到返回 undefined
   */
  get(name: string): RegisteredTool | undefined;
  /**
   * 获取所有已注册的工具（返回副本，防止外部修改）
   */
  getAll(): Map<string, RegisteredTool>;
  /**
   * 获取所有工具的 OpenAI schema 数组
   * 用于传递给 LLM API 的 tools 参数
   */
  getSchemas(): ChatCompletionTool[];
  /**
   * 获取所有工具名称列表
   * 用于错误提示（"未知工具，可用工具: xxx, yyy"）
   */
  list(): string[];
  /**
   * 按类别筛选工具的 schema 数组
   * @param categories - 要包含的类别列表。空数组 = 返回全部工具
   * @returns 筛选后的 ChatCompletionTool 数组
   */
  getSchemasByCategories(categories: ToolCategory[]): ChatCompletionTool[];
  /**
   * 按类别筛选工具定义
   * @param categories - 要包含的类别列表。空数组 = 返回全部工具
   * @returns 筛选后的工具名称到定义的 Map
   */
  getByCategories(categories: ToolCategory[]): Map<string, RegisteredTool>;
}

// ============================================================================
// 三、工具流水线相关类型
// ============================================================================

/**
 * 流水线中的单个步骤
 *
 * 流水线允许不经过 LLM 直接顺序执行多个工具。
 * 适用于确定性的工作流（如：读取 → 编辑 → 写入 → 执行测试）。
 *
 * @example
 *   const steps: PipelineStep[] = [
 *     { tool: "read_file", args: { path: "src/index.ts" } },
 *     { tool: "write_file", args: { path: "src/index.ts.bak", content: "..." } },
 *   ];
 */
export interface PipelineStep {
  /** 要调用的工具名称 */
  tool: string;
  /** 传递给该工具的参数 */
  args: Record<string, unknown>;
}

/**
 * 流水线执行结果
 *
 * 包含每一步的详细信息（工具名、参数、结果）以及总体状态。
 */
export interface PipelineResult {
  /** 每一步的执行详情，按顺序排列 */
  steps: Array<{
    /** 工具名称 */
    tool: string;
    /** 传入的参数 */
    args: Record<string, unknown>;
    /** 执行结果 */
    result: ToolResult;
  }>;
  /** 所有步骤输出内容的拼接（用于最终展示） */
  finalContent: string;
  /** 是否所有步骤都成功执行 */
  success: boolean;
}

// ============================================================================
// 四、性能监控相关类型
// ============================================================================

/**
 * 单个工具的统计数据
 *
 * 跟踪工具的使用频率、错误率和性能表现。
 */
export interface ToolStats {
  /** 总调用次数 */
  calls: number;
  /** 失败次数（success=false 的次数） */
  errors: number;
  /** 累计耗时（毫秒） */
  totalMs: number;
  /** 平均每次调用耗时（毫秒） */
  avgMs: number;
  /** 最后一次调用的时间（ISO 格式字符串） */
  lastCall?: string;
}

/**
 * 工具性能监控器接口
 *
 * 自动记录每次工具调用的耗时和成功/失败状态，
 * 提供统计报告和单个工具的性能数据。
 *
 * @example
 *   const monitor = new DefaultToolMonitor();
 *   monitor.record("read_file", 15, true);  // 记录一次成功的调用
 *   monitor.record("read_file", 20, true);
 *   monitor.record("read_file", 5, false);   // 记录一次失败的调用
 *
 *   const stats = monitor.getStats("read_file");
 *   // { calls: 3, errors: 1, totalMs: 40, avgMs: 13, lastCall: "..." }
 *
 *   console.log(monitor.report());
 *   // 📊 工具使用统计:
 *   //   read_file: 调用 3 次 | 平均 13ms | 成功率 66.7%
 */
export interface ToolMonitor {
  /**
   * 记录一次工具调用
   * @param name       - 工具名称
   * @param durationMs - 本次调用耗时（毫秒）
   * @param success    - 是否成功
   */
  record(name: string, durationMs: number, success: boolean): void;
  /**
   * 获取单个工具的统计数据
   * @param name - 工具名称
   * @returns 统计数据，未找到返回 undefined
   */
  getStats(name: string): ToolStats | undefined;
  /**
   * 获取所有工具的统计数据（返回副本）
   */
  getAllStats(): Map<string, ToolStats>;
  /**
   * 生成人类可读的统计报告
   * @returns 格式化的报告字符串
   */
  report(): string;
}

// ============================================================================
// 五、Agent 运行选项
// ============================================================================

/**
 * Agent 运行时的配置选项
 *
 * 这些选项控制 Agent 的行为方式，包括系统提示、最大调用次数等。
 *
 * @example
 *   await runAgent("读取 package.json", {
 *     registry,
 *     systemPrompt: "你是一个文件助手",
 *     maxTurns: 3,
 *     onToolCall: (name, args, result) => {
 *       console.log(`调用了 ${name}:`, result);
 *     },
 *   });
 */
export interface AgentOptions {
  /**
   * 系统提示词（System Prompt）
   * 如果不指定，使用默认提示 "你是一个有用的助手。"
   */
  systemPrompt?: string;
  /**
   * 最大 ReAct 循环轮数
   * 防止无限工具调用。每轮包含一次 LLM 请求和可能的多次工具调用。
   * 默认 5 轮。
   */
  maxTurns?: number;
  /**
   * 工具调用回调
   * 每次工具执行后触发此回调，可用于日志输出、UI 更新等
   * @param name   - 工具名称
   * @param args   - 传入参数的 JSON 字符串
   * @param result - 工具返回的内容
   */
  onToolCall?: (name: string, args: string, result: string) => void;
  /**
   * 是否启用流水线模式
   * 如果为 true，Agent 会将 LLM 生成的多个工具调用按顺序执行，
   * 前一个工具的结果对后续调用可见。
   */
  enablePipeline?: boolean;
}
