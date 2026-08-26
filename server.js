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
const SUBCATEGORIES = {
  history: { id: "history", name: "History", label: "🏛️ राजस्थान का इतिहास (History)" },
  culture: { id: "culture", name: "Culture", label: "🎨 कला एवं संस्कृति (Culture)" },
  geography: { id: "geography", name: "Geography", label: "🗺️ राजस्थान का भूगोल (Geography)" },
  polity: { id: "polity", name: "Polity", label: "⚖️ राजव्यवस्था (Polity)" }
};

function normalizeSubcategory(sub) {
  if (!sub) return "culture";
  const s = String(sub).toLowerCase();
  if (s.includes('hist') || s.includes('इतिहास')) return "history";
  if (s.includes('geog') || s.includes('भूगोल')) return "geography";
  if (s.includes('pol') || s.includes('राज')) return "polity";
  return "culture";
}

async function deleteNonRajasthanGK() {
  try {
    const snapshot = await db.collection('questions').get();
    let batch = db.batch();
    let count = 0;
    let totalDeleted = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const cat = (data.category || '').trim().toLowerCase();
      if (cat !== 'rajasthan gk') {
        batch.delete(doc.ref);
        count++;
        totalDeleted++;
        if (count >= 400) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
    }

    if (count > 0) {
      await batch.commit();
    }
    console.log(`🧹 Database cleanup: Deleted ${totalDeleted} non-Rajasthan GK questions.`);
    return totalDeleted;
  } catch (err) {
    console.error("Error during category cleanup:", err.message);
    return 0;
  }
}

async function getStatsAndHierarchy() {
  const snapshot = await db.collection('questions').get();
  let total = 0;
  let used = 0;
  let unused = 0;

  const subCounts = { history: 0, culture: 0, geography: 0, polity: 0 };
  const topicCounts = { history: {}, culture: {}, geography: {}, polity: {} };

  snapshot.forEach(doc => {
    total++;
    const data = doc.data();
    const isUsed = !!data.is_used;
    if (isUsed) {
      used++;
    } else {
      unused++;
      const subKey = normalizeSubcategory(data.subcategory);
      subCounts[subKey] = (subCounts[subKey] || 0) + 1;
      const topic = (data.topic || data.source_test || 'General').trim();
      topicCounts[subKey][topic] = (topicCounts[subKey][topic] || 0) + 1;
    }
  });

  return { total, used, unused, subCounts, topicCounts };
}

async function getUnusedQuestions(subKey, topic, limit) {
  const snapshot = await db.collection('questions').where('is_used', '==', false).get();
  const matched = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const docSubKey = normalizeSubcategory(data.subcategory);
    if (docSubKey === subKey) {
      const docTopic = (data.topic || data.source_test || 'General').trim();
      if (!topic || topic === 'ALL' || docTopic === topic) {
        matched.push({ id: doc.id, ...data });
      }
    }
  });

  return matched.slice(0, limit);
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
    const welcome = `👋 Hello, <b>${firstName}</b>!\n\n🎯 <b>Telegram Quiz Automation Bot</b> is live 24/7 in the cloud!\n\nChannel: <b>Rajasthan Cet 2026</b> (<code>${TELEGRAM_CHANNEL_ID}</code>)\n\nCategories:\n• 🏛️ History\n• 🎨 Culture\n• 🗺️ Geography\n• ⚖️ Polity\n\nCommands:\n• /postquiz - Choose subcategory & topic to post\n• /stats - View detailed questions breakdown\n• /clean - Delete non-Rajasthan GK questions\n• /help - Help guide`;
    
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
    await sendSubcategoryMenu(chatId);
    return;
  }

  if (text.startsWith('/clean') || text.startsWith('/cleancategories')) {
    await callTelegram('sendMessage', { chat_id: chatId, text: "⏳ Cleaning database... Deleting all non-Rajasthan GK categories.", parse_mode: 'HTML' });
    const deleted = await deleteNonRajasthanGK();
    await callTelegram('sendMessage', { chat_id: chatId, text: `✅ <b>Cleanup Complete!</b>\n\nDeleted <code>${deleted}</code> non-Rajasthan GK questions. Only <b>Rajasthan GK</b> is kept in database. 🎯`, parse_mode: 'HTML' });
    return;
  }

  if (text.startsWith('/help')) {
    const help = `ℹ️ <b>How to use the Quiz Bot:</b>\n\n1. Send /postquiz\n2. Select your Subcategory (History, Culture, Geography, Polity)\n3. Select your Topic / Chapter (e.g. राजस्थान के लोक देवता, कृषि, आदि)\n4. Choose how many questions to post\n5. Choose when to post (Now or Scheduled)\n6. The bot automatically creates native Quiz Polls in your channel!`;
    await callTelegram('sendMessage', { chat_id: chatId, text: help, parse_mode: 'HTML' });
  }
}

