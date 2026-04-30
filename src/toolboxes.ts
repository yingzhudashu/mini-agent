import type { Toolbox } from "./core/types.js";

export const DEFAULT_TOOLBOXES: Toolbox[] = [
  {
    id: "file_read",
    name: "文件读取",
    description: "读取任意文件内容，支持分页和行数限制",
    keywords: ["读取", "打开文件", "查看内容", "文件内容", "read", "cat", "查看"],
  },
  {
    id: "file_write",
    name: "文件写入",
    description: "创建新文件、写入内容、精确替换文本",
    keywords: ["写入", "保存", "创建文件", "编辑", "修改文件", "替换", "write", "edit", "改"],
  },
  {
    id: "dir_ops",
    name: "目录操作",
    description: "列出目录、创建目录、移动/复制/删除文件和目录",
    keywords: ["目录", "文件夹", "列出", "移动", "复制", "删除", "创建目录", "dir", "list", "move", "copy", "delete", "rm"],
  },
  {
    id: "exec",
    name: "命令执行",
    description: "执行 shell 命令，支持超时和工作目录",
    keywords: ["执行", "命令", "运行", "shell", "exec", "run", "cmd", "终端", "bash"],
  },
  {
    id: "web",
    name: "网络访问",
    description: "抓取网页内容、获取当前时间",
    keywords: ["网页", "网站", "网址", "链接", "抓取", "fetch", "url", "http", "https", "时间", "几点"],
  },
  {
    id: "core",
    name: "核心能力",
    description: "基础能力，始终可用",
    keywords: [],
  },
];
