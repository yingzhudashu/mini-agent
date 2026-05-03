# Mini Agent v4.9 重构计划

> 目标：满足软件工程最佳实践，架构清晰，模块解耦，无冗余代码和文件
> 制定日期：2026-05-03

---

## 一、审计结果

### 1.1 冗余文件（必须清理）

| 文件 | 大小 | 问题 | 处理 |
|------|------|------|------|
| `src/cli.ts` | 508行/27KB | **完整副本**，与 `src/cli/cli.ts` 完全重复。上次 barrel export 未生效 | 改为 `export * from "./cli/cli.js"` |
| `test-feishu-ws.js` | 2KB | 根目录临时测试文件 | 删除 |
| `test-feishu-ws.mjs` | 1.7KB | 同上，.mjs 版本 | 删除 |
| `OPTIMIZATION_LOG.md` | 56KB | 自动生成日志（已在 .gitignore） | 删除 |

### 1.2 空目录（必须清理）

| 目录 | 处理 |
|------|------|
| `feishu/`（根目录，非 src/feishu/） | 删除 |
| `feishu/dedup/` | 删除 |
| `src/entry/` | 删除 |

### 1.3 元数据过期（必须更新）

| 文件 | 当前值 | 应改为 |
|------|--------|--------|
| `package.json` version | `4.5.0` | `4.9.0` |
| `package.json` bin | `dist/src/cli.js` | `dist/cli/cli.js` |
| `README.md` 标题 | `v4.5` | `v4.9` |

### 1.4 Import 路径不统一

当前仍有部分文件使用旧的 `../core/types.js` 导入路径，虽然通过 barrel 兼容，但新代码应统一使用 `../types/index.js`。

| 文件 | 当前 import | 应改为 |
|------|-------------|--------|
| `src/tools/filesystem.ts` | `../core/types.js` | `../types/index.js` |
| `src/tools/exec.ts` | `../core/types.js` | `../types/index.js` |
| `src/tools/web.ts` | `../core/types.js` | `../types/index.js` |
| `src/tools/skills.ts` | `../core/types.js` | `../types/index.js` |
| `src/tools/self-opt.ts` | `../core/types.js` | `../types/index.js` |
| `src/core/planner.ts` | `./types.js` | `../types/index.js` |
| `src/core/registry.ts` | `./types.js` | `../types/index.js` |
| `src/core/monitor.ts` | `./types.js` | `../types/index.js` |
| `src/core/config.ts` | `./types.js` | `../types/index.js` |
| `src/core/loop-detector.ts` | `./types.js` | `../types/index.js` |
| `src/core/context-manager.ts` | `./types.js` | `../types/index.js` |
| `src/core/memory-store.ts` | `./types.js` | `../types/index.js` |
| `src/core/keyword-index.ts` | `./types.js` | `../types/index.js` |

### 1.5 tsconfig.json 配置问题

```json
"rootDir": "."  // 太宽泛，应改为 "./src"
```

### 1.6 测试文件质量

12 个测试文件中，11 个仅 100-170 行且只做了基本的 import 断言，无实际测试逻辑。

### 1.7 大文件（后续优化）

| 文件 | 行数 | 建议 |
|------|------|------|
| `src/core/self-opt/inspector.ts` | 664 | 后续拆分为分析器 + 报告生成 |
| `src/tools/self-opt.ts` | 597 | 后续拆分为工具定义 + handler |
| `src/feishu/poll-server.ts` | 341 | 可接受 |

---

## 二、开发计划

### Phase 1：清理冗余（⚡ 简单任务，直接执行）

**目标**：删除所有冗余文件和空目录

1. **修复 `src/cli.ts` barrel export**
   - 改为：`export * from "./cli/cli.js";`
   - 验证：`tsc --noEmit` 通过

2. **删除冗余文件**
   - `test-feishu-ws.js`
   - `test-feishu-ws.mjs`
   - `OPTIMIZATION_LOG.md`

3. **删除空目录**
   - `feishu/`（根目录）
   - `feishu/dedup/`
   - `src/entry/`

4. **更新元数据**
   - `package.json` version → `4.9.0`
   - `package.json` bin → `dist/cli/cli.js`
   - `README.md` 标题 → `v4.9`

5. **更新 tsconfig.json**
   - `rootDir` → `"./src"`

### Phase 2：统一 Import 路径（⚡ 简单任务）

