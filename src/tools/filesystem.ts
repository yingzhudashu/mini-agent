/**
 * Filesystem tools: read_file, write_file, edit_file, list_dir, create_dir, move_file, copy_file, delete_file
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import { resolveSandboxPath, getDefaultWorkspace } from "../security/sandbox.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

function allowedDirs(ctx: ToolContext): string[] {
  return ctx.allowedPaths.length > 0 ? ctx.allowedPaths : [getDefaultWorkspace()];
}

// ── read_file ──
const readFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "读取文件内容",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        offset: { type: "number", description: "起始行号（1-indexed）" },
        limit: { type: "number", description: "最大读取行数" },
      },
      required: ["path"],
    },
  },
};

async function readFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const offset = (args.offset as number) ?? 1;
  const limit = (args.limit as number) ?? 1000;

  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n");
  const sliced = lines.slice(offset - 1, offset - 1 + limit);
  const total = lines.length;
  const content = sliced.join("\n");
  const note = sliced.length < total ? `\n... (共 ${total} 行，仅显示 ${sliced.length} 行)` : "";

  return {
    success: true,
    content: content + note,
    meta: { totalLines: total, readLines: sliced.length },
  };
}

// ── write_file ──
const writeFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "写入文件（创建或覆盖）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
};

async function writeFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const content = args.content as string;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return { success: true, content: `✅ 已写入 ${filePath} (${content.length} 字节)` };
}

// ── edit_file — precise text replacement ──
const editFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "edit_file",
    description: "精确替换文件中的文本",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        oldText: { type: "string", description: "要替换的原文（必须精确匹配）" },
        newText: { type: "string", description: "替换为的新文本" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
};

async function editFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const oldText = args.oldText as string;
  const newText = args.newText as string;

  const content = await fs.readFile(filePath, "utf-8");
  const occurrences = content.split(oldText).length - 1;

  if (occurrences === 0) {
    return { success: false, content: `❌ 未找到匹配的文本: "${oldText.slice(0, 50)}..."` };
  }
  if (occurrences > 1) {
    return { success: false, content: `❌ 找到 ${occurrences} 处匹配，请提供更精确的 oldText` };
  }

  const updated = content.replace(oldText, newText);
  await fs.writeFile(filePath, updated, "utf-8");
  return { success: true, content: `✅ 已替换 1 处 (${oldText.length} → ${newText.length} 字符)` };
}

// ── list_dir ──
const listDirSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "list_dir",
    description: "列出目录内容",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
        recursive: { type: "boolean", description: "是否递归列出" },
      },
      required: ["path"],
    },
  },
};

async function listDirHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const dirPath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive as boolean;

  if (!fsSync.existsSync(dirPath) || !fsSync.statSync(dirPath).isDirectory()) {
    return { success: false, content: `❌ 目录不存在: ${dirPath}` };
  }

  if (recursive) {
    const entries: string[] = [];
    const readRecursive = (dir: string, prefix: string) => {
      const items = fsSync.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        entries.push(`${prefix}${item.isDirectory() ? "📁 " : "📄 "}${item.name}`);
        if (item.isDirectory()) {
          readRecursive(path.join(dir, item.name), prefix + "  ");
        }
      }
    };
    readRecursive(dirPath, "");
    return { success: true, content: entries.slice(0, 200).join("\n") };
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? "📁 " : "📄 "}${e.name}`);
  return { success: true, content: lines.join("\n") };
}

// ── create_dir ──
const createDirSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_dir",
    description: "创建目录",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
        recursive: { type: "boolean", description: "是否递归创建父目录" },
      },
      required: ["path"],
    },
  },
};

async function createDirHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const dirPath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive ?? true;
  await fs.mkdir(dirPath, { recursive: recursive as boolean });
  return { success: true, content: `✅ 已创建目录: ${dirPath}` };
}

// ── move_file ──
const moveFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "move_file",
    description: "移动或重命名文件",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "源路径" },
        to: { type: "string", description: "目标路径" },
      },
      required: ["from", "to"],
    },
  },
};

async function moveFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = resolveSandboxPath(args.from as string, allowedDirs(ctx));
  const to = resolveSandboxPath(args.to as string, allowedDirs(ctx));
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return { success: true, content: `✅ 已移动: ${from} → ${to}` };
}

// ── copy_file ──
const copyFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "copy_file",
    description: "复制文件",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "源路径" },
        to: { type: "string", description: "目标路径" },
      },
      required: ["from", "to"],
    },
  },
};

async function copyFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = resolveSandboxPath(args.from as string, allowedDirs(ctx));
  const to = resolveSandboxPath(args.to as string, allowedDirs(ctx));
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return { success: true, content: `✅ 已复制: ${from} → ${to}` };
}

// ── delete_file ──
const deleteFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "delete_file",
    description: "删除文件或目录",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要删除的路径" },
        recursive: { type: "boolean", description: "是否递归删除目录" },
      },
      required: ["path"],
    },
  },
};

async function deleteFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive as boolean;
  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) {
    if (!recursive) return { success: false, content: `❌ 目录需设置 recursive=true` };
    await fs.rm(filePath, { recursive: true });
  } else {
    await fs.unlink(filePath);
  }
  return { success: true, content: `✅ 已删除: ${filePath}` };
}

// ── Export all ──
export const filesystemTools: Record<string, ToolDefinition> = {
  read_file: { schema: readFileSchema, handler: readFileHandler, permission: "sandbox", help: "读取文件内容" },
  write_file: { schema: writeFileSchema, handler: writeFileHandler, permission: "sandbox", help: "写入文件" },
  edit_file: { schema: editFileSchema, handler: editFileHandler, permission: "sandbox", help: "精确替换文件文本" },
  list_dir: { schema: listDirSchema, handler: listDirHandler, permission: "sandbox", help: "列出目录" },
  create_dir: { schema: createDirSchema, handler: createDirHandler, permission: "sandbox", help: "创建目录" },
  move_file: { schema: moveFileSchema, handler: moveFileHandler, permission: "sandbox", help: "移动/重命名文件" },
  copy_file: { schema: copyFileSchema, handler: copyFileHandler, permission: "sandbox", help: "复制文件" },
  delete_file: { schema: deleteFileSchema, handler: deleteFileHandler, permission: "require-confirm", help: "删除文件/目录" },
};
