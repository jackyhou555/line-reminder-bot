// Line Bot 定時提醒功能
// 使用 Node.js 和 @line/bot-sdk 函式庫

const express = require('express');
const line = require('@line/bot-sdk');
const cron = require('node-cron');
const fs = require('fs');

// 設定資訊
const config = {
  channelAccessToken: 'pVzoPdMzSf2Go8V0fT3yOjYuy1bL5famfrcRHrLJMdxDKk+brRlX+QHj54ekkG3D1PK4LzIx4w7Zmzz9wkI6HeHnwnASNv9Myd31cklsvOaGm7wy3ETBgywn3mx0Hk9CJuyiuMrbfpu2Y3FQ88cSkgdB04t89/1O/w1cDnyilFU=',
  channelSecret: 'e9ff0360dcc9f9d14e71aa7d89cafb11'
};

// 創建LINE SDK客戶端
const client = new line.Client(config);

// 創建Express應用
const app = express();

// 設定伺服器端口，Heroku會自動分配
const port = process.env.PORT || 3000;

// 用於儲存提醒任務的檔案
const REMINDERS_FILE = './reminders.json';

// 初始化提醒列表
let reminders = [];

// 如果提醒檔案存在，則載入它
if (fs.existsSync(REMINDERS_FILE)) {
  try {
    reminders = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
    console.log('已載入提醒列表:', reminders);

    // 重新設定所有儲存的定時任務
    setupScheduledTasks();
  } catch (err) {
    console.error('載入提醒列表時出錯:', err);
  }
}

// 設定接收LINE訊息的路由
app.post('/callback', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 處理接收到的事件
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // 忽略非文字訊息
    return Promise.resolve(null);
  }

  // 獲取訊息內容
  const text = event.message.text;

  // 處理添加提醒的指令
  if (text.startsWith('新增提醒：')) {
    return handleAddReminder(event);
  }

  // 處理查看所有提醒的指令
  if (text === '查看提醒') {
    return handleListReminders(event);
  }

  // 處理刪除提醒的指令
  if (text.startsWith('刪除提醒：')) {
    return handleDeleteReminder(event);
  }

  // 幫助指令
  if (text === '幫助') {
    return handleHelp(event);
  }

  // 預設回覆
  return Promise.resolve(null);    
}
// 處理添加提醒
function handleAddReminder(event) {
  const text = event.message.text;
  const parts = text.substring(5).split('，');

  if (parts.length < 2) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '格式錯誤，請使用：新增提醒：內容，時間（例如：新增提醒：吃藥，08:00）'
    });
  }

  const content = parts[0].trim();
  const timeStr = parts[1].trim();

  // 驗證時間格式 (HH:MM)
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(timeStr)) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '時間格式錯誤，請使用24小時制（例如：08:00、14:30）'
    });
  }

  // 解析時間
  const [hours, minutes] = timeStr.split(':').map(Number);

  // 創建cron表達式 (分 時 * * *)
  const cronExpression = `${minutes} ${hours} * * *`;

  // 獲取訊息來源的ID（可以是群組ID、用戶ID等）
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId;
  const sourceType = event.source.type; // 'user', 'group', 或 'room'

  // 創建新提醒
  const reminder = {
    id: Date.now().toString(),
    content: content,
    time: timeStr,
    cronExpression: cronExpression,
    sourceId: sourceId,
    sourceType: sourceType
  };

  // 添加到提醒列表
  reminders.push(reminder);

  // 儲存提醒到檔案
  saveReminders();

  // 設定定時任務
  scheduleReminder(reminder);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `已新增提醒：${content}，時間：${timeStr}`
  });
}

// 處理列出所有提醒
function handleListReminders(event) {
  // 獲取訊息來源的ID
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId;

  // 過濾出屬於當前來源的提醒
  const sourceReminders = reminders.filter(r => r.sourceId === sourceId);

  if (sourceReminders.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '目前沒有設定任何提醒。'
    });
  }

  // 格式化提醒列表
  const reminderList = sourceReminders.map((r, index) =>
    `${index + 1}. ${r.content} (${r.time})`
  ).join('\n');

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `目前提醒列表：\n${reminderList}`
  });
}

// 處理刪除提醒
function handleDeleteReminder(event) {
  const text = event.message.text;
  const reminderIndex = parseInt(text.substring(5).trim()) - 1;

  // 獲取訊息來源的ID
  const sourceId = event.source.groupId || event.source.roomId || event.source.userId;

  // 過濾出屬於當前來源的提醒
  const sourceReminders = reminders.filter(r => r.sourceId === sourceId);

  if (isNaN(reminderIndex) || reminderIndex < 0 || reminderIndex >= sourceReminders.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '無效的提醒編號，請使用「查看提醒」獲取有效的編號。'
    });
  }

  // 獲取要刪除的提醒
  const reminderToDelete = sourceReminders[reminderIndex];

  // 從主列表中刪除
  const mainIndex = reminders.findIndex(r => r.id === reminderToDelete.id);
  if (mainIndex !== -1) {
    reminders.splice(mainIndex, 1);
    saveReminders();

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `已刪除提醒：${reminderToDelete.content}`
    });
  } else {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '刪除提醒時發生錯誤。'
    });
  }
}

// 處理幫助命令
function handleHelp(event) {
  const helpText =
    '📅 提醒機器人使用說明 📅\n\n' +
    '1. 新增提醒：內容，時間\n' +
    '   範例：新增提醒：吃藥，08:00\n\n' +
    '2. 查看提醒\n' +
    '   顯示當前所有提醒\n\n' +
    '3. 刪除提醒：序號\n' +
    '   範例：刪除提醒：1\n\n' +
    '時間格式為24小時制，例如：08:00、14:30';

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: helpText
  });
}

// 儲存提醒到檔案
function saveReminders() {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
  console.log('已儲存提醒至檔案');
}

// 設定所有排程任務
function setupScheduledTasks() {
  // 清除所有現有的定時任務（如果有重新加載）
  // 注意：這裡沒有直接的API來清除所有任務，但我們可以忽略舊的並創建新的

  // 為每個提醒設定新的定時任務
  reminders.forEach(reminder => {
    scheduleReminder(reminder);
  });
}

// 為特定提醒設定定時任務
function scheduleReminder(reminder) {
  cron.schedule(reminder.cronExpression, () => {
    // 根據提醒的來源類型發送訊息
    switch (reminder.sourceType) {
      case 'user':
        client.pushMessage(reminder.sourceId, {
          type: 'text',
          text: `⏰ 提醒：${reminder.content}`
        }).catch(err => {
          console.error('發送提醒時出錯:', err);
        });
        break;

      case 'group':
        client.pushMessage(reminder.sourceId, {
          type: 'text',
          text: `⏰ 提醒：${reminder.content}`
        }).catch(err => {
          console.error('發送群組提醒時出錯:', err);
        });
        break;

      case 'room':
        client.pushMessage(reminder.sourceId, {
          type: 'text',
          text: `⏰ 提醒：${reminder.content}`
        }).catch(err => {
          console.error('發送房間提醒時出錯:', err);
        });
        break;
    }

    console.log(`已發送提醒：${reminder.content} 至 ${reminder.sourceType} ${reminder.sourceId}`);
  });

  console.log(`已排程提醒：${reminder.content}，時間：${reminder.time}`);
}

// 啟動Express伺服器
app.listen(port, () => {
  console.log(`LINE Bot服務啟動於 http://localhost:${port}`);
});

// 添加一個簡單的路由，用於健康檢查
app.get('/', (req, res) => {
  res.send('LINE提醒機器人正在運行！');
});