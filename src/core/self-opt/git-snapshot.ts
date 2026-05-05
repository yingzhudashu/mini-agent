/**
 * @file git-snapshot.ts - Git 分支快照管理器 (Phase 5.4 升级)
 * @description
 *   Self-Optimization 子系统的 Phase 5 组件。提供 Git 快照和回滚功能。
 *
 *   Phase 5.4 升级：
 *   - createSnapshot 改用新分支（git checkout -b self-opt/<timestamp>）而非 stash
 *   - revertToSnapshot 改为 git checkout main && git branch -D <branch>
 *   - 避免 reset --hard 导致的未提交改动丢失
 *   - 增加分支隔离，不影响主分支
 *
 *   核心功能：
 *   1. createSnapshot: 创建 Git 快照分支，保存当前状态
 *   2. revertToSnapshot: 删除快照分支，回退到主分支
 *   3. finalizeSnapshot: 合并快照分支到主分支，清理
 *   4. isInGitRepo: 检查当前目录是否在 Git 仓库中
 *
 *   工作流程：
 *   ```
 *   优化前: createSnapshot() → 创建分支 self-opt/<timestamp>
 *     优化成功: finalizeSnapshot() → 合并到主分支
 *     优化失败: revertToSnapshot() → 删除分支，回到主分支
 *   ```
 *
 *   设计原则
 *   - 使用原生 git 命令，不依赖外部库
 *   - 通过分支隔离，保护用户未提交的改动
 *   - 回滚操作只影响优化相关的提交，不影响用户代码
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
 * 避免 shell 注入风险，同时提供完整的错误处理
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
// 公开 API
// ============================================================================

/**
 * 快照信息
 */
export interface SnapshotInfo {
  /** 快照分支名 */
  branchName: string;
  /** 创建时间 */
  createdAt: string;
  /** 快照前主分支 HEAD */
  baseCommit: string;
  /** 是否在当前分支上 */
  isCurrentBranch: boolean;
}

/**
 * 分支前缀
 */
const BRANCH_PREFIX = "self-opt";

/**
 * 生成快照分支名
 */
function generateBranchName(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return BRANCH_PREFIX + "/" + ts;
}

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
 * 检查是否有未提交的改动
 *
 * 通过执行 `git status --porcelain` 来判断。
 * 如果输出为空，说明没有未提交的改动。
 *
 * @param cwd 工作目录
 * @returns 是否有未提交的改动
 *
 * @example
 * ```ts
 * if (await hasUncommittedChanges(cwd)) {
 *   console.log("有未提交的改动，需要 stash");
 * }
 * ```
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain"], cwd);
  return r.stdout.trim().length > 0;
}

/**
 * 获取当前分支名
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const r = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    return r.exitCode === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 获取当前 HEAD 的 commit hash
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
 * 创建 Git 快照（Phase 5.4 升级：使用分支隔离）
 *
 * Phase 5.4 升级：
 * - 旧方案：stash + commit + reset --hard（风险高，可能丢失改动）
 * - 新方案：创建新分支 self-opt/<timestamp>，在分支上提交，不影响主分支
 *
 * 备份当前状态的完整流程：
 * 1. 获取当前主分支 HEAD 作为 baseCommit
 * 2. 如果有未提交的改动，先 stash
 * 3. `git checkout -b self-opt/<timestamp>` 创建快照分支
 * 4. 返回快照信息
 *
 * @param cwd 工作目录
 * @param msg 快照描述（作为分支描述的一部分）
 * @returns 快照信息，失败时返回 null
 *
 * @example
 * ```ts
 * const snapshot = await createSnapshot(cwd, "pre-添加测试文件");
 * if (snapshot) {
 *   console.log(`快照已创建: ${snapshot.branchName}`);
 * }
 * ```
 */
export async function createSnapshot(
  cwd: string,
  msg: string
): Promise<SnapshotInfo | null> {
  try {
    // Step 1: 获取当前 HEAD
    const head = await getCurrentHead(cwd);
    if (!head) return null;

    const baseCommit = head;
    const branchName = generateBranchName();

    // Step 2: 如果有未提交的改动，先 stash 保护
    const hasChanges = await hasUncommittedChanges(cwd);
    if (hasChanges) {
      const stashResult = await runGit(
        ["stash", "push", "-m", "self-opt-stash-" + Date.now()],
        cwd
      );
      if (stashResult.exitCode !== 0) {
        console.warn("[git-snapshot] Stash 失败，但继续创建快照分支");
      }
    }

    // Step 3: 创建快照分支
    const branchResult = await runGit(
      ["checkout", "-b", branchName],
      cwd
    );
    if (branchResult.exitCode !== 0) {
      return null;
    }

    return {
      branchName,
      createdAt: new Date().toISOString(),
      baseCommit,
      isCurrentBranch: true,
    };
  } catch {
    return null;
  }
}