**目标**：所有文件统一使用 `../types/index.js` 导入类型

1. 批量替换 `src/core/*.ts` 中的 `from "./types.js"` → `from "../types/index.js"`
2. 批量替换 `src/tools/*.ts` 中的 `from "../core/types.js"` → `from "../types/index.js"`
3. 验证：`tsc --noEmit` 通过

### Phase 3：更新 barrel exports 和 index.ts

**目标**：确保所有 barrel export 正确导出，index.ts 完整

1. 验证 `src/core/session-manager.ts` barrel export 正确
2. 验证 `src/core/workspace-manager.ts` barrel export 正确
3. 验证 `src/core/types.ts` barrel export 正确
4. 检查 `src/index.ts` 是否导出所有公共 API

### Phase 4：更新文档

**目标**：文档与代码一致

1. 更新 `README.md`：版本号、架构图、目录结构
2. 更新 `ARCHITECTURE.md`：补充 v4.9 变更
3. 更新 `CONTRIBUTING.md`：补充目录结构和开发规范

### Phase 5：Git 提交

**目标**：干净的一次性提交

---

## 三、最终目录结构（v4.9）

```
mini-agent/
├── .env.example
├── .gitignore
├── LICENSE
├── CONTRIBUTING.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── docs/
│   └── ARCHITECTURE.md
├── skills/
│   ├── default/
│   └── demo/
├── src/
│   ├── index.ts              # barrel export（公共 API）
│   ├── toolboxes.ts           # 默认工具箱定义
│   ├── cli.ts                 # barrel → ./cli/cli.js
│   ├── feishu-cli.ts          # 飞书入口
│   ├── cli/
│   │   └── cli.ts             # CLI 主入口（508 行）
│   ├── core/
│   │   ├── agent.ts           # 薄编排层（~200 行）
│   │   ├── executor.ts        # ReAct 循环（~260 行）
│   │   ├── planner.ts         # Phase 1 规划
│   │   ├── registry.ts        # 工具注册表
│   │   ├── monitor.ts         # 性能监控
│   │   ├── config.ts          # 双层配置
│   │   ├── logger.ts          # 增量日志
│   │   ├── loop-detector.ts   # 循环检测
│   │   ├── context-manager.ts # 上下文管理
│   │   ├── memory-store.ts    # 记忆存储
│   │   ├── keyword-index.ts   # 关键词索引
│   │   ├── skill-registry.ts  # 技能注册表
│   │   ├── skill-loader.ts    # 技能加载
│   │   ├── clawhub-client.ts  # ClawHub 客户端
│   │   ├── output-manager.ts  # 输出管理
│   │   ├── instance-manager.ts# 单实例管理
│   │   ├── types.ts           # barrel → ../types/index.js
│   │   ├── session-manager.ts # barrel → ../session/manager.js
│   │   ├── workspace-manager.ts # barrel → ../session/workspace.js
│   │   └── self-opt/          # 自我优化子系统
│   │       ├── types.ts
│   │       ├── inspector.ts
│   │       ├── researcher.ts
│   │       ├── proposal-engine.ts
│   │       ├── self-test-runner.ts
│   │       ├── auto-optimizer.ts
│   │       ├── diff-generator.ts
│   │       └── git-snapshot.ts
│   ├── types/                 # 类型定义（按领域拆分）
│   │   ├── index.ts
│   │   ├── tool.ts
│   │   ├── config.ts
│   │   ├── loop.ts
│   │   ├── memory.ts
│   │   ├── context.ts
│   │   ├── planning.ts
│   │   ├── pipeline.ts
│   │   ├── stats.ts
│   │   ├── skill.ts
│   │   ├── clawhub.ts
│   │   ├── session.ts
│   │   └── agent.ts
│   ├── session/               # 会话管理
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   └── workspace.ts
│   ├── tools/                 # 工具实现
│   │   ├── filesystem.ts
│   │   ├── exec.ts
│   │   ├── web.ts
│   │   ├── skills.ts
│   │   └── self-opt.ts
│   ├── security/
│   │   └── sandbox.ts
│   └── feishu/
│       ├── types.ts
│       ├── server.ts
│       └── poll-server.ts
└── tests/
    ├── test.ts                # 主测试入口
    └── *.test.ts              # 各模块测试
```

---

## 四、执行顺序

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
  清理      import     barrel    文档     提交
```

每阶段完成后执行 `tsc --noEmit` 验证 0 错误。
