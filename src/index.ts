/**
 * @file index.ts — 统一导出（Barrel File）
 * @description
 *   作为项目的公共入口，将所有模块的公开 API 统一导出。
 *
 *   Barrel File 模式的优点：
 *   1. 简化导入路径：消费者只需从 "./src/index.js" 导入一切
 *   2. 隐藏内部结构：即使内部模块路径变化，公开 API 不变
 *   3. 方便 Tree Shaking：构建工具可以按需裁剪未使用的导出
 *
 *   导出分类：
 *   - 核心模块：Agent 运行、注册表、监控器
 *   - 类型定义：TypeScript 接口和类型
 *   - 工具集：文件操作、命令执行、网络工具
 *   - 安全模块：沙箱验证函数
 *
 *   使用方式：
 *   ```typescript
 *   import {
 *     runAgent,                    // Agent 核心
 *     DefaultToolRegistry,          // 注册表
 *     DefaultToolMonitor,           // 监控器
 *     filesystemTools,              // 文件工具
 *     execTools,                    // 命令工具
 *     webTools,                     // 网络工具
 *     getDefaultWorkspace,          // 沙箱工具
 *   } from "./src/index.js";
 *   ```
 *
 * @module index
 */

// ── 核心模块 ──
export { runAgent, runPipeline, client, MODEL } from "./core/agent.js";
export { DefaultToolRegistry } from "./core/registry.js";
export { DefaultToolMonitor } from "./core/monitor.js";

// ── 类型定义 ──
// 使用 `export type *` 仅导出类型（不会增加运行时依赖）
// 包含：ToolDefinition, ToolContext, ToolResult, ToolRegistry,
//        ToolMonitor, ToolStats, AgentOptions, PipelineStep, 等
export type * from "./core/types.js";

// ── 工具集 ──
export { filesystemTools } from "./tools/filesystem.js";
export { execTools } from "./tools/exec.js";
export { webTools } from "./tools/web.js";

// ── 安全模块 ──
export { resolveSandboxPath, isPathAllowed, getDefaultWorkspace } from "./security/sandbox.js";