/**
 * 回滚到快照（Phase 5.4 升级：删除分支而非 reset --hard）
 *
 * Phase 5.4 升级：
 * - 旧方案：reset --hard <parent>（可能丢失未提交改动）
 * - 新方案：git checkout <baseBranch> && git branch -D <snapshotBranch>
 *
 * @param cwd 工作目录
 * @param snapshotInfo 快照信息
 * @param baseBranch 要回退到的分支名（默认 main 或 master）
 * @returns 回滚结果
 *
 * @example
 * ```ts
 * const result = await revertToSnapshot(cwd, snapshotInfo);
 * if (result.success) {
 *   console.log("已回滚到优化前的状态");
 * } else {
 *   console.error(`回滚失败: ${result.error}`);
 * }
 * ```
 */
export async function revertToSnapshot(
  cwd: string,
  snapshotInfo: SnapshotInfo | string,
  baseBranch?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const branchName = typeof snapshotInfo === "string" ? snapshotInfo : snapshotInfo.branchName;

    // 验证分支存在
    const checkBranch = await runGit(
      ["rev-parse", "--verify", branchName],
      cwd
    );
    if (checkBranch.exitCode !== 0) {
      return { success: false, error: "快照分支不存在" };
    }

    // 确定要回退到的目标分支
    const targetBranch = baseBranch || (await getDefaultBranch(cwd)) || "main";

    // 检查目标分支是否存在
    const checkTarget = await runGit(
      ["rev-parse", "--verify", targetBranch],
      cwd
    );
    if (checkTarget.exitCode !== 0) {
      return { success: false, error: "目标分支 " + targetBranch + " 不存在" };
    }

    // 切换到目标分支
    const checkoutResult = await runGit(
      ["checkout", targetBranch],
      cwd
    );
    if (checkoutResult.exitCode !== 0) {
      return { success: false, error: "切换到 " + targetBranch + " 失败" };
    }

    // 删除快照分支
    const deleteResult = await runGit(
      ["branch", "-D", branchName],
      cwd
    );
    if (deleteResult.exitCode !== 0) {
      console.warn("[git-snapshot] 删除快照分支失败: " + deleteResult.stderr);
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

/**
 * 确认快照有效（合并到主分支）
 *
 * Phase 5.4 升级：
 * - 旧方案：commit --amend 修改 message
 * - 新方案：合并快照分支到主分支，删除快照分支
 *
 * @param cwd 工作目录
 * @param snapshotInfo 快照信息
 * @param commitMsg 合并提交 message
 * @param baseBranch 目标分支（默认 main 或 master）
 * @returns 是否成功
 *
 * @example
 * ```ts
 * await finalizeSnapshot(cwd, snapshotInfo, "[self-opt] 添加测试文件");
 * console.log("快照已确认，合并到主分支");
 * ```
 */
export async function finalizeSnapshot(
  cwd: string,
  snapshotInfo: SnapshotInfo | string,
  commitMsg: string,
  baseBranch?: string
): Promise<boolean> {
  try {
    const branchName = typeof snapshotInfo === "string" ? snapshotInfo : snapshotInfo.branchName;

    // 确定目标分支
    const targetBranch = baseBranch || (await getDefaultBranch(cwd)) || "main";

    // 确保在目标分支上
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch !== targetBranch) {
      const checkoutResult = await runGit(["checkout", targetBranch], cwd);
      if (checkoutResult.exitCode !== 0) {
        return false;
      }
    }

    // 合并快照分支到目标分支
    const mergeResult = await runGit(
      ["merge", "--no-ff", branchName, "-m", commitMsg, "--no-verify"],
      cwd
    );
    if (mergeResult.exitCode !== 0) {
      console.error("[git-snapshot] 合并失败: " + mergeResult.stderr);
      return false;
    }

    // 删除快照分支
    await runGit(["branch", "-d", branchName], cwd);

    return true;
  } catch {
    return false;
  }
}

/**
 * 获取默认分支名（main 或 master）
 */
async function getDefaultBranch(cwd: string): Promise<string | null> {
  try {
    // 先尝试 main
    const mainCheck = await runGit(["rev-parse", "--verify", "main"], cwd);
    if (mainCheck.exitCode === 0) return "main";

    // 再尝试 master
    const masterCheck = await runGit(["rev-parse", "--verify", "master"], cwd);
    if (masterCheck.exitCode === 0) return "master";

    return null;
  } catch {
    return null;
  }
}

/**
 * 获取最近提交历史
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

/**
 * 列出所有 self-opt 快照分支
 */
export async function listSnapshots(cwd: string): Promise<string[]> {
  try {
    const r = await runGit(
      ["branch", "--list", BRANCH_PREFIX + "/*"],
      cwd
    );
    if (r.exitCode !== 0) return [];
    return r.stdout.trim().split("\n").map((b) => b.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 清理所有过期的 self-opt 分支
 * @param keepRecent 保留最近 N 个快照（默认 0，全部删除）
 */
export async function cleanupSnapshots(cwd: string, keepRecent = 0): Promise<number> {
  try {
    const branches = await listSnapshots(cwd);
    if (branches.length <= keepRecent) return 0;

    // 按创建时间排序（分支名包含时间戳）
    const sorted = branches.sort().reverse();
    const toDelete = keepRecent > 0 ? sorted.slice(keepRecent) : sorted;

    let deleted = 0;
    for (const branch of toDelete) {
      const r = await runGit(["branch", "-D", branch], cwd);
      if (r.exitCode === 0) deleted++;
    }
    return deleted;
  } catch {
    return 0;
  }
}
