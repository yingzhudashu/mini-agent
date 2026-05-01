/**
 * @file toolboxes.ts — 工具箱定义（更新版）
 * @description
 *   定义 Mini Agent 的默认工具箱。
 *
 *   新增 v4.2:
 *   - self_optimization: 自我优化能力
 *
 * @module toolboxes
 */

import type { Toolbox } from "./core/types.js";

/**
 * 默认工具箱列表
 */
export const DEFAULT_TOOLBOXES: Toolbox[] = [
  {
    id: "file_read",
    name: "文件读取",
    description: "读取文件和目录内容",
    keywords: ["读取", "查看", "文件", "目录", "list", "read", "查看内容"],
  },
  {
    id: "file_write",
    name: "文件写入",
    description: "创建、写入和编辑文件",
    keywords: ["写入", "创建", "编辑", "修改", "write", "create", "edit"],
  },
  {
    id: "dir_ops",
    name: "目录操作",
    description: "目录和文件管理：创建目录、移动、复制、删除",
    keywords: ["目录", "移动", "复制", "删除", "dir", "move", "copy", "delete"],
  },
  {
    id: "exec",
    name: "命令执行",
    description: "执行 shell 命令",
    keywords: ["命令", "执行", "shell", "终端", "exec", "run", "command"],
  },
  {
    id: "web",
    name: "网络访问",
    description: "网页抓取和网络请求",
    keywords: ["网页", "网络", "抓取", "http", "fetch", "url", "web"],
  },
  {
    id: "core",
    name: "核心能力",
    description: "时间查询等核心基础能力",
    keywords: ["时间", "日期", "时钟", "time", "date", "now"],
  },
  {
    id: "skills_management",
    name: "技能管理",
    description: "搜索、安装和管理技能包",
    keywords: ["技能", "skill", "搜索技能", "安装技能", "技能市场", "扩展能力", "clawhub"],
  },
  {
    id: "self_optimization",
    name: "自我优化",
    description: "Agent 自我审视、外部调研、生成优化提案、实施变更、运行测试验证",
    keywords: [
      "自我优化",
      "自我审视",
      "架构分析",
      "代码质量",
      "优化提案",
      "实施变更",
      "测试验证",
      "git 快照",
      "回滚",
      "self-optimization",
      "self-improvement",
      "self-inspect",
      "research",
      "proposal",
      "optimize",
      ".optimize",
    ],
  },
];
