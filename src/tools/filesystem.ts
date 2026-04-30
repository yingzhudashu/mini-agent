/**
 * @file filesystem.ts — 文件系统工具集
 * @description
 *   提供 8 个文件操作工具，覆盖日常开发中所有文件管理需求：
 *
 *   | 工具          | 功能       | 权限            | 风险  |
 *   |---------------|-----------|----------------|-------|
 *   | read_file     | 读取文件内容   | sandbox        | 低    |
 *   | write_file    | 写入/创建文件  | sandbox        | 低    |
 *   | edit_file     | 精确替换文本   | sandbox        | 中    |
 *   | list_dir      | 列出目录内容   | sandbox        | 低    |
 *   | create_dir    | 创建目录      | sandbox        | 低    |
 *   | move_file     | 移动/重命名文件 | sandbox       | 中    |
 *   | copy_file     | 复制文件      | sandbox        | 低    |
 *   | delete_file   | 删除文件/目录  | require-confirm | 高    |
 *
 *   安全设计：
 *   - 所有文件操作受路径沙箱保护，只能访问 allowedPaths 中的目录
 *   - delete_file 使用 "require-confirm" 权限，需要用户确认后才能执行
 *   - 其他工具使用 "sandbox" 权限，可安全自动执行
 *
 * @module tools/filesystem
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import { resolveSandboxPath, getDefaultWorkspace } from "../security/sandbox.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// 工具函数：获取允许的目录列表
// ============================================================================

/**
 * 根据上下文获取允许的目录列表
 *
 * 优先级：
 * 1. ctx.allowedPaths（如果显式设置了）
 * 2. getDefaultWorkspace()（默认工作空间）
 *
 * @param ctx - 工具执行上下文
 * @returns 允许的目录列表
 */
function allowedDirs(ctx: ToolContext): string[] {
  return ctx.allowedPaths.length > 0 ? ctx.allowedPaths : [getDefaultWorkspace()];
}

// ============================================================================
// 工具 1: read_file — 读取文件内容
// ============================================================================

/**
 * read_file 工具的 OpenAI schema 定义
 *
 * LLM 根据这个 schema 理解：
 * - 工具叫什么（name）
 * - 工具能做什么（description）
 * - 需要提供哪些参数（parameters.properties + required）
 * - 每个参数的含义（properties 中的 description）
 */
const readFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "读取文件内容",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        offset: { type: "number", description: "起始行号（1-indexed），用于读取大文件的一部分" },
        limit: { type: "number", description: "最大读取行数，防止一次性读取过多内容" },
      },
      required: ["path"],
    },
  },
};

/**
 * read_file 工具的处理器
 *
 * 功能：
 * 1. 验证路径安全性（沙箱检查）
 * 2. 读取文件内容
 * 3. 支持分页读取（offset + limit），避免大文件一次性读取过多
 * 4. 返回内容时附带行数信息
 *
 * @param args.path  - 文件路径（相对或绝对）
 * @param args.offset - 起始行号（可选，默认 1）
 * @param args.limit  - 最大行数（可选，默认 1000）
 */
async function readFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  // 解析并验证路径
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const offset = (args.offset as number) ?? 1;    // 默认从第 1 行开始
  const limit = (args.limit as number) ?? 1000;   // 默认最多 1000 行

  // 读取完整文件内容
  // 注意：这里是一次性读取，对于超大文件（>10MB）可能需要流式读取优化
  const raw = await fs.readFile(filePath, "utf-8");

  // 按行分割（支持 \n 和 \r\n）
  const lines = raw.split("\n");
  const total = lines.length;

  // 分页切片
  const sliced = lines.slice(offset - 1, offset - 1 + limit);
  const content = sliced.join("\n");

  // 如果只返回了部分内容，附加提示
  const note = sliced.length < total
    ? `\n... (共 ${total} 行，仅显示 ${sliced.length} 行，使用 offset/limit 翻页)`
    : "";

  return {
    success: true,
    content: content + note,
    meta: { totalLines: total, readLines: sliced.length },
  };
}

// ============================================================================
// 工具 2: write_file — 写入文件
// ============================================================================

const writeFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "写入文件（创建新文件或覆盖已有文件）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "要写入的内容" },
      },
      required: ["path", "content"],
    },
  },
};

/**
 * write_file 工具的处理器
 *
 * 功能：
 * 1. 验证路径安全性
 * 2. 自动创建父目录（如果不存在）
 * 3. 写入文件内容
 *
 * 安全考虑：
 * - 允许覆盖已有文件，所以使用时需要小心
 * - 当前使用 "sandbox" 权限，因为覆盖文件是常见的开发操作
 * - 如果未来需要更强的安全，可以升级为 "require-confirm"（仅对已有文件）
 */
