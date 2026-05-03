/**
 * @file session/index.ts — 会话管理统一导出
 * @description
 *   v4.8 重构：从 core/ 移动到 session/ 目录。
 *   旧路径保持兼容，新代码请从本目录导入。
 *
 * @module session
 */

export { SessionManager, getSessionManager, SessionConfig, SessionContext } from "./manager.js";
export { WorkspaceManager, getWorkspaceManager } from "./workspace.js";
