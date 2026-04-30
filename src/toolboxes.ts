/**
 * @file toolboxes.ts — 工具箱定义
 * @description
 *   定义 Mini Agent v3 的默认工具箱。
 *
 *   工具箱是粗粒度的能力分组，与 v2 的 ToolCategory 不同：
 *   - v2 ToolCategory：贴在工具身上的标签，用于关键词匹配筛选
 *   - v3 Toolbox：独立的能力描述，用于 Phase 1 规划阶段
 *
 *   工具箱的作用：
 *   1. Phase 1 规划阶段：LLM 根据用户需求 + 工具箱描述，决定需要哪些能力
 *   2. Phase 2 执行阶段：根据规划结果，只发送相关工具箱的工具给 LLM
 *   3. 节省 token：减少 LLM 输入中不必要的 schema 描述
 *
 *   每个工具箱包含：
 *   - id：唯一标识，与工具定义中的 toolbox 字段对应
 *   - name：中文名称，供人类阅读
 *   - description：能力描述，供 LLM 理解
 *   - keywords：关键词列表，辅助 LLM 匹配
 *
 * @module toolboxes
 */

import type { Toolbox } from "./core/types.js";

/**
 * 默认工具箱列表
 *
 * 共 6 个工具箱：
 *
 * | ID         | 名称   | 包含工具                              | 说明          |
 * |------------|--------|--------------------------------------|---------------|
 * | file_read  | 文件读取 | read_file                           | 只读文件内容   |
 * | file_write | 文件写入 | write_file, edit_file               | 创建/修改文件  |
 * | dir_ops    | 目录操作 | list_dir, create_dir, move_file, copy_file, delete_file | 文件系统管理 |
 * | exec       | 命令执行 | exec_command                        | shell 命令    |
 * | web        | 网络访问 | fetch_url                           | 网页抓取      |
 * | core       | 核心能力 | get_time                            | 基础内置能力   |
 */
export const DEFAULT_TOOLBOXES: Toolbox[] = [
  {
    id: "file_read",
    name: "文件读取",
    description: "读取任意文件内容，支持分页和行数限制。适合查看代码、配置文件、日志等。",
    keywords: ["读取", "打开文件", "查看内容", "文件内容", "read", "cat", "查看"],
  },
  {
    id: "file_write",
    name: "文件写入",
    description: "创建新文件、写入内容、精确替换文本。适合创建代码、配置文件、修改已有文件。",
    keywords: ["写入", "保存", "创建文件", "编辑", "修改文件", "替换", "write", "edit", "改"],
  },
  {
    id: "dir_ops",
    name: "目录操作",
    description: "列出目录、创建目录、移动/复制/删除文件和目录。完整的文件系统管理能力。",
    keywords: ["目录", "文件夹", "列出", "移动", "复制", "删除", "创建目录", "dir", "list", "move", "copy", "delete", "rm"],
  },
  {
    id: "exec",
    name: "命令执行",
    description: "执行 shell 命令，支持超时和工作目录设置。可以运行任意命令行程序。",
    keywords: ["执行", "命令", "运行", "shell", "exec", "run", "cmd", "终端", "bash"],
  },
  {
    id: "web",
    name: "网络访问",
    description: "抓取网页内容并提取文本，获取当前时间和日期。唯一的外部数据源。",
    keywords: ["网页", "网站", "网址", "链接", "抓取", "fetch", "url", "http", "https", "时间", "几点"],
  },
  {
    id: "core",
    name: "核心能力",
    description: "基础内置能力，如获取当前时间。不依赖外部 API 或文件系统。",
    keywords: [],
  },
];
