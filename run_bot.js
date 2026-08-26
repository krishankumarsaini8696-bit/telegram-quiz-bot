const fs = require('fs');
const https = require('https');
const path = require('path');

// Credentials
const TELEGRAM_BOT_TOKEN = "8846369362:AAHdB98_mTP74soB5sssbVv_XE5NZMgy72I";
const TELEGRAM_CHANNEL_ID = "-1004340852837";
const PROJECT_ID = "telegram-9f787";

// Firebase Token Manager
const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
let cachedToken = null;

async function getAccessToken() {
  if (!fs.existsSync(configPath)) {
    throw new Error("Firebase CLI config not found at " + configPath);
  }
  const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = fbConfig.tokens || {};
  
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60000 && tokens.access_token) {
    return tokens.access_token;
  }
  
  const postData = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            tokens.access_token = parsed.access_token;
            tokens.expires_at = Date.now() + (parsed.expires_in || 3600) * 1000;
            fs.writeFileSync(configPath, JSON.stringify(fbConfig, null, 2));
            resolve(parsed.access_token);
          } else {
            reject(new Error("Failed to refresh token: " + data));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Telegram API Helper
function callTelegram(method, body = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Table Formatter for Telegram Polls
function formatMarkdownTable(text) {
  if (!text || !text.includes('|')) return text || "";

  const lines = text.split('\n');
  const newLines = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      
      // Skip separator lines like | :--- | :--- | or |---|---|
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        continue; // Skip the header row if it's just "सूची-I | सूची-II"
      }

      // Format matching row: e.g. "(A) पाबूजी ➔ (1) पगलिया"
      if (cells.length >= 2) {
        newLines.push(`${cells[0]} ➔ ${cells[1]}`);
      } else if (cells.length === 1) {
        newLines.push(cells[0]);
      }
    } else {
      inTable = false;
      newLines.push(line);
    }
  }

  return newLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Firestore REST Helpers
async function fetchAllDocuments() {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/questions?pageSize=100`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const docs = (json.documents || []).map(doc => {
            const fields = doc.fields || {};
            const options = (fields.options?.arrayValue?.values || []).map(v => v.stringValue || "");
            const rawQ = fields.question_text?.stringValue || fields.question?.stringValue || "";
            const rawExpl = fields.explanation?.stringValue || "";

            return {
              id: doc.name.split('/').pop(),
              fullName: doc.name,
              category: fields.category?.stringValue || "General",
              question_text: formatMarkdownTable(rawQ),
              options: options,
              correct_option_id: parseInt(fields.correct_option_id?.integerValue || fields.correct_option?.integerValue || fields.correct_answer?.integerValue || 0, 10),
              explanation: formatMarkdownTable(rawExpl),
              is_used: fields.is_used?.booleanValue || false
            };
          });
          resolve(docs);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function markQuestionAsUsed(docFullName) {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/${docFullName}?updateMask.fieldPaths=is_used&updateMask.fieldPaths=posted_at`;

  const body = JSON.stringify({
    fields: {
      is_used: { booleanValue: true },
      posted_at: { timestampValue: new Date().toISOString() }
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// User session storage
const sessions = {};

// Handle user commands
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const firstName = msg.from.first_name || 'Friend';

  if (text.startsWith('/start')) {
    const welcome = `👋 Hello, <b>${firstName}</b>!\n\n🎯 <b>Telegram Quiz Automation System</b> is ready.\n\nConnected to:\n• Channel: <b>Rajasthan Cet 2026</b> (<code>${TELEGRAM_CHANNEL_ID}</code>)\n• Database: <b>Firestore</b> (<code>${PROJECT_ID}</code>)\n\nCommands:\n• /postquiz - Post or schedule a quiz\n• /stats - View available questions\n• /help - Help guide`;
    
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: welcome,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Post a Quiz Now", callback_data: "cmd_postquiz" }],
          [{ text: "📊 View Database Stats", callback_data: "cmd_stats" }]
        ]
      }
    });
    return;
  }

  if (text.startsWith('/stats')) {
    await sendStats(chatId);
    return;
  }

  if (text.startsWith('/postquiz')) {
    await sendCategoryMenu(chatId);
    return;
  }

  if (text.startsWith('/help')) {
    const help = `ℹ️ <b>How to use the Quiz Bot:</b>\n\n1. Send /postquiz\n2. Select your topic/category\n3. Choose how many questions to post\n4. Choose when to post (Now or Scheduled)\n5. The bot will automatically create native Quiz Polls in the channel and update the database so questions never repeat!`;
    await callTelegram('sendMessage', { chat_id: chatId, text: help, parse_mode: 'HTML' });
  }
}