async function writeFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const content = args.content as string;

  // 自动创建父目录（recursive: true 表示中间目录不存在也一并创建）
  // 例如：写入 "a/b/c/file.txt" 时，如果 a/b/ 不存在，会自动创建
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // 写入文件
  await fs.writeFile(filePath, content, "utf-8");

  return { success: true, content: `✅ 已写入 ${filePath} (${content.length} 字节)` };
}

// ============================================================================
// 工具 3: edit_file — 精确替换文本
// ============================================================================

const editFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "edit_file",
    description: "精确替换文件中的文本（只替换唯一匹配的一处）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        oldText: { type: "string", description: "要替换的原文（必须在文件中精确且唯一匹配）" },
        newText: { type: "string", description: "替换为的新文本" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
};

/**
 * edit_file 工具的处理器
 *
 * 这是最实用的文件修改工具。与 write_file 的区别：
 * - write_file：覆盖整个文件（适合创建新文件）
 * - edit_file：只替换文件中的一部分（适合小范围修改）
 *
 * 设计原则：
 * - 要求 oldText 在文件中只出现一次，防止误替换
 * - 如果出现 0 次：报错"未找到"
 * - 如果出现多次：报错"多处匹配"，要求用户提供更精确的 oldText
 *
 * 为什么不使用正则表达式？
 * - 正则太灵活但不可控，LLM 生成的正则可能有安全隐患
 * - 精确匹配更安全，行为可预测
 */
async function editFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const oldText = args.oldText as string;
  const newText = args.newText as string;

  // 读取文件内容
  const content = await fs.readFile(filePath, "utf-8");

  // 统计 oldText 在文件中出现的次数
  // split(oldText).length - 1 是 JS 中统计子串出现次数的经典技巧
  const occurrences = content.split(oldText).length - 1;

  // 0 次匹配 → 未找到
  if (occurrences === 0) {
    return { success: false, content: `❌ 未找到匹配的文本: "${oldText.slice(0, 50)}..."` };
  }

  // 多次匹配 → 不唯一，拒绝替换
  if (occurrences > 1) {
    return { success: false, content: `❌ 找到 ${occurrences} 处匹配，请提供更精确的 oldText` };
  }

  // 恰好 1 次匹配 → 执行替换
  const updated = content.replace(oldText, newText);
  await fs.writeFile(filePath, updated, "utf-8");

  return { success: true, content: `✅ 已替换 1 处 (${oldText.length} → ${newText.length} 字符)` };
}

// ============================================================================
// 工具 4: list_dir — 列出目录内容
// ============================================================================

const listDirSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "list_dir",
    description: "列出目录内容（文件和子目录）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
        recursive: { type: "boolean", description: "是否递归列出所有子目录内容（默认 false）" },
      },
      required: ["path"],
    },
  },
};

/**
 * list_dir 工具的处理器
 *
 * 功能：
 * 1. 验证路径
 * 2. 检查路径是否为目录
 * 3. 列出内容（可选递归）
 *
 * 递归模式使用同步 API（fsSync.readdirSync）而非异步，
 * 因为递归遍历需要按顺序访问目录树，同步代码更简洁易读。
 * 对于深度较大的目录树，递归深度受 Node.js 调用栈限制，
 * 但一般的项目目录（<50 层）不会有问题。
 */
