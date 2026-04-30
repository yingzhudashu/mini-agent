/**
 * @file monitor.ts — 工具性能监控器
 * @description
 *   自动记录每次工具调用的耗时和成功/失败状态，
 *   提供统计报告和单个工具的性能数据。
 *
 *   设计目标：
 *   1. 零配置：Agent 运行时自动收集数据，无需手动埋点
 *   2. 轻量：只记录必要的统计数据，不过度采集
 *   3. 可见：通过 .stats 命令随时查看报告
 *
 *   使用场景：
 *   - 调试：发现哪个工具慢、哪个工具爱失败
 *   - 优化：根据统计数据决定是否需要缓存或重试机制
 *   - 展示：在 CLI 结束时打印汇总报告
 *
 * @module core/monitor
 */

import type { ToolMonitor, ToolStats } from "./types.js";

/**
 * 默认工具性能监控器实现
 *
 * 内部使用 Map 存储每个工具的统计数据。
 * 每次 record() 调用时，累加调用次数和总耗时，并更新平均值。
 *
 * 线程安全说明：
 *   由于 JavaScript 单线程模型，record() 不会被并发调用打断，
 *   所以 stats 对象的读写是原子的，不需要加锁。
 *
 * @example
 *   const monitor = new DefaultToolMonitor();
 *
 *   // Agent 内部在每次工具调用后自动记录
 *   const start = Date.now();
 *   const result = await tool.handler(args, ctx);
 *   monitor.record(toolName, Date.now() - start, result.success);
 *
 *   // 用户通过 .stats 命令查看
 *   console.log(monitor.report());
 */
export class DefaultToolMonitor implements ToolMonitor {
  /** 存储每个工具的统计数据，key 为工具名称 */
  private stats = new Map<string, ToolStats>();

  /**
   * 记录一次工具调用
   *
   * 更新逻辑：
   * 1. 获取或创建该工具的统计数据（首次调用时初始化为零）
   * 2. 调用次数 +1
   * 3. 累计耗时加上本次耗时
   * 4. 如果成功，successCount +1；否则 failCount +1
   *
   * @param tool       - 工具名称
   * @param durationMs - 本次调用耗时（毫秒）
   * @param success    - 是否成功（result.success === true）
   */
  record(tool: string, durationMs: number, success: boolean): void {
    // 获取已有统计数据，如果是首次调用则创建初始对象
    const s = this.stats.get(tool) ?? { calls: 0, totalMs: 0, successCount: 0, failCount: 0, errors: [] };

    // 累加统计数据
    s.calls++;
    s.totalMs += durationMs;
    if (success) {
      s.successCount++;
    } else {
      s.failCount++;
    }

    // 更新 Map
    this.stats.set(tool, s);
  }

  /**
   * 获取单个工具的统计数据
   *
   * @param tool - 工具名称
   * @returns 统计数据，未找到返回 undefined
   */
  getStats(tool: string): ToolStats | undefined {
    return this.stats.get(tool);
  }

  /**
   * 获取所有工具的统计数据
   *
   * 返回副本，防止外部修改内部状态。
   *
   * @returns 所有工具的统计 Map 副本
   */
  getAllStats(): Map<string, ToolStats> {
    return new Map(this.stats);
  }

  /**
   * 生成人类可读的统计报告
   *
   * 格式示例：
   * ```
   * 📊 工具使用统计:
   *
   *   read_file: 调用 5 次 | 平均 3ms | 成功率 100.0%
   *   exec_command: 调用 3 次 | 平均 1250ms | 成功率 66.7%
   *   get_time: 调用 1 次 | 平均 1ms | 成功率 100.0%
   * ```
   *
   * 信息解读：
   * - 调用次数：工具被使用的频率，高频工具值得重点优化
   * - 平均耗时：工具的执行速度，慢工具可能需要缓存或异步优化
   * - 成功率：工具的可靠性，低成功率说明工具实现有 bug 或参数有问题
   *
   * @returns 格式化的报告字符串
   */
  report(): string {
    // 没有任何数据时的友好提示
    if (this.stats.size === 0) return "📊 暂无工具使用数据";

    // 逐行生成每个工具的统计信息
    const lines: string[] = ["📊 工具使用统计:\n"];
    for (const [name, s] of this.stats) {
      // 计算成功率：(成功次数 / 总次数) * 100，保留 1 位小数
      const rate = s.calls > 0 ? ((s.successCount / s.calls) * 100).toFixed(1) : "0.0";
      // 计算平均耗时（动态计算，不在 stats 中存储）
      const avg = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
      lines.push(`  ${name}: 调用 ${s.calls} 次 | 平均 ${avg}ms | 成功率 ${rate}%`);
    }
    return lines.join("\n");
  }
}