async function sendStats(chatId, messageId = null) {
  try {
    const stats = await getStatsAndHierarchy();
    const { total, used, unused, subCounts, topicCounts } = stats;

    let text = `📊 <b>Database Statistics (Rajasthan GK)</b>\n\n• <b>Total Questions:</b> <code>${total}</code>\n• <b>Available (Unused):</b> <code>${unused}</code>\n• <b>Already Posted:</b> <code>${used}</code>\n\n📂 <b>Questions by Subcategory & Topics:</b>\n\n`;

    for (const [key, info] of Object.entries(SUBCATEGORIES)) {
      const count = subCounts[key] || 0;
      text += `<b>${info.label}:</b> <code>${count}</code> available\n`;
      const topics = topicCounts[key] || {};
      const topicList = Object.entries(topics);
      if (topicList.length === 0) {
        text += `  <i>(No chapters added yet)</i>\n`;
      } else {
        for (const [tName, tCount] of topicList) {
          text += `  • <b>${tName}:</b> <code>${tCount}</code>\n`;
        }
      }
      text += `\n`;
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

// Step 1: Subcategory Menu
async function sendSubcategoryMenu(chatId, messageId = null) {
  try {
    const { subCounts } = await getStatsAndHierarchy();

    const keyboard = [];
    for (const [key, info] of Object.entries(SUBCATEGORIES)) {
      const count = subCounts[key] || 0;
      keyboard.push([{ text: `${info.label} (${count})`, callback_data: `sub:${key}` }]);
    }
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = "🎯 <b>Step 1/4: Select Subcategory</b>\n\nChoose the subject in <b>Rajasthan GK</b> for your quiz:";
    if (messageId) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } else {
      await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }
  } catch (err) {
    console.error("Error in sendSubcategoryMenu:", err);
  }
}

// Step 2: Topic / Chapter Menu
async function sendTopicMenu(chatId, userId, subKey, messageId = null) {
  try {
    const { subCounts, topicCounts } = await getStatsAndHierarchy();
    const subInfo = SUBCATEGORIES[subKey] || { name: subKey, label: subKey };
    const topics = Object.entries(topicCounts[subKey] || {});
    const totalAvailable = subCounts[subKey] || 0;

    if (topics.length === 0 || totalAvailable === 0) {
      const keyboard = [
        [{ text: "🔙 Back to Subcategories", callback_data: "cmd_postquiz" }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ];
      const text = `⚠️ <b>No unused questions available</b> in <b>${subInfo.label}</b> right now.\n\nPlease upload questions for this section or choose another subcategory.`;
      if (messageId) {
        await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      } else {
        await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }
      return;
    }

    // Save topic list in user session for index-based callback
    sessions[userId] = {
      subKey,
      subName: subInfo.name,
      topicsList: topics.map(t => t[0]),
      topicCounts: Object.fromEntries(topics),
      totalAvailable
    };

    const keyboard = [];
    keyboard.push([{ text: `🎲 All Topics / Mixed (${totalAvailable} available)`, callback_data: "top:all" }]);

    topics.forEach(([topicName, count], idx) => {
      keyboard.push([{ text: `📖 ${topicName} (${count})`, callback_data: `top:${idx}` }]);
    });

    keyboard.push([{ text: "🔙 Back to Subcategories", callback_data: "cmd_postquiz" }]);
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = `🎯 <b>Step 2/4: Select Topic / Chapter</b>\n\nSubcategory: <b>${subInfo.label}</b>\n\nChoose a specific chapter to post questions from:`;
    if (messageId) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } else {
      await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }
  } catch (err) {
    console.error("Error in sendTopicMenu:", err);
  }
}

// Step 3: Question Count Menu
async function sendCountMenu(chatId, userId, topicId, messageId = null) {
  try {
    const session = sessions[userId];
    if (!session) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
      return;
    }

    let topic = "ALL";
    let displayTopic = "All Chapters (मिश्रित प्रश्न)";
    let available = session.totalAvailable;

    if (topicId !== "all") {
      const idx = parseInt(topicId, 10);
      topic = session.topicsList[idx] || "General";
      displayTopic = topic;
      available = session.topicCounts[topic] || 0;
    }

    session.topic = topic;
    session.displayTopic = displayTopic;
    session.available = available;

    let counts = [1, 2, 3, 5, 10].filter(c => c <= available);
    if (!counts.includes(available) && available > 0) {
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

    keyboard.push([{ text: "🔙 Back to Topics", callback_data: `sub:${session.subKey}` }]);
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = `🎯 <b>Step 3/4: Number of Questions</b>\n\n• Subcategory: <b>${session.subName}</b>\n• Topic: <b>${displayTopic}</b>\n• Available: <code>${available}</code>\n\nHow many questions would you like to post?`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("Error in sendCountMenu:", err);
  }
}

// Step 4: Schedule / Timing Menu
async function sendScheduleMenu(chatId, userId, count, messageId = null) {
  try {
    const session = sessions[userId];
    if (!session) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
      return;
    }

    session.count = count;

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
      [{ text: "🔙 Back to Count", callback_data: "back_count" }],
      [{ text: "❌ Cancel", callback_data: "cancel" }]
    ];

    const text = `🎯 <b>Step 4/4: Schedule Quiz Posting</b>\n\n• Subcategory: <b>${session.subName}</b>\n• Chapter: <b>${session.displayTopic}</b>\n• Questions: <b>${count}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n\nWhen would you like to post this quiz?`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("Error in sendScheduleMenu:", err);
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
  if (data === "cmd_postquiz") return sendSubcategoryMenu(chatId, messageId);
  if (data === "cmd_stats") return sendStats(chatId, messageId);

  // Step 2: Subcategory chosen -> show topics
  if (data.startsWith("sub:")) {
    const subKey = data.substring(4);
    return sendTopicMenu(chatId, userId, subKey, messageId);
  }

  // Step 3: Topic chosen -> show question count
  if (data.startsWith("top:")) {
    const topicId = data.substring(4);
    return sendCountMenu(chatId, userId, topicId, messageId);
  }

  // Back to count selection
  if (data === "back_count") {
    const session = sessions[userId];
    if (session) {
      const topicId = session.topic === "ALL" ? "all" : session.topicsList.indexOf(session.topic);
      return sendCountMenu(chatId, userId, String(topicId), messageId);
    }
  }

  // Step 4: Count chosen -> show schedule options
  if (data.startsWith("cnt:")) {
    const count = parseInt(data.substring(4), 10);
    return sendScheduleMenu(chatId, userId, count, messageId);
  }

  // Step 5: Time chosen -> Post or Schedule
  if (data.startsWith("time:")) {
    const delay = parseInt(data.substring(5), 10);
    const session = sessions[userId];
    if (!session) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
      return;
    }

    const { subKey, subName, topic, displayTopic, count } = session;
    delete sessions[userId];

    if (delay === 0) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏳ Fetching <code>${count}</code> question(s) for <b>${displayTopic}</b> and publishing...`,
        parse_mode: 'HTML'
      });
      postQuiz(chatId, subKey, subName, topic, displayTopic, count);
    } else {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏰ <b>Quiz Scheduled!</b>\n\n• Subject: <b>${subName}</b>\n• Chapter: <b>${displayTopic}</b>\n• Questions: <b>${count}</b>\n• Time: <b>In ${delay} minutes</b>\n\nI will post automatically! 🚀`,
        parse_mode: 'HTML'
      });
      setTimeout(() => {
        postQuiz(chatId, subKey, subName, topic, displayTopic, count);
      }, delay * 60 * 1000);
    }
  }
}