async function listDirHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const dirPath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive as boolean;

  // 检查路径是否存在且是目录
  if (!fsSync.existsSync(dirPath) || !fsSync.statSync(dirPath).isDirectory()) {
    return { success: false, content: `❌ 目录不存在: ${dirPath}` };
  }

  // 递归模式：使用同步递归遍历
  if (recursive) {
    const entries: string[] = [];
    /**
     * 递归读取目录
     * @param dir - 当前目录路径
     * @param prefix - 缩进前缀（用于树形展示）
     */
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
    // 限制最多 200 条，防止输出过长
    return { success: true, content: entries.slice(0, 200).join("\n") };
  }

  // 非递归模式：只列当前层
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? "📁 " : "📄 "}${e.name}`);
  return { success: true, content: lines.join("\n") };
}

// ============================================================================
// 工具 5: create_dir — 创建目录
// ============================================================================

const createDirSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_dir",
    description: "创建新目录",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
        recursive: { type: "boolean", description: "是否递归创建父目录（默认 true）" },
      },
      required: ["path"],
    },
  },
};

/**
 * create_dir 工具的处理器
 *
 * recursive 默认 true：创建 "a/b/c" 时，如果 a/ 和 a/b/ 不存在，会自动一并创建。
 * 这符合用户直觉——用户说"创建 a/b/c"时，通常不希望因为 a/ 不存在而失败。
 */
async function createDirHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const dirPath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive ?? true;
  await fs.mkdir(dirPath, { recursive: recursive as boolean });
  return { success: true, content: `✅ 已创建目录: ${dirPath}` };
}

// ============================================================================
// 工具 6: move_file — 移动/重命名文件
// ============================================================================

const moveFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "move_file",
    description: "移动文件或重命名",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "源文件路径" },
        to: { type: "string", description: "目标文件路径" },
      },
      required: ["from", "to"],
    },
  },
};

/**
 * move_file 工具的处理器
 *
 * fs.rename() 在同文件系统是原子操作（瞬间完成，无中间状态）。
 * 跨文件系统时会退化为复制+删除。
 *
 * 自动创建目标路径的父目录，避免"目标目录不存在"的错误。
 */
async function moveFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = resolveSandboxPath(args.from as string, allowedDirs(ctx));
  const to = resolveSandboxPath(args.to as string, allowedDirs(ctx));
  // 确保目标路径的父目录存在
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return { success: true, content: `✅ 已移动: ${from} → ${to}` };
}

// ============================================================================
// 工具 7: copy_file — 复制文件
// ============================================================================

const copyFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "copy_file",
    description: "复制文件",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "源文件路径" },
        to: { type: "string", description: "目标文件路径" },
      },
      required: ["from", "to"],
    },
  },
};

/**
 * copy_file 工具的处理器
 *
 * fs.copyFile() 使用底层 OS 的 copy 系统调用（如 Linux 的 copy_file_range），
 * 比 read + write 的方式更高效。
 */
async function copyFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = resolveSandboxPath(args.from as string, allowedDirs(ctx));
  const to = resolveSandboxPath(args.to as string, allowedDirs(ctx));
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return { success: true, content: `✅ 已复制: ${from} → ${to}` };
}

// ============================================================================
// 工具 8: delete_file — 删除文件/目录
// ============================================================================

const deleteFileSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "delete_file",
    description: "删除文件或目录（危险操作！）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要删除的文件或目录路径" },
        recursive: { type: "boolean", description: "如果是目录，是否递归删除内容（默认 false）" },
      },
      required: ["path"],
    },
  },
};

/**
 * delete_file 工具的处理器
 *
 * 这是唯一使用 "require-confirm" 权限的工具。
 *
 * 安全设计：
 * 1. 沙箱保护：只能删除 allowedPaths 中的文件
 * 2. 递归保护：删除目录时必须显式设置 recursive=true
 * 3. 没有"回收站"功能：删除是永久的（这是设计选择，避免复杂度）
 *
 * 未来可以考虑：
 * - 集成 trash 包（npm install trash），将文件移入系统回收站而非永久删除
 * - 添加 dry-run 模式：先列出会被删除的文件，确认后真正删除
 */
async function deleteFileHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = resolveSandboxPath(args.path as string, allowedDirs(ctx));
  const recursive = args.recursive as boolean;
  const stat = await fs.stat(filePath);

  if (stat.isDirectory()) {
    if (!recursive) return { success: false, content: `❌ 删除目录需设置 recursive=true` };
    await fs.rm(filePath, { recursive: true });
  } else {
    await fs.unlink(filePath);
  }

  return { success: true, content: `✅ 已删除: ${filePath}` };
}

// ============================================================================
// 导出所有文件系统工具
// ============================================================================

/**
 * 文件系统工具注册表
 *
 * key 为工具名称，value 为 ToolDefinition 对象。
 * 在 cli.ts 中通过 Object.entries() 遍历并注册到 registry。
 *
 * 权限分配策略：
 * - read/list/create/copy/move → "sandbox"（安全操作）
 * - write/edit → "sandbox"（常见开发操作，但有一定风险）
 * - delete → "require-confirm"（破坏性操作，必须确认）
 */
export const filesystemTools: Record<string, ToolDefinition> = {
  read_file: { schema: readFileSchema, handler: readFileHandler, permission: "sandbox", help: "读取文件内容" },
  write_file: { schema: writeFileSchema, handler: writeFileHandler, permission: "sandbox", help: "写入/创建文件" },
  edit_file: { schema: editFileSchema, handler: editFileHandler, permission: "sandbox", help: "精确替换文件中的文本" },
  list_dir: { schema: listDirSchema, handler: listDirHandler, permission: "sandbox", help: "列出目录内容" },
  create_dir: { schema: createDirSchema, handler: createDirHandler, permission: "sandbox", help: "创建目录" },
  move_file: { schema: moveFileSchema, handler: moveFileHandler, permission: "sandbox", help: "移动/重命名文件" },
  copy_file: { schema: copyFileSchema, handler: copyFileHandler, permission: "sandbox", help: "复制文件" },
  delete_file: { schema: deleteFileSchema, handler: deleteFileHandler, permission: "require-confirm", help: "删除文件/目录（危险）" },
};
