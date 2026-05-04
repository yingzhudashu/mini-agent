/**
 * @file feishu.ts — 飞书集成类型
 * @description
 *   飞书消息事件、卡片交互、配置相关类型。
 *   用于飞书开放平台事件推送的解析与响应。
 *
 *   支持的场景：
 *   - 接收飞书消息事件（im.message.receive_v1）
 *   - 发送文本/卡片回复
 *   - Webhook URL 验证
 *   - 飞书应用配置管理
 *
 * @module types/feishu
 */

/**
 * 飞书消息事件
 *
 * @description 表示从飞书开放平台接收到的消息或卡片交互事件。
 */
export interface FeishuMessageEvent {
  /** 事件类型：message=文本消息，card_action=卡片按钮点击 */
  type: 'message' | 'card_action';
  /** 飞书聊天 ID（群聊或个人会话） */
  chat_id: string;
  /** 发送者 ID（open_id） */
  sender_id: string;
  /** 消息内容（文本或卡片 payload） */
  content: string;
  /** 消息唯一 ID（用于去重） */
  message_id?: string;
  /** 卡片回调数据（仅 card_action 类型有效） */
  card_callback?: {
    /** 回调动作名称 */
    action: string;
    /** 回调携带的键值对数据 */
    value: Record<string, string>;
  };
}

/**
 * 飞书应用配置
 *
 * @description 用于初始化飞书 SDK 客户端的配置参数。
 */
export interface FeishuConfig {
  /** 飞书开放平台应用 App ID */
  appId: string;
  /** 飞书开放平台应用 App Secret */
  appSecret: string;
  /** Webhook HTTP 服务器监听端口（长轮询模式可设为 0） */
  port: number;
  /** 是否启用事件加密（默认 false） */
  enableEncrypt?: boolean;
  /** 事件加密密钥（enableEncrypt=true 时必填） */
  encryptKey?: string;
  /** 事件验证令牌（用于 Webhook 模式验证请求来源） */
  verificationToken?: string;
}

/**
 * 飞书发送消息的请求负载
 *
 * @description 用于调用飞书 API 发送消息时的请求参数。
 */
export interface FeishuMessagePayload {
  /** 消息类型：text=文本，interactive=卡片，image=图片，file=文件 */
  msg_type: 'text' | 'interactive' | 'image' | 'file';
  /** 接收者 ID（chat_id、open_id 或 email） */
  receive_id: string;
  /** 消息内容，格式为 JSON 字符串（如 '{"text":"hello"}'） */
  content: string;
}

/**
 * Agent 处理后的消息结果
 *
 * @description Agent 处理飞书消息后返回的回复数据。
 */
export interface AgentMessageResult {
  /** 回复文本内容 */
  text: string;
  /** 是否以卡片格式回复（默认 false，以纯文本发送） */
  useCard?: boolean;
  /** 卡片模板元素（useCard=true 时有效） */
  cardElements?: Record<string, unknown>[];
}
