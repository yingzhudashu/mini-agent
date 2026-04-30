/**
 * @file registry.ts — 工具注册表
 * @description
 *   ToolRegistry 是 Mini Agent 的核心子系统之一，负责管理所有工具的生命周期。
 *
 *   架构设计：
 *   ```
 *   ┌──────────────────────────────────────────┐
 *   │           ToolRegistry                   │
 *   │                                          │
 *   │  register()   → 添加工具                  │
 *   │  unregister() → 移除工具                  │
 *   │  get()        → 查询单个工具              │
 *   │  getAll()     → 获取全部工具              │
 *   │  getSchemas() → 提取 OpenAI schema 列表   │
 *   │  list()       → 获取工具名称列表          │
 *   │                                          │
 *   │  getSchemasByToolboxes() → 按工具箱筛选   │
 *   │  getByToolboxes()        → 按工具箱筛选   │
 *   └──────────────────────────────────────────┘
 *   ```
 *
 *   为什么要用 Map 而不是 Array？
 *   - Map 的 get/set/delete 都是 O(1) 时间复杂度
 *   - Map 保持插入顺序，方便遍历
 *   - 工具名称天然具有唯一性，适合作为 key
 *
 *   工具箱筛选机制：
 *   - 每个工具可选绑定一个 toolbox ID（如 "file_read"）
 *   - 不绑定 toolbox 的工具始终可用（相当于 core 能力）
 *   - getSchemasByToolboxes() 用于 Phase 2 执行阶段动态筛选工具
 *
 * @module core/registry
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { RegisteredTool, ToolDefinition, ToolRegistry } from "./types.js";

/**
 * 默认工具注册表实现
 *
 * 实现 ToolRegistry 接口，使用 Map 作为内部存储。
 *
 * @example
 *   const registry = new DefaultToolRegistry();
 *   registry.register("read_file", readFileTool);
 *   registry.register("write_file", writeFileTool);
 *
 *   // 获取所有工具的 OpenAI schema
 *   const schemas = registry.getSchemas();
 *
 *   // 按工具箱筛选（Phase 2 执行阶段使用）
 *   const fileSchemas = registry.getSchemasByToolboxes(["file_read", "file_write"]);
 */
export class DefaultToolRegistry implements ToolRegistry {
  /** 内部存储：工具名称 → 已注册工具对象 */
  private tools = new Map<string, RegisteredTool>();

  /**
   * 注册一个工具
   *
   * 将 ToolDefinition 包装为 RegisteredTool（增加 name 字段），
   * 存入内部 Map。如果工具名称已存在，抛出异常防止重复注册。
   *
   * @param name - 工具名称（如 "read_file"、"write_file"）
   * @param tool - 工具定义（schema + handler + permission + help + toolbox）
   * @throws Error 如果工具名称已注册
   */
  register(name: string, tool: ToolDefinition): void {
    if (this.tools.has(name)) throw new Error(`Tool "${name}" already registered`);
    this.tools.set(name, { ...tool, name });
  }

  /**
   * 注销一个工具
   *
   * 从注册表中移除指定名称的工具。
   *
   * @param name - 工具名称
   * @returns true 如果成功移除，false 如果工具不存在
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 查询指定名称的工具
   *
   * @param name - 工具名称
   * @returns 工具对象，或 undefined 如果未注册
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册的工具（只读快照）
   *
   * 返回 Map 的副本而非引用，防止外部意外修改。
   *
   * @returns 所有工具的 Map 副本
   */
  getAll(): Map<string, RegisteredTool> {
    return new Map(this.tools);
  }

  /**
   * 提取所有工具的 OpenAI schema 列表
   *
   * 用于传递给 client.chat.completions.create() 的 tools 参数。
   * LLM 根据这些 schema 理解可用工具及其参数。
   *
   * @returns ChatCompletionTool[] — OpenAI SDK 兼容的工具 schema 数组
   */
  getSchemas(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  /**
   * 获取所有工具的名称列表
   *
   * 主要用于调试输出和日志。
   *
   * @returns 工具名称数组，按注册顺序排列
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 按工具箱 ID 筛选工具的 schema 列表
   *
   * 这是 v3 两阶段架构的核心方法。
   *
   * 工作流程：
   * 1. Phase 1（规划阶段）：LLM 分析需求，返回 requiredToolboxes 列表
   * 2. Phase 2（执行阶段）：调用此方法，只传入相关工具箱的工具给 LLM
   *
   * 筛选规则：
   * - 如果 ids 为空数组 → 返回全部工具（兜底策略）
   * - 工具的 toolbox 字段在 idSet 中 → 包含
   * - 工具的 toolbox 字段未设置（undefined）→ 始终包含（视为核心能力）
   *
   * @param ids - 工具箱 ID 数组（如 ["file_read", "exec"]）
   * @returns 匹配工具的 OpenAI schema 数组
   *
   * @example
   *   // 只传入文件读取和命令执行相关工具
   *   const schemas = registry.getSchemasByToolboxes(["file_read", "exec"]);
   *   // 结果：read_file + exec_command + get_time（无 toolbox，始终包含）
   */
  getSchemasByToolboxes(ids: string[]): ChatCompletionTool[] {
    if (ids.length === 0) return this.getSchemas();
    const idSet = new Set(ids);
    return Array.from(this.tools.values())
      .filter((t) => !t.toolbox || idSet.has(t.toolbox))
      .map((t) => t.schema);
  }

  /**
   * 按工具箱 ID 筛选完整的工具对象
   *
   * 与 getSchemasByToolboxes() 的区别：
   * - getSchemasByToolboxes() → 只返回 schema（用于 LLM 调用）
   * - getByToolboxes() → 返回完整工具对象（包含 handler，用于本地执行）
   *
   * 筛选规则与 getSchemasByToolboxes() 相同。
   *
   * @param ids - 工具箱 ID 数组
   * @returns 匹配工具的 Map（名称 → 完整工具对象）
   */
  getByToolboxes(ids: string[]): Map<string, RegisteredTool> {
    if (ids.length === 0) return this.getAll();
    const idSet = new Set(ids);
    const filtered = new Map<string, RegisteredTool>();
    for (const [name, tool] of this.tools) {
      if (!tool.toolbox || idSet.has(tool.toolbox)) {
        filtered.set(name, tool);
      }
    }
    return filtered;
  }
}