async function sendStats(chatId, messageId = null) {
  try {
    const allDocs = await fetchAllDocuments();
    const total = allDocs.length;
    const unused = allDocs.filter(d => !d.is_used);
    const usedCount = total - unused.length;

    const catCounts = {};
    unused.forEach(d => {
      catCounts[d.category] = (catCounts[d.category] || 0) + 1;
    });

    let text = `📊 <b>Database Statistics</b>\n\n• <b>Total Questions:</b> <code>${total}</code>\n• <b>Available (Unused):</b> <code>${unused.length}</code>\n• <b>Already Posted:</b> <code>${usedCount}</code>\n\n📂 <b>Unused Questions by Category:</b>\n`;
    
    if (Object.keys(catCounts).length === 0) {
      text += `<i>No unused questions remaining.</i>`;
    } else {
      for (const [cat, cnt] of Object.entries(catCounts)) {
        text += `  • <b>${cat}:</b> <code>${cnt}</code> questions\n`;
      }
    }

    const markup = {
      inline_keyboard: [
        [{ text: "🚀 Post a Quiz", callback_data: "cmd_postquiz" }]
      ]
    };

    if (messageId) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: markup
      });
    } else {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: markup
      });
    }
  } catch (err) {
    console.error("Error in stats:", err);
  }
}

async function sendCategoryMenu(chatId, messageId = null) {
  try {
    const allDocs = await fetchAllDocuments();
    const unused = allDocs.filter(d => !d.is_used);

    if (unused.length === 0) {
      const msg = "⚠️ <b>No unused questions left in Firestore!</b>\nPlease upload more questions.";
      if (messageId) {
        await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: msg, parse_mode: 'HTML' });
      } else {
        await callTelegram('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML' });
      }
      return;
    }

    const catCounts = {};
    unused.forEach(d => {
      catCounts[d.category] = (catCounts[d.category] || 0) + 1;
    });

    const keyboard = [];
    for (const [cat, count] of Object.entries(catCounts)) {
      keyboard.push([{ text: `📚 ${cat} (${count} available)`, callback_data: `cat:${cat}` }]);
    }
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = "🎯 <b>Step 1/3: Select a Quiz Category</b>\n\nChoose the topic for your quiz:";
    if (messageId) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (err) {
    console.error("Error in sendCategoryMenu:", err);
  }
}

