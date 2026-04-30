/**
 * @file registry.ts — 动态工具注册中心
 * @description
 *   实现 ToolRegistry 接口，提供工具的运行注册和查询功能。
 *
 *   核心设计思想：
 *   1. 工具的定义（ToolDefinition）在启动时由各模块导出并注册
 *   2. Agent 核心代码只依赖 Registry 接口，不直接引用具体工具
 *   3. 运行时可以动态增减工具，无需重启 Agent
 *
 *   使用场景：
 *   - CLI 模式：注册所有工具（文件/命令/网络）
 *   - 安全模式：只注册安全的工具（read_file, get_time），不注册 exec_command
 *   - 扩展模式：用户通过插件注册自定义工具
 *
 * @module core/registry
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { RegisteredTool, ToolDefinition, ToolRegistry } from "./types.js";

/**
 * 默认工具注册表实现
 *
 * 内部使用 Map 存储，key 为工具名称，value 为 RegisteredTool。
 * Map 保证了插入顺序，list() 返回的顺序与注册顺序一致。
 *
 * 线程安全说明：
 *   TypeScript/JavaScript 是单线程的，所以 register/unregister/get 操作天然安全，
 *   不需要加锁。但如果未来加入 Web Worker 或多进程，需要注意并发问题。
 */
export class DefaultToolRegistry implements ToolRegistry {
  /** 存储所有已注册的工具，key 为工具名称 */
  private tools = new Map<string, RegisteredTool>();

  /**
   * 注册一个新工具
   *
   * 流程：
   * 1. 检查工具名称是否已存在（防止重复注册覆盖已有的工具）
   * 2. 将 ToolDefinition 扩展为 RegisteredTool（加上 name 字段）
   * 3. 存入内部 Map
   *
   * @param name - 工具的唯一名称，对应 OpenAI tool schema 中的 function.name
   * @param tool - 工具定义，包含 schema、handler、permission 和 help
   * @throws 如果工具名称已存在，抛出错误
   *
   * @example
   *   registry.register("read_file", {
   *     schema: { _OpenAI_schema_ },
   *     handler: async (args, ctx) => ({ success: true, content: "..." }),
   *     permission: "sandbox",
   *     help: "读取文件内容",
   *   });
   */
  register(name: string, tool: ToolDefinition): void {
    // 防止重复注册：如果工具已存在，抛出明确错误
    // 这样可以及时发现配置问题，而不是静默覆盖导致难以调试
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    // 将 ToolDefinition 扩展为 RegisteredTool（加上 name 字段）
    // 使用对象展开，确保不会意外修改传入的原始对象
    this.tools.set(name, { ...tool, name });
  }

  /**
   * 卸载一个工具
   *
   * 使用 Map.prototype.delete()，返回 true 表示工具存在并已被移除，
   * false 表示工具不存在（调用方可以根据此信息做日志或错误处理）。
   *
   * @param name - 要卸载的工具名称
   * @returns 如果工具存在并被成功卸载，返回 true；否则返回 false
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 按名称查找工具
   *
   * 时间复杂度：O(1)（Map 查找）
   *
   * 返回 undefined 而非抛出错误，因为"工具不存在"是一个正常的运行时状态
   *（例如 LLM 可能生成一个不存在的工具名称，Agent 需要优雅地处理这种情况）。
   *
   * @param name - 工具名称
   * @returns 找到的工具定义，未找到返回 undefined
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册的工具
   *
   * 返回 Map 的副本而非原始引用，防止外部代码意外修改内部状态。
   * 这是防御性编程的一种实践。
   *
   * @returns 所有工具的 Map 副本
   */
  getAll(): Map<string, RegisteredTool> {
    return new Map(this.tools);
  }

  /**
   * 获取所有工具的 OpenAI schema 数组
   *
   * 这是注册表最关键的输出：
   * LLM API 需要一个工具 schema 列表来决定何时调用工具。
   * 我们只提取 schema 字段，不包含 handler 和 permission 等内部信息。
   *
   * @returns ChatCompletionTool 数组，直接传递给 openai.chat.completions.create() 的 tools 参数
   *
   * @example
   *   const response = await client.chat.completions.create({
   *     model: "gpt-4o-mini",
   *     messages,
   *     tools: registry.getSchemas(),  // ← 这里
   *   });
   */
  getSchemas(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * 获取所有工具名称列表
   *
   * 主要用于错误提示信息。例如当 LLM 生成了一个不存在的工具名称时，
   * 可以回复："未知工具 xxx，可用工具: read_file, write_file, get_time"。
   *
   * @returns 工具名称数组，按注册顺序排列
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
