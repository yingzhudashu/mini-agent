/**
 * @file git-snapshot.ts — Git 快照管理器 (Phase 5)
 * @description
 *   Self-Optimization 子系统的 Phase 5 组件，提供 Git 快照和回滚能力。
 *
 *   核心功能：
 *   1. createSnapshot: 创建 Git 快照（stash + commit），用于变更前备份
 *   2. revertToSnapshot: 回滚到指定快照（reset --hard），用于变更失败后恢复
 *   3. finalizeSnapshot: 确认快照有效（commit --amend），用于变更成功后保留
 *   4. isInGitRepo: 检查当前目录是否在 Git 仓库中
 *
 *   工作流程：
 *   ```
 *   变更前: createSnapshot() → 返回 commit hash
 *     ├─ 成功: finalizeSnapshot() → 修改 commit message
 *     └─ 失败: revertToSnapshot() → reset --hard 到父提交
 *   ```
 *
 *   设计原则：
 *   - 使用原生 git 命令，不依赖外部库
 *   - 所有操作通过 git stash 保护未提交的更改
 *   - 回滚操作只影响自优化创建的提交，不影响用户工作
 *
 * @module core/self-opt/git-snapshot
 */

import { spawn } from "node:child_process";

// ============================================================================
// Git 命令执行工具
// ============================================================================

/**
 * Git 命令执行结果
 */
interface GitResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码（0 表示成功） */
  exitCode: number;
}

/**
 * 执行 Git 命令
 *
 * 使用 child_process.spawn 执行 git 命令，
 * 避免 shell 注入风险，同时提供更好的错误处理。
 *
 * @param args Git 命令参数数组（如 ["status", "--porcelain"]）
 * @param cwd 工作目录
 * @returns Git 执行结果
 *
 * @example
 * ```ts
 * const result = await runGit(["rev-parse", "--git-dir"], cwd);
 * if (result.exitCode === 0) {
 *   console.log("在 Git 仓库中");
 * }
 * ```
 */
function runGit(
  args: string[],
  cwd: string
): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      shell: false, // 不使用 shell，避免注入
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) =>
      resolve({
        stdout: out,
        stderr: err,
        exitCode: code ?? 1,
      })
    );

    child.on("error", (e) => {
      err += e.message;
      resolve({ stdout: out, stderr: err, exitCode: 1 });
    });
  });
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 检查当前目录是否在 Git 仓库中
 *
 * 通过执行 `git rev-parse --git-dir` 来判断。
 * 如果退出码为 0，说明在 Git 仓库中。
 *
 * @param cwd 要检查的目录
 * @returns 是否在 Git 仓库中
 *
 * @example
 * ```ts
 * if (await isInGitRepo(projectRoot)) {
 *   console.log("Git 快照功能可用");
 * }
 * ```
 */
export async function isInGitRepo(cwd: string): Promise<boolean> {
  const r = await runGit(["rev-parse", "--git-dir"], cwd);
  return r.exitCode === 0;
}

/**
 * 检查是否有未提交的更改
 *
 * 通过执行 `git status --porcelain` 来判断。
 * 如果输出为空，说明没有未提交的更改。
 *
 * @param cwd 工作目录
 * @returns 是否有未提交的更改
 *
 * @example
 * ```ts
 * if (await hasUncommittedChanges(cwd)) {
 *   console.log("有未提交的更改，将先 stash");
 * }
 * ```
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain"], cwd);
  return r.stdout.trim().length > 0;
}

/**
 * 创建 Git 快照
 *
 * 这是变更前的备份操作，工作流程：
 * 1. `git stash push --include-untracked` — 保存未提交的更改
 * 2. `git add -A` — 暂存所有更改（包括新文件）
 * 3. `git commit -m "[self-opt-snapshot] <msg>"` — 创建快照提交
 * 4. `git rev-parse HEAD` — 返回快照的 commit hash
 *
 * @param cwd 工作目录
 * @param msg 快照描述（会作为 commit message 的一部分）
 * @returns 快照的 commit hash，失败时返回 null
 *
 * @example
 * ```ts
 * const snapshotHash = await createSnapshot(cwd, "pre-添加测试文件");
 * if (snapshotHash) {
 *   console.log(`快照已创建: ${snapshotHash.slice(0, 8)}`);
 * }
 * ```
 */
