/**
 * @file git-snapshot.ts — Git 快照管理器 (Phase 5)
 * @module core/self-opt/git-snapshot
 */
import { spawn } from "node:child_process";

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => resolve({ stdout: out, stderr: err, exitCode: code ?? 1 }));
    child.on("error", e => { err += e.message; resolve({ stdout: out, stderr: err, exitCode: 1 }); });
  });
}

export async function isInGitRepo(cwd: string): Promise<boolean> { const r = await runGit(["rev-parse", "--git-dir"], cwd); return r.exitCode === 0; }
export async function hasUncommittedChanges(cwd: string): Promise<boolean> { const r = await runGit(["status", "--porcelain"], cwd); return r.stdout.trim().length > 0; }

export async function createSnapshot(cwd: string, msg: string): Promise<string | null> {
  try {
    await runGit(["stash", "push", "--include-untracked", "-m", "self-opt-stash-" + Date.now()], cwd);
    await runGit(["add", "-A"], cwd);
    const cr = await runGit(["commit", "-m", "[self-opt-snapshot] " + msg, "--no-verify"], cwd);
    const hr = await runGit(["rev-parse", "HEAD"], cwd);
    return hr.exitCode === 0 ? hr.stdout.trim() || null : null;
  } catch { return null; }
}

export async function revertToSnapshot(cwd: string, hash: string): Promise<{ success: boolean; error?: string }> {
  try {
    const chk = await runGit(["cat-file", "-t", hash], cwd);
    if (chk.exitCode !== 0) return { success: false, error: "快照不存在" };
    const parent = await runGit(["rev-parse", hash + "^"], cwd);
    if (parent.exitCode !== 0) return { success: false, error: "无父提交" };
    const reset = await runGit(["reset", "--hard", parent.stdout.trim()], cwd);
    return reset.exitCode === 0 ? { success: true } : { success: false, error: reset.stderr };
  } catch (e: any) { return { success: false, error: e?.message }; }
}

export async function finalizeSnapshot(cwd: string, hash: string, msg: string): Promise<boolean> {
  try { const r = await runGit(["commit", "--amend", "-m", msg, "--no-verify"], cwd); return r.exitCode === 0; } catch { return false; }
}
export async function getCurrentHead(cwd: string): Promise<string | null> { try { const r = await runGit(["rev-parse", "HEAD"], cwd); return r.exitCode === 0 ? r.stdout.trim() : null; } catch { return null; } }
export async function getRecentCommits(cwd: string, n = 10): Promise<{ hash: string; message: string; date: string }[]> {
  try { const r = await runGit(["log", "--max-count=" + n, "--pretty=format:%H|%s|%ai"], cwd); if (r.exitCode !== 0) return []; return r.stdout.trim().split("\n").filter(Boolean).map(l => { const [h, m, d] = l.split("|"); return { hash: h || "", message: m || "", date: d || "" }; }); } catch { return []; }
}
