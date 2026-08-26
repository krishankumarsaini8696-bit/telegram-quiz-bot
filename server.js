const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8846369362:AAHdB98_mTP74soB5sssbVv_XE5NZMgy72I";
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || "-1004340852837";
const PORT = process.env.PORT || 8080;

// ==========================================
// 2. FIREBASE INITIALIZATION
// ==========================================
let db;

function initFirebase() {
  if (process.env.FIREBASE_CREDENTIALS) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("✅ Firebase initialized from FIREBASE_CREDENTIALS env var!");
    } catch (e) {
      console.error("Failed to parse FIREBASE_CREDENTIALS env var:", e);
    }
  } else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase initialized from serviceAccountKey.json file!");
  } else {
    // Try application default credentials
    admin.initializeApp({
      projectId: "telegram-9f787"
    });
    console.log("✅ Firebase initialized with project ID: telegram-9f787");
  }
  db = admin.firestore();
}

try {
  initFirebase();
} catch (e) {
  console.error("Firebase init error:", e);
}

// ==========================================
// 3. HTTP HEALTH-CHECK SERVER (For 24/7 Cloud)
// ==========================================
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: "ONLINE",
    service: "Telegram Quiz Automation Bot",
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

// ==========================================
// 4. TELEGRAM API CLIENT
// ==========================================
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

// Helper to format markdown tables into readable text
function formatMarkdownTable(text) {
  if (!text || !text.includes('|')) return text || "";
  const lines = text.split('\n');
  const newLines = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      if (!inTable) {
        inTable = true;
        continue;
      }
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

// ==========================================
// 5. DATABASE OPERATIONS
// ==========================================
async function getCategories() {
  const snapshot = await db.collection('questions').where('is_used', '==', false).get();
  const counts = {};
  snapshot.forEach(doc => {
    const cat = doc.data().category || 'General';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return counts;
}

async function getUnusedQuestions(category, limit) {
  const snapshot = await db.collection('questions')
    .where('category', '==', category)
    .where('is_used', '==', false)
    .limit(limit)
    .get();

  const questions = [];
  snapshot.forEach(doc => {
    questions.push({ id: doc.id, ...doc.data() });
  });
  return questions;
}

async function markAsUsed(docIds) {
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  docIds.forEach(id => {
    const ref = db.collection('questions').doc(id);
    batch.update(ref, { is_used: true, posted_at: now });
  });
  await batch.commit();
}

// ==========================================
// 6. BOT INTERACTION HANDLERS
// ==========================================
const sessions = {};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const firstName = msg.from.first_name || 'Friend';

  if (text.startsWith('/start')) {
    const welcome = `👋 Hello, <b>${firstName}</b>!\n\n🎯 <b>Telegram Quiz Automation Bot</b> is live 24/7 in the cloud!\n\nChannel: <b>Rajasthan Cet 2026</b> (<code>${TELEGRAM_CHANNEL_ID}</code>)\n\nCommands:\n• /postquiz - Post or schedule a quiz\n• /stats - View database questions\n• /help - Help & guide`;
    
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
    const help = `ℹ️ <b>How to use the Quiz Bot:</b>\n\n1. Send /postquiz\n2. Select your category (e.g. Rajasthan GK)\n3. Choose how many questions to post\n4. Choose when to post (Now or Scheduled)\n5. The bot automatically creates native Quiz Polls in your channel!`;
    await callTelegram('sendMessage', { chat_id: chatId, text: help, parse_mode: 'HTML' });
  }
}

async function sendStats(chatId, messageId = null) {
  try {
    const totalSnap = await db.collection('questions').get();
    const catCounts = await getCategories();
    const total = totalSnap.size;
    const unusedCount = Object.values(catCounts).reduce((a, b) => a + b, 0);
    const usedCount = total - unusedCount;

    let text = `📊 <b>Database Statistics</b>\n\n• <b>Total Questions:</b> <code>${total}</code>\n• <b>Available (Unused):</b> <code>${unusedCount}</code>\n• <b>Already Posted:</b> <code>${usedCount}</code>\n\n📂 <b>Unused Questions by Category:</b>\n`;

    if (Object.keys(catCounts).length === 0) {
      text += `<i>No unused questions remaining.</i>`;
    } else {
      for (const [cat, cnt] of Object.entries(catCounts)) {
        text += `  • <b>${cat}:</b> <code>${cnt}</code> questions\n`;
      }
    }

    const markup = {
      inline_keyboard: [[{ text: "🚀 Post a Quiz", callback_data: "cmd_postquiz" }]]
    };

    if (messageId) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: markup });
    } else {
      await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: markup });
    }
  } catch (err) {
    console.error("Error in sendStats:", err);
  }
}

