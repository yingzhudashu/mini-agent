import type { ToolMonitor, ToolStats } from "./types.js";

/**
 * Tool performance monitor.
 * Tracks call counts, errors, and average duration per tool.
 */
export class DefaultToolMonitor implements ToolMonitor {
  private stats = new Map<string, ToolStats>();

  record(name: string, durationMs: number, success: boolean): void {
    const s = this.stats.get(name) ?? { calls: 0, errors: 0, totalMs: 0, avgMs: 0 };
    s.calls++;
    s.totalMs += durationMs;
    s.avgMs = Math.round(s.totalMs / s.calls);
    if (!success) s.errors++;
    s.lastCall = new Date().toISOString();
    this.stats.set(name, s);
  }

  getStats(name: string): ToolStats | undefined {
    return this.stats.get(name);
  }

  getAllStats(): Map<string, ToolStats> {
    return new Map(this.stats);
  }

  report(): string {
    if (this.stats.size === 0) return "📊 暂无工具使用数据";
    const lines: string[] = ["📊 工具使用统计:\n"];
    for (const [name, s] of this.stats) {
      const rate = s.calls > 0 ? (((s.calls - s.errors) / s.calls) * 100).toFixed(1) : "0.0";
      lines.push(`  ${name}: 调用 ${s.calls} 次 | 平均 ${s.avgMs}ms | 成功率 ${rate}%`);
    }
    return lines.join("\n");
  }
}