async function postQuiz(adminChatId, subKey, subName, topic, displayTopic, count) {
  try {
    const candidateDocs = await getUnusedQuestions(subKey, topic, count);
    if (candidateDocs.length === 0) {
      await callTelegram('sendMessage', {
        chat_id: adminChatId,
        text: `⚠️ No unused questions found for <b>${displayTopic}</b> in <b>${subName}</b>.`,
        parse_mode: 'HTML'
      });
      return;
    }

    const postedIds = [];

    for (let i = 0; i < candidateDocs.length; i++) {
      const q = candidateDocs[i];
      const rawQ = q.question_text || q.question || "";
      const formattedQ = formatMarkdownTable(rawQ).trim();

      const rawOpts = q.options || [];
      const cleanOptions = (rawOpts.length >= 2 ? rawOpts : ["Option A", "Option B", "Option C", "Option D"])
        .map(opt => String(opt).trim().substring(0, 98));

      const correctOptId = isNaN(q.correct_option_id) ? 0 : parseInt(q.correct_option_id, 10);
      const rawExpl = q.explanation || "";
      const cleanExplanation = rawExpl.trim().length > 0 ? formatMarkdownTable(rawExpl).trim().substring(0, 195) : undefined;

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

      await new Promise(r => setTimeout(r, 1500));
    }

    if (postedIds.length > 0) {
      await markAsUsed(postedIds);
    }

    await callTelegram('sendMessage', {
      chat_id: adminChatId,
      text: `✅ <b>Successfully posted ${postedIds.length} quiz question(s) to your channel!</b>\n\n• Subcategory: <b>${subName}</b>\n• Chapter: <b>${displayTopic}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n• Questions marked as used. 🎯`,
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

deleteNonRajasthanGK().finally(() => {
  pollUpdates();
});
