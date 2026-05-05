/**
 * @file confirmation-manager.ts - Medium 风险确认管理器 (Phase 5.4 新增)
 * @description
 *   收集 medium/high 风险的优化方案，生成确认清单，
 *   支持 CLI 交互或输出为结构化数据供飞书卡片展示。
 *
 *   工作流程：
 *   1. 从提案列表中筛选 medium/high 风险方案
 *   2. 生成确认清单（目标、描述、风险、预期收益、文件列表）
 *   3. 等待用户选择（执行 / 跳过 / 查看diff）
 *   4. 确认后继续执行流程
 *
 *   设计原则
 *   - medium 风险默认需要确认，但可通过配置跳过
 *   - high/destructive 风险必须确认，无法跳过
 *   - 支持批量确认（一次确认多个方案）
 *
 * @module core/self-opt/confirmation-manager
 */

import type { OptimizationProposal } from "./types.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 确认项
 */
export interface ConfirmationItem {
  proposal: OptimizationProposal;
  /** 是否必须确认（high/destructive 为 true） */
  mandatory: boolean;
  /** 确认状态 */
  status: "pending" | "approved" | "rejected" | "skipped";
}

/**
 * 确认管理器配置
 */
export interface ConfirmationConfig {
  /** 是否需要 medium 风险确认（默认 true） */
  requireMedium: boolean;
  /** 是否需要 high 风险确认（默认 true，无法关闭） */
  requireHigh: boolean;
  /** 自动跳过的提案 ID 列表（用户之前选择"不再询问"） */
  autoSkipIds: string[];
  /** 自动批准的提案 ID 列表（用户之前选择"总是执行此类"） */
  autoApproveIds: string[];
}

const DEFAULT_CONFIG: ConfirmationConfig = {
  requireMedium: true,
  requireHigh: true,
  autoSkipIds: [],
  autoApproveIds: [],
};

// ============================================================================
// 主函数
// ============================================================================

/**
 * 确认管理器
 */
export class ConfirmationManager {
  private items: ConfirmationItem[] = [];
  private config: ConfirmationConfig;

