/**
 * Path sandbox — ensures file operations stay within allowed directories.
 */
import path from "node:path";
import fs from "node:fs";

/**
 * Resolve and validate a file path against allowed directories.
 * @param inputPath - User-provided path
 * @param allowedDirs - List of allowed root directories
 * @returns Resolved absolute path or throws if outside sandbox
 */
export function resolveSandboxPath(inputPath: string, allowedDirs: string[]): string {
  const resolved = path.resolve(inputPath);
  for (const dir of allowedDirs) {
    const absDir = path.resolve(dir);
    if (resolved === absDir || resolved.startsWith(absDir + path.sep)) {
      return resolved;
    }
  }
  throw new Error(`路径 "${inputPath}" 超出允许的范围: ${allowedDirs.join(", ")}`);
}

/**
 * Check if a path is within the allowed directories.
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
 * Get the workspace root from environment or CWD.
 */
export function getDefaultWorkspace(): string {
  return process.env.MINI_AGENT_WORKSPACE ?? process.cwd();
}
