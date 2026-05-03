/**
 * @file clawhub.ts — ClawHub 技能市场类型
 * @description
 *   v4.1 新增：技能市场的搜索、详情查看和下载功能。
 *
 * @module types/clawhub
 */

// ============================================================================
// ClawHub 搜索结果
// ============================================================================

/**
 * ClawHub 技能搜索结果
 */
export interface ClawHubSearchResult {
  /** 技能 slug */
  slug: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 当前版本 */
  version: string;
  /** 标签 */
  tags: string[];
  /** 下载次数 */
  downloads: number;
  /** 星标数 */
  stars: number;
  /** 作者 */
  author: string;
}

// ============================================================================
// ClawHub 技能详情
// ============================================================================

/**
 * ClawHub 技能详情
 */
export interface ClawHubSkillDetail {
  /** 技能 slug */
  slug: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 当前版本 */
  version: string;
  /** 标签 */
  tags: string[];
  /** SKILL.md 内容 */
  skillMd: string;
  /** 技能文件列表 */
  files: { path: string; content: string }[];
}

// ============================================================================
// ClawHub 客户端接口
// ============================================================================

/**
 * ClawHub 客户端接口
 *
 * 用于与 ClawHub 技能市场交互。
 */
export interface ClawHubClient {
  /** 搜索技能 */
  search(query: string, limit?: number): Promise<ClawHubSearchResult[]>;
  /** 获取技能详情 */
  getDetail(slug: string): Promise<ClawHubSkillDetail>;
  /** 下载技能包 */
  download(
    slug: string,
    version?: string,
  ): Promise<{
    path: string;
    files: { path: string; content: string }[];
  }>;
}