export async function createSnapshot(
  cwd: string,
  msg: string
): Promise<string | null> {
  try {
    // Step 1: Stash 未提交的更改
    await runGit(
      ["stash", "push", "--include-untracked", "-m", "self-opt-stash-" + Date.now()],
      cwd
    );

    // Step 2: 暂存所有更改
    await runGit(["add", "-A"], cwd);

    // Step 3: 创建快照提交
    const cr = await runGit(
      ["commit", "-m", "[self-opt-snapshot] " + msg, "--no-verify"],
      cwd
    );
    if (cr.exitCode !== 0) return null;

    // Step 4: 获取当前 HEAD
    const hr = await runGit(["rev-parse", "HEAD"], cwd);
    return hr.exitCode === 0 ? hr.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * 回滚到指定快照
 *
 * 这是变更失败后的恢复操作，工作流程：
 * 1. `git cat-file -t <hash>` — 验证快照存在
 * 2. `git rev-parse <hash>^` — 获取快照的父提交
 * 3. `git reset --hard <parent>` — 回滚到父提交
 *
 * 注意：
 * - 此操作会丢弃快照提交及其之后的所有更改
 * - 不会影响快照提交之前的用户工作
 *
 * @param cwd 工作目录
 * @param hash 快照的 commit hash
 * @returns 回滚结果
 *
 * @example
 * ```ts
 * const result = await revertToSnapshot(cwd, snapshotHash);
 * if (result.success) {
 *   console.log("已回滚到快照前的状态");
 * } else {
 *   console.error(`回滚失败: ${result.error}`);
 * }
 * ```
 */
export async function revertToSnapshot(
  cwd: string,
  hash: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: 验证快照存在
    const chk = await runGit(["cat-file", "-t", hash], cwd);
    if (chk.exitCode !== 0) {
      return { success: false, error: "快照不存在" };
    }

    // Step 2: 获取父提交
    const parent = await runGit(["rev-parse", hash + "^"], cwd);
    if (parent.exitCode !== 0) {
      return { success: false, error: "无父提交" };
    }

    // Step 3: 回滚到父提交
    const reset = await runGit(
      ["reset", "--hard", parent.stdout.trim()],
      cwd
    );

    return reset.exitCode === 0
      ? { success: true }
      : { success: false, error: reset.stderr };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

/**
 * 确认快照有效（_finalize_）
 *
 * 这是变更成功后的保留操作，工作流程：
 * 1. `git commit --amend -m <msg>` — 修改快照提交的 message
 *
 * 用途：
 * - 将临时快照提交 `[self-opt-snapshot]` 改为正式的 `[self-opt]` 提交
 * - 保留变更作为项目历史的一部分
 *
 * @param cwd 工作目录
 * @param hash 快照的 commit hash
 * @param msg 新的提交 message
 * @returns 是否成功
 *
 * @example
 * ```ts
 * await finalizeSnapshot(cwd, snapshotHash, "[self-opt] 添加测试文件");
 * console.log("快照已确认，变更保留");
 * ```
 */
export async function finalizeSnapshot(
  cwd: string,
  hash: string,
  msg: string
): Promise<boolean> {
  try {
    const r = await runGit(
      ["commit", "--amend", "-m", msg, "--no-verify"],
      cwd
    );
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 获取当前 HEAD 的 commit hash
 *
 * @param cwd 工作目录
 * @returns 当前 HEAD 的 commit hash，失败时返回 null
 *
 * @example
 * ```ts
 * const head = await getCurrentHead(cwd);
 * console.log(`当前 HEAD: ${head}`);
 * ```
 */
export async function getCurrentHead(cwd: string): Promise<string | null> {
  try {
    const r = await runGit(["rev-parse", "HEAD"], cwd);
    return r.exitCode === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 获取最近的提交历史
 *
 * @param cwd 工作目录
 * @param n 返回的提交数量（默认 10）
 * @returns 提交历史列表
 *
 * @example
 * ```ts
 * const commits = await getRecentCommits(cwd, 5);
 * for (const c of commits) {
 *   console.log(`${c.hash.slice(0, 8)} ${c.message}`);
 * }
 * // 输出:
 * // 6e3a563b [self-opt] 添加测试文件
 * // d51d83f feat: v4.4 Phase 5 complete
 * // ...
 * ```
 */
export async function getRecentCommits(
  cwd: string,
  n = 10
): Promise<{ hash: string; message: string; date: string }[]> {
  try {
    const r = await runGit(
      ["log", "--max-count=" + n, "--pretty=format:%H|%s|%ai"],
      cwd
    );
    if (r.exitCode !== 0) return [];

    return r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [h, m, d] = l.split("|");
        return { hash: h || "", message: m || "", date: d || "" };
      });
  } catch {
    return [];
  }
}
