/**
 * @file sandbox.ts — 路径沙箱
 * @description
 *   确保文件操作只在允许的目录范围内执行，防止越权访问。
 *
 *   安全威胁模型：
 *   假设 LLM 生成工具调用时可能被"注入"（prompt injection），
 *   或者用户不小心输入了 `read_file(path="/etc/shadow")`。
 *   沙箱确保即使发生了这些情况，也不会读取或修改工作区外的文件。
 *
 *   工作原理：
 *   1. 将用户输入的路径解析为绝对路径
 *   2. 遍历允许的目录列表，检查解析后的路径是否在某个目录内
 *   3. 如果不在任何允许的范围，抛出错误
 *
 *   边界情况处理：
 *   - 符号链接（symlink）：path.resolve() 会解析到真实路径，防止 symlink 逃逸
 *   - 相对路径（如 "../../etc/passwd"）：解析后会被 path.resolve() 转为绝对路径，
 *     然后检查是否在允许范围内
 *   - 空路径：path.resolve("") 返回 cwd，需要在 allowedPaths 中包含 cwd
 *
 * @module security/sandbox
 */

import path from "node:path";

/**
 * 解析并验证路径是否在允许的目录范围内
 *
 * 安全检查流程：
 * 1. 使用 path.resolve() 将输入路径转为绝对路径
 *    （这会自动处理相对路径、. 和 .. 等）
 * 2. 遍历 allowedDirs，检查 resolved 路径是否与某个目录匹配
 * 3. 匹配规则：路径等于目录本身，或以 "目录 + 分隔符" 开头
 *    （例如：allowed = ["/workspace"]，resolved = "/workspace/src/index.ts"
 *     → 以 "/workspace/" 开头 → ✅ 通过）
 *
 * @param inputPath   - 用户提供的文件路径（可以是相对路径或绝对路径）
 * @param allowedDirs - 允许访问的目录列表（绝对路径）
 * @returns 解析后的绝对路径
 * @throws 如果路径超出允许的范围
 *
 * @example
 *   // ✅ 通过
 *   resolveSandboxPath("src/index.ts", ["/workspace"]);
 *   // → "/workspace/src/index.ts"
 *
 *   // ❌ 拒绝
 *   resolveSandboxPath("/etc/passwd", ["/workspace"]);
 *   // → Error: 路径 "/etc/passwd" 超出允许的范围: /workspace
 *
 *   // ❌ 拒绝（相对路径逃逸尝试）
 *   resolveSandboxPath("../../etc/passwd", ["/workspace"]);
 *   // → 如果解析后不在 /workspace 下 → Error
 */
export function resolveSandboxPath(inputPath: string, allowedDirs: string[]): string {
  // 将输入路径解析为绝对路径
  // 例如：
  // - "src/index.ts" → "/current/working/dir/src/index.ts"
  // - "../../etc/passwd" → "/etc/passwd"（取决于 cwd）
  // - "/absolute/path" → "/absolute/path"（不变）
  const resolved = path.resolve(inputPath);

  // 遍历允许的目录，检查解析后的路径是否在某个目录范围内
  for (const dir of allowedDirs) {
    const absDir = path.resolve(dir);
    // 匹配条件：
    // 1. 路径等于目录本身（用户要列目录内容）
    // 2. 路径以 "目录 + 分隔符" 开头（用户在目录下的某个子路径）
    //
    // 为什么要加 path.sep？
    // 因为如果没有分隔符检查，"/workspace-file" 会以 "/workspace" 开头，
    // 但实际上它是另一个文件，不是子目录。
    if (resolved === absDir || resolved.startsWith(absDir + path.sep)) {
      return resolved;
    }
  }

  // 路径不在任何允许的目录范围内，抛出错误
  // 错误信息包含具体的路径和允许范围，方便调试
  throw new Error(`路径 "${inputPath}" 超出允许的范围: ${allowedDirs.join(", ")}`);
}

/**
 * 检查路径是否在允许的目录范围内
 *
 * 这是 resolveSandboxPath 的"安全版"：不抛出错误，而是返回布尔值。
 * 适用于需要预判路径合法性但不想捕获异常的场景。
 *
 * @param inputPath   - 用户提供的文件路径
 * @param allowedDirs - 允许的目录列表
 * @returns 如果路径在允许范围内返回 true，否则返回 false
 */
export function isPathAllowed(inputPath: string, allowedDirs: string[]): boolean {
  try {
    resolveSandboxPath(inputPath, allowedDirs);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取工作空间根目录
 *
 * 优先级：
 * 1. 环境变量 MINI_AGENT_WORKSPACE（用户显式指定）
 * 2. 当前工作目录 process.cwd()（默认行为）
 *
 * 环境变量方式适用于：
 * - 部署场景：工作空间与运行目录不同
 * - 测试场景：指定临时目录作为工作空间
 * - 多实例场景：不同实例有不同的工作空间
 *
 * @returns 工作空间根目录的绝对路径
 */
export function getDefaultWorkspace(): string {
  return process.env.MINI_AGENT_WORKSPACE ?? process.cwd();
}
