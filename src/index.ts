/**
 * @file index.ts — 统一导出（Barrel File）
 * @description
 *   作为项目的公共入口，将所有模块的公开 API 统一导出。
 *
 *   Barrel File 模式的优点：
 *   - 简化导入路径：消费者只需从 "./src/index.js" 导入一切
 *   - 隐藏内部结构：即使内部模块路径变化，公开 API 不变
 *   - 方便 Tree Shaking：构建工具可以按需裁剪未使用的导出
 *
 *   导出分类：
 *   - 核心模块：Agent 运行、注册表、监控器、配置、规划器
 *   - 类型定义：TypeScript 接口和类型（v3 新增 Toolbox/StructuredPlan/Config）
 *   - 工具箱：DEFAULT_TOOLBOXES（6 个默认工具箱）
 *   - 工具集：filesystemTools、execTools、webTools
 *   - 安全模块：沙箱验证函数
 *
 *   使用方式：
 *   ```typescript
 *   import {
 *     runAgent,
 *     DefaultToolRegistry,
 *     DefaultToolMonitor,
 *     DEFAULT_TOOLBOXES,
 *     filesystemTools,
 *     MODEL_PROFILES,
 *   } from "./src/index.js";
 *   ```
 *
 * @module index
 */

// ── 核心模块 ──
/** Agent 两阶段运行入口（规划 → 执行） */
export { runAgent, runPipeline, client, MODEL } from "./core/agent.js";

/** 默认工具注册表实现 */
export { DefaultToolRegistry } from "./core/registry.js";

/** 默认性能监控器实现 */
export { DefaultToolMonitor } from "./core/monitor.js";

/** 配置管理：预设、默认值、合并 */
export { getDefaultModelConfig, getDefaultAgentConfig, mergeAgentConfig, MODEL_PROFILES, applyModelProfile } from "./core/config.js";

/** Phase 1 规划器：生成结构化执行计划 */
export { generatePlan } from "./core/planner.js";

/** v3 新增：6 个默认工具箱 */
export { DEFAULT_TOOLBOXES } from "./toolboxes.js";

// ── 类型定义 ──
// v3 新增类型：Toolbox, StructuredPlan, ModelConfig, AgentConfig, SuggestedConfig, 等
export type * from "./core/types.js";

// ── 工具集 ──
export { filesystemTools } from "./tools/filesystem.js";
export { execTools } from "./tools/exec.js";
export { webTools } from "./tools/web.js";

// ── 安全模块 ──
export { resolveSandboxPath, isPathAllowed, getDefaultWorkspace } from "./security/sandbox.js";

// ── 技能系统 (v4) ──
export { DefaultSkillRegistry } from "./core/skill-registry.js";
export { discoverSkillPackages, parseSkillMd } from "./core/skill-loader.js";
export { createClawHubClient, searchLocalSkills } from "./core/clawhub-client.js";
export { OutputManager } from "./core/output-manager.js";
export { LoopDetector, DefaultLoopDetector } from "./core/loop-detector.js";
export { appendLog, truncate } from "./core/logger.js";

// ── v4.6: 上下文管理与记忆系统 ──
export { DefaultContextManager } from "./core/context-manager.js";
export { memoryStore, formatMemoryForPrompt, extractFacts, generateTurnSummary } from "./core/memory-store.js";

// ── v4.6: 单实例管理 ──
export { tryAcquireInstance, forceAcquireInstance, releaseInstance } from "./core/instance-manager.js";

// ── 自我优化工具 (v4.2) ──
export { selfOptTools } from "./tools/self-opt.js";
export { inspectSelf } from "./core/self-opt/inspector.js";
export { researchExternal } from "./core/self-opt/researcher.js";
export { generateProposals, formatProposals } from "./core/self-opt/proposal-engine.js";
export { runProposalTests, formatTestResults, executeOptimization } from "./core/self-opt/self-test-runner.js";
export { generateFixDiff } from "./core/self-opt/diff-generator.js";
export type * from "./core/self-opt/types.js";