  constructor(config?: Partial<ConfirmationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  /**
   * 收集需要确认的提案
   */
  collect(proposals: OptimizationProposal[]): void {
    this.items = [];
    for (const p of proposals) {
      const needsConfirm = this.needsConfirmation(p);
      if (!needsConfirm) continue;

      // 检查自动跳过/批准
      if (this.config.autoSkipIds.includes(p.id)) {
        this.items.push({ proposal: p, mandatory: p.riskLevel === "high" || p.riskLevel === "destructive", status: "skipped" });
        continue;
      }
      if (this.config.autoApproveIds.includes(p.id)) {
        this.items.push({ proposal: p, mandatory: p.riskLevel === "high" || p.riskLevel === "destructive", status: "approved" });
        continue;
      }

      this.items.push({
        proposal: p,
        mandatory: p.riskLevel === "high" || p.riskLevel === "destructive",
        status: "pending",
      });
    }
  }

  /**
   * 判断提案是否需要确认
   */
  private needsConfirmation(p: OptimizationProposal): boolean {
    if (p.riskLevel === "high" || p.riskLevel === "destructive") {
      return this.config.requireHigh;
    }
    if (p.riskLevel === "medium") {
      return this.config.requireMedium;
    }
    // low 风险不需要确认
    return false;
  }

  /**
   * 获取待确认的提案列表
   */
  getPendingItems(): ConfirmationItem[] {
    return this.items.filter((i) => i.status === "pending");
  }

  /**
   * 获取所有已批准的提案
   */
  getApprovedProposals(): OptimizationProposal[] {
    return this.items
      .filter((i) => i.status === "approved")
      .map((i) => i.proposal);
  }

  /**
   * 获取所有需要展示的提案（包括已批准/跳过/待确认）
   */
  getAllItems(): ConfirmationItem[] {
    return [...this.items];
  }

  /**
   * 批准单个提案
   */
  approve(proposalId: string): boolean {
    const item = this.items.find((i) => i.proposal.id === proposalId);
    if (!item) return false;
    if (item.status !== "pending") return false;
    item.status = "approved";
    return true;
  }

  /**
   * 拒绝单个提案
   */
  reject(proposalId: string): boolean {
    const item = this.items.find((i) => i.proposal.id === proposalId);
    if (!item) return false;
    if (item.mandatory) return false; // 必须确认的不能拒绝
    item.status = "rejected";
    return true;
  }

  /**
   * 跳过单个提案（标记为稍后处理）
   */
  skip(proposalId: string): boolean {
    const item = this.items.find((i) => i.proposal.id === proposalId);
    if (!item) return false;
    if (item.mandatory) return false;
    item.status = "skipped";
    return true;
  }

  /**
   * 批量批准所有待确认提案
   */
  approveAll(): void {
    for (const item of this.items) {
      if (item.status === "pending") {
        item.status = "approved";
      }
    }
  }

  /**
   * 批量批准所有 medium 风险提案（保留 high 待确认）
   */
  approveMediumOnly(): void {
    for (const item of this.items) {
      if (item.status === "pending" && !item.mandatory) {
        item.status = "approved";
      }
    }
  }

  /**
   * 检查是否还有待确认的提案
   */
  hasPending(): boolean {
    return this.items.some((i) => i.status === "pending");
  }

  /**
   * 检查是否有必须确认但尚未确认的提案
   */
  hasMandatoryPending(): boolean {
    return this.items.some((i) => i.status === "pending" && i.mandatory);
  }

  /**
   * 获取确认统计
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    skipped: number;
  } {
    return {
      total: this.items.length,
      pending: this.items.filter((i) => i.status === "pending").length,
      approved: this.items.filter((i) => i.status === "approved").length,
      rejected: this.items.filter((i) => i.status === "rejected").length,
      skipped: this.items.filter((i) => i.status === "skipped").length,
    };
  }

  /**
   * 格式化为确认清单（供 CLI 展示）
   */
  formatConfirmationList(): string {
    if (this.items.length === 0) {
      return "✅ 无需确认的提案，所有方案均为 low 风险";
    }

    const lines = [
      "══════════════════════════════════════════",
      "🔒 优化方案确认清单",
      "══════════════════════════════════════════",
      "共 " + this.items.length + " 个需要确认的方案",
      "",
    ];

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const p = item.proposal;
      const icon = item.mandatory ? "🔴" : "🟡";
      const statusIcon =
        item.status === "approved" ? "✅"
          : item.status === "rejected" ? "❌"
            : item.status === "skipped" ? "⏭️"
              : "⏳";

      lines.push(statusIcon + " [" + (i + 1) + "] " + icon + " " + p.target);
      lines.push("    风险: " + p.riskLevel + " | 类型: " + p.type);
      lines.push("    " + p.description);
      lines.push("    预期: " + p.expectedBenefit);
      if (p.files.length > 0) {
        lines.push("    文件: " + p.files.map((f) => f.path).join(", "));
      }
      if (item.mandatory) {
        lines.push("    ⚠️ 必须确认（high/destructive 风险）");
      }
      lines.push("");
    }

    const stats = this.getStats();
    lines.push("---");
    lines.push("统计: 待确认 " + stats.pending + " | 已批准 " + stats.approved + " | 已拒绝 " + stats.rejected + " | 已跳过 " + stats.skipped);

    return lines.join("\n");
  }

  /**
   * 格式化为飞书卡片数据（供外部渲染）
   */
  toFeishuCardData(): {
    title: string;
    items: Array<{
      id: string;
      target: string;
      riskLevel: string;
      type: string;
      description: string;
      mandatory: boolean;
      status: string;
    }>;
    stats: ReturnType<ConfirmationManager["getStats"]>;
  } {
    return {
      title: "优化方案确认清单",
      items: this.items.map((i) => ({
        id: i.proposal.id,
        target: i.proposal.target,
        riskLevel: i.proposal.riskLevel,
        type: i.proposal.type,
        description: i.proposal.description,
        mandatory: i.mandatory,
        status: i.status,
      })),
      stats: this.getStats(),
    };
  }
}

/**
 * 便捷函数：快速收集需要确认的提案
 *
 * @param proposals 所有提案
 * @param config 确认配置
 * @returns 确认管理器实例
 */
export function createConfirmationManager(
  proposals: OptimizationProposal[],
  config?: Partial<ConfirmationConfig>
): ConfirmationManager {
  const manager = new ConfirmationManager(config);
  manager.collect(proposals);
  return manager;
}
