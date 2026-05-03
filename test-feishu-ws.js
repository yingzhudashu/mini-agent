/**
 * 飞书 WebSocket 连接诊断脚本
 * 测试 mini-agent 的 appId/appSecret 是否能正常接收事件
 */
const lark = require('@larksuiteoapi/node-sdk');

const APP_ID = process.env.FEISHU_APP_ID || 'cli_a96cf1a027f8dbef';
const APP_SECRET = process.env.FEISHU_APP_SECRET || 'GJOjTfdeQb3PzumgFRdQHdDMwoTUV3jf';

let hasReceivedEvent = false;
let connectTime = null;

// 创建事件分发器
const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': (data) => {
    hasReceivedEvent = true;
    console.log('\n✅✅✅ 收到消息事件！');
    console.log('event_type:', data.event_type);
    console.log('data keys:', Object.keys(data));
    if (data.message) {
      console.log('chat_id:', data.message.chat_id);
      console.log('message_type:', data.message.message_type);
    }
    if (data.sender) {
      console.log('sender:', data.sender.sender_id?.open_id);
    }
    // 10秒后退出
    setTimeout(() => process.exit(0), 3000);
  },
  'im.chat.member.bot.added_v1': (data) => {
    console.log('\n📢 收到 bot 被添加到群聊的事件');
    console.log('data:', JSON.stringify(data).slice(0, 300));
  },
});

// 创建 WebSocket 客户端
const wsClient = new lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  domain: lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.info,
});

// 设置回调
wsClient.start({
  eventDispatcher,
}).then(() => {
  console.log('wsClient.start() 返回');
}).catch(err => {
  console.error('wsClient.start() 失败:', err.message);
  process.exit(1);
});

// 30秒超时
setTimeout(() => {
  if (!hasReceivedEvent) {
    console.log('\n❌ 30秒内未收到任何消息事件');
    console.log('连接状态: wsClient.hasEverConnected =', wsClient.hasEverConnected);
    console.log('\n可能原因:');
    console.log('1. 应用的事件订阅模式不是"长连接"');
    console.log('2. 应用未订阅 im.message.receive_v1 事件');
    console.log('3. 机器人未被添加到测试群聊');
  }
  process.exit(hasReceivedEvent ? 0 : 1);
}, 30000);
