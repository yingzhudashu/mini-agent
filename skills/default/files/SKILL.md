---
name: 文件操作
description: 提供完整的文件读写、编辑、目录管理能力
keywords: 文件,读写,编辑,目录,filesystem,file,read,write
---

# 文件操作技能

## 概述

提供 8 个文件操作工具，覆盖日常开发中所有文件管理需求：

- `read_file` — 读取文件内容（支持分页）
- `write_file` — 写入/创建文件
- `edit_file` — 精确替换文件中的文本
- `list_dir` — 列出目录内容
- `create_dir` — 创建目录
- `move_file` — 移动/重命名文件
- `copy_file` — 复制文件
- `delete_file` — 删除文件/目录

## 安全设计

- 所有文件操作受路径沙箱保护
- `delete_file` 需要用户确认后才能执行
- 其他操作可在沙箱内自动执行

## 工具定义

工具定义位于 `src/tools/filesystem.ts` 中的 `filesystemTools` 对象。