// Handle inline button callbacks
async function handleCallback(cb) {
  const queryId = cb.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const data = cb.data;
  const userId = cb.from.id;

  await callTelegram('answerCallbackQuery', { callback_query_id: queryId });

  if (data === "cancel") {
    delete sessions[userId];
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "❌ Quiz creation cancelled." });
    return;
  }

  if (data === "cmd_postquiz") {
    await sendCategoryMenu(chatId, messageId);
    return;
  }

  if (data === "cmd_stats") {
    await sendStats(chatId, messageId);
    return;
  }

  // Step 2: Category chosen -> Pick count
  if (data.startsWith("cat:")) {
    const category = data.substring(4);
    const allDocs = await fetchAllDocuments();
    const available = allDocs.filter(d => !d.is_used && d.category === category).length;

    if (available === 0) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⚠️ No unused questions left in <b>${category}</b>.`,
        parse_mode: 'HTML'
      });
      return;
    }

    sessions[userId] = { category, available };

    let counts = [1, 2, 3, 5, 10].filter(c => c <= available);
    if (!counts.includes(available)) {
      counts.push(available);
      counts.sort((a, b) => a - b);
    }

    const keyboard = [];
    let row = [];
    for (const c of counts) {
      row.push({ text: `${c} Question${c > 1 ? 's' : ''}`, callback_data: `cnt:${c}` });
      if (row.length === 2) {
        keyboard.push(row);
        row = [];
      }
    }
    if (row.length > 0) keyboard.push(row);
    keyboard.push([{ text: "🔙 Back to Categories", callback_data: "cmd_postquiz" }]);

    const text = `🎯 <b>Step 2/3: Number of Questions</b>\n\nCategory: <b>${category}</b> (Available: <code>${available}</code>)\n\nHow many questions would you like to post?`;
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  // Step 3: Count chosen -> Pick Timing
  if (data.startsWith("cnt:")) {
    const count = parseInt(data.substring(4), 10);
    if (!sessions[userId]) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Please send /postquiz again." });
      return;
    }

    sessions[userId].count = count;
    const cat = sessions[userId].category;

    const keyboard = [
      [{ text: "🚀 Post Immediately (Now)", callback_data: "time:0" }],
      [
        { text: "⏱ In 5 Mins", callback_data: "time:5" },
        { text: "⏱ In 15 Mins", callback_data: "time:15" }
      ],
      [
        { text: "⏱ In 30 Mins", callback_data: "time:30" },
        { text: "⏱ In 1 Hour", callback_data: "time:60" }
      ],
      [{ text: "❌ Cancel", callback_data: "cancel" }]
    ];

    const text = `🎯 <b>Step 3/3: Schedule Quiz Posting</b>\n\n• Category: <b>${cat}</b>\n• Questions: <b>${count}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n\nWhen would you like to post this quiz?`;
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  // Step 4: Timing chosen -> Post or Schedule
  if (data.startsWith("time:")) {
    const delay = parseInt(data.substring(5), 10);
    if (!sessions[userId]) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Please send /postquiz again." });
      return;
    }

    const { category, count } = sessions[userId];
    delete sessions[userId];

    if (delay === 0) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏳ Fetching <code>${count}</code> questions from <b>${category}</b> and publishing to channel...`,
        parse_mode: 'HTML'
      });
      postQuiz(chatId, category, count);
    } else {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏰ <b>Quiz Scheduled!</b>\n\n• Category: <b>${category}</b>\n• Questions: <b>${count}</b>\n• Time: <b>In ${delay} minutes</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n\nI will post them automatically! 🚀`,
        parse_mode: 'HTML'
      });
      setTimeout(() => {
        postQuiz(chatId, category, count);
      }, delay * 60 * 1000);
    }
  }
}

async function postQuiz(adminChatId, category, count) {
  try {
    const allDocs = await fetchAllDocuments();
    const candidateDocs = allDocs.filter(d => !d.is_used && d.category === category).slice(0, count);

    if (candidateDocs.length === 0) {
      await callTelegram('sendMessage', {
        chat_id: adminChatId,
        text: `⚠️ No unused questions found for <b>${category}</b> at post time.`,
        parse_mode: 'HTML'
      });
      return;
    }

    console.log(`Posting ${candidateDocs.length} questions for category ${category}...`);

    for (let i = 0; i < candidateDocs.length; i++) {
      const q = candidateDocs[i];
      const formattedQ = (q.question_text || "").trim();
      const hasTableOrMultiline = formattedQ.includes('\n') || formattedQ.includes('➔') || formattedQ.length > 120;

      // Clean options (Telegram limit: max 98 chars per option)
      const cleanOptions = (q.options && q.options.length >= 2 ? q.options : ["Option A", "Option B", "Option C", "Option D"])
        .map(opt => String(opt).trim().substring(0, 98));

      const correctOptId = isNaN(q.correct_option_id) ? 0 : q.correct_option_id;
      const cleanExplanation = q.explanation && q.explanation.trim().length > 0
        ? q.explanation.trim().substring(0, 195)
        : undefined;

      if (hasTableOrMultiline) {
        // Step 1: Send formatted question text with complete line breaks and arrows
        const messageText = `📝 <b>प्रश्न #${i + 1}:</b>\n\n${formattedQ}\n\n👇 <b>सही विकल्प / कूट का चयन करें:</b>`;
        await callTelegram('sendMessage', {
          chat_id: TELEGRAM_CHANNEL_ID,
          text: messageText,
          parse_mode: 'HTML'
        });

        await new Promise(r => setTimeout(r, 800));

        // Step 2: Send the Quiz Poll for voting
        const pollData = {
          chat_id: TELEGRAM_CHANNEL_ID,
          question: `प्रश्न #${i + 1} का सही उत्तर चुनें:`,
          options: cleanOptions,
          type: "quiz",
          correct_option_id: correctOptId,
          is_anonymous: true
        };
        if (cleanExplanation) pollData.explanation = cleanExplanation;

        const res = await callTelegram('sendPoll', pollData);
        if (res.ok) {
          await markQuestionAsUsed(q.fullName);
        } else {
          console.error("Failed to send poll:", res);
        }
      } else {
        // Standard single-line question: send as direct poll
        const pollData = {
          chat_id: TELEGRAM_CHANNEL_ID,
          question: formattedQ.substring(0, 295),
          options: cleanOptions,
          type: "quiz",
          correct_option_id: correctOptId,
          is_anonymous: true
        };
        if (cleanExplanation) pollData.explanation = cleanExplanation;

        const res = await callTelegram('sendPoll', pollData);
        if (res.ok) {
          await markQuestionAsUsed(q.fullName);
        } else {
          console.error("Failed to send poll:", res);
        }
      }

      // Small delay between questions
      await new Promise(r => setTimeout(r, 1500));
    }

    await callTelegram('sendMessage', {
      chat_id: adminChatId,
      text: `✅ <b>Successfully posted ${candidateDocs.length} quiz question(s) to your channel!</b>\n\n• Category: <b>${category}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n• Questions marked as used in Firestore. 🎯`,
      parse_mode: 'HTML'
    });

  } catch (err) {
    console.error("Error in postQuiz:", err);
    await callTelegram('sendMessage', {
      chat_id: adminChatId,
      text: `❌ Error posting quiz: <code>${err.message}</code>`,
      parse_mode: 'HTML'
    });
  }
}

// Telegram Polling Loop
let lastUpdateId = 0;

async function pollUpdates() {
  try {
    const res = await callTelegram('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30
    });

    if (res.ok && res.result && res.result.length > 0) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;

        if (update.message) {
          await handleMessage(update.message);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
      }
    }
  } catch (e) {
    console.error("Polling error:", e.message);
    await new Promise(r => setTimeout(r, 3000));
  }

  setImmediate(pollUpdates);
}

console.log("====================================================");
console.log("🚀 Telegram Quiz Automation Bot is RUNNING!");
console.log(`• Bot: @Raj_56bot`);
console.log(`• Target Channel: Rajasthan Cet 2026 (${TELEGRAM_CHANNEL_ID})`);
console.log(`• Database: Firestore (${PROJECT_ID})`);
console.log("====================================================");

pollUpdates();
