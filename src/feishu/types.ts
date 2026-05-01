/**
 * @file types.ts — 飞书集成相关类型定义
 * @description 定义飞书消息事件、卡片交互等类型
 */

/**
 * 飞书消息事件
 */
export interface FeishuMessageEvent {
  /** 事件类型 */
  type: 'message' | 'card_action';
  /** 飞书聊天 ID */
  chat_id: string;
  /** 发送者 ID */
  sender_id: string;
  /** 消息内容 */
  content: string;
  /** 消息 ID */
  message_id?: string;
  /** 是否为卡片回调 */
  card_callback?: {
    action: string;
    value: Record<string, string>;
  };
}

/**
 * 飞书配置
 */
export interface FeishuConfig {
  /** 飞书 App ID */
  appId: string;
  /** 飞书 App Secret */
  appSecret: string;
  /** Webhook 监听端口 */
  port: number;
  /** 是否启用加密 */
  enableEncrypt?: boolean;
  /** 加密密钥 (Encrypt Key) */
  encryptKey?: string;
  /** 验证令牌 (Verification Token) */
  verificationToken?: string;
}

/**
 * 飞书消息负载
 */
export interface FeishuMessagePayload {
  /** 消息类型 */
  msg_type: 'text' | 'interactive' | 'image' | 'file';
  /** 接收者 ID */
  receive_id: string;
  /** 消息内容 (JSON 字符串) */
  content: string;
}

/**
 * Agent 消息结果
 */
export interface AgentMessageResult {
  /** 回复文本 */
  text: string;
  /** 是否使用卡片回复 */
  useCard?: boolean;
  /** 卡片元素 */
  cardElements?: Record<string, unknown>[];
}
