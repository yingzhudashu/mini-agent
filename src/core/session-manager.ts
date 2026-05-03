/**
 * @file core/session-manager.ts — 会话管理器（向后兼容）
 * @deprecated 新代码请使用 `import { ... } from "../session/index.js"`
 */

export { SessionManager, getSessionManager, SessionConfig, SessionContext } from "../session/manager.js";