async function sendCategoryMenu(chatId, messageId = null) {
  try {
    const catCounts = await getCategories();
    if (Object.keys(catCounts).length === 0) {
      const msg = "⚠️ <b>No unused questions left in database!</b>";
      if (messageId) {
        await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: msg, parse_mode: 'HTML' });
      } else {
        await callTelegram('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'HTML' });
      }
      return;
    }

    const keyboard = [];
    for (const [cat, count] of Object.entries(catCounts)) {
      keyboard.push([{ text: `📚 ${cat} (${count} available)`, callback_data: `cat:${cat}` }]);
    }
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = "🎯 <b>Step 1/3: Select a Quiz Category</b>\n\nChoose the topic for your quiz:";
    if (messageId) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } else {
      await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }
  } catch (err) {
    console.error("Error in sendCategoryMenu:", err);
  }
}

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
  if (data === "cmd_postquiz") return sendCategoryMenu(chatId, messageId);
  if (data === "cmd_stats") return sendStats(chatId, messageId);

  // Step 2: Category chosen
  if (data.startsWith("cat:")) {
    const category = data.substring(4);
    const catCounts = await getCategories();
    const available = catCounts[category] || 0;

    if (available === 0) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: `⚠️ No unused questions in <b>${category}</b>.`, parse_mode: 'HTML' });
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
    keyboard.push([{ text: "🔙 Back", callback_data: "cmd_postquiz" }]);

    const text = `🎯 <b>Step 2/3: Number of Questions</b>\n\nCategory: <b>${category}</b> (Available: <code>${available}</code>)\n\nHow many questions would you like to post?`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  // Step 3: Count chosen
  if (data.startsWith("cnt:")) {
    const count = parseInt(data.substring(4), 10);
    if (!sessions[userId]) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
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
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  // Step 4: Time chosen -> Post or Schedule
  if (data.startsWith("time:")) {
    const delay = parseInt(data.substring(5), 10);
    if (!sessions[userId]) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
      return;
    }

    const { category, count } = sessions[userId];
    delete sessions[userId];

    if (delay === 0) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: `⏳ Fetching <code>${count}</code> questions from <b>${category}</b> and publishing...`, parse_mode: 'HTML' });
      postQuiz(chatId, category, count);
    } else {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏰ <b>Quiz Scheduled!</b>\n\n• Category: <b>${category}</b>\n• Questions: <b>${count}</b>\n• Time: <b>In ${delay} minutes</b>\n\nI will post automatically! 🚀`,
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
    const candidateDocs = await getUnusedQuestions(category, count);
    if (candidateDocs.length === 0) {
      await callTelegram('sendMessage', { chat_id: adminChatId, text: `⚠️ No unused questions found for <b>${category}</b>.`, parse_mode: 'HTML' });
      return;
    }

    const postedIds = [];

    for (let i = 0; i < candidateDocs.length; i++) {
      const q = candidateDocs[i];
      const rawQ = q.question_text || q.question || "";
      const formattedQ = formatMarkdownTable(rawQ).trim();
      const hasTableOrMultiline = formattedQ.includes('\n') || formattedQ.includes('➔') || formattedQ.length > 120;

      const rawOpts = q.options || [];
      const cleanOptions = (rawOpts.length >= 2 ? rawOpts : ["Option A", "Option B", "Option C", "Option D"])
        .map(opt => String(opt).trim().substring(0, 98));

      const correctOptId = isNaN(q.correct_option_id) ? 0 : parseInt(q.correct_option_id, 10);
      const rawExpl = q.explanation || "";
      const cleanExplanation = rawExpl.trim().length > 0 ? formatMarkdownTable(rawExpl).trim().substring(0, 195) : undefined;

      if (hasTableOrMultiline) {
        const messageText = `📝 <b>प्रश्न #${i + 1}:</b>\n\n${formattedQ}\n\n👇 <b>सही विकल्प / कूट का चयन करें:</b>`;
        await callTelegram('sendMessage', { chat_id: TELEGRAM_CHANNEL_ID, text: messageText, parse_mode: 'HTML' });
        await new Promise(r => setTimeout(r, 800));

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
        if (res.ok) postedIds.push(q.id);
      } else {
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
        if (res.ok) postedIds.push(q.id);
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    if (postedIds.length > 0) {
      await markAsUsed(postedIds);
    }

    await callTelegram('sendMessage', {
      chat_id: adminChatId,
      text: `✅ <b>Successfully posted ${postedIds.length} quiz question(s) to your channel!</b>\n\n• Category: <b>${category}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n• Questions marked as used. 🎯`,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error("Error posting quiz:", err);
    await callTelegram('sendMessage', { chat_id: adminChatId, text: `❌ Error posting quiz: <code>${err.message}</code>`, parse_mode: 'HTML' });
  }
}

// ==========================================
// 7. POLLING LOOP
// ==========================================
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
        if (update.message) await handleMessage(update.message);
        else if (update.callback_query) await handleCallback(update.callback_query);
      }
    }
  } catch (e) {
    console.error("Polling error:", e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  setImmediate(pollUpdates);
}

console.log("====================================================");
console.log("🚀 Telegram Quiz Bot (24/7 Cloud Service) Starting...");
console.log(`• Bot: @Raj_56bot`);
console.log(`• Channel: ${TELEGRAM_CHANNEL_ID}`);
console.log("====================================================");

pollUpdates();
