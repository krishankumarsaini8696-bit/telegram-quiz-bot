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
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');
const CHANNELS_FILE = path.join(__dirname, 'channels.json');
const CATEGORIES_FILE = path.join(__dirname, 'categories.json');

// ==========================================
// 2. FIREBASE & DATA STORAGE INITIALIZATION
// ==========================================
let db = null;
let isFirestoreAvailable = false;

function initFirebase() {
  if (process.env.FIREBASE_CREDENTIALS) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      isFirestoreAvailable = true;
      console.log("✅ Firebase initialized from FIREBASE_CREDENTIALS env var!");
      return;
    } catch (e) {
      console.error("Failed to parse FIREBASE_CREDENTIALS env var:", e);
    }
  } else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
    try {
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
      isFirestoreAvailable = true;
      console.log("✅ Firebase initialized from serviceAccountKey.json file!");
      return;
    } catch (e) {
      console.error("Failed to parse serviceAccountKey.json:", e);
    }
  } else {
    try {
      admin.initializeApp({ projectId: "telegram-9f787" });
      db = admin.firestore();
    } catch (e) { }
  }
}

initFirebase();

// Local Questions Storage Helpers
function getLocalQuestions() {
  if (!fs.existsSync(QUESTIONS_FILE)) return [];
  try {
    const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return arr.map((q, idx) => ({ id: q.id || `q_${idx + 1}`, ...q }));
  } catch (e) {
    return [];
  }
}

function saveLocalQuestions(questions) {
  try {
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf8');
  } catch (e) {
    console.error("Error saving local questions:", e);
  }
}

// Local Channels Storage Helpers
function getLocalChannels() {
  if (!fs.existsSync(CHANNELS_FILE)) {
    const defaultChannels = [
      {
        id: "chan_default",
        name: "Rajasthan Cet 2026",
        chatId: TELEGRAM_CHANNEL_ID,
        botToken: "",
        enabled: true,
        type: "channel",
        createdAt: new Date().toISOString()
      }
    ];
    saveLocalChannels(defaultChannels);
    return defaultChannels;
  }
  try {
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) {
      const defaultChannels = [
        {
          id: "chan_default",
          name: "Rajasthan Cet 2026",
          chatId: TELEGRAM_CHANNEL_ID,
          botToken: "",
          enabled: true,
          type: "channel",
          createdAt: new Date().toISOString()
        }
      ];
      saveLocalChannels(defaultChannels);
      return defaultChannels;
    }
    return arr;
  } catch (e) {
    return [];
  }
}

function saveLocalChannels(channels) {
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2), 'utf8');
  } catch (e) {
    console.error("Error saving local channels:", e);
  }
}

// ==========================================
// 3. CATEGORIES & SUBCATEGORIES MANAGEMENT
// ==========================================
function getLocalCategories() {
  const defaultCategories = [
    {
      id: "cat_rajasthan_gk",
      name: "Rajasthan GK",
      icon: "🏰",
      description: "General Knowledge, History, Art & Culture, Geography and Polity of Rajasthan",
      subcategories: [
        { id: "culture", name: "Culture", label: "🎨 कला एवं संस्कृति (Culture)", icon: "🎨" },
        { id: "history", name: "History", label: "🏛️ राजस्थान का इतिहास (History)", icon: "🏛️" },
        { id: "geography", name: "Geography", label: "🗺️ राजस्थान का भूगोल (Geography)", icon: "🗺️" },
        { id: "polity", name: "Polity", label: "⚖️ राजव्यवस्था (Polity)", icon: "⚖️" }
      ],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    }
  ];

  if (!fs.existsSync(CATEGORIES_FILE)) {
    saveLocalCategories(defaultCategories);
    return defaultCategories;
  }

  try {
    const raw = fs.readFileSync(CATEGORIES_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) {
      saveLocalCategories(defaultCategories);
      return defaultCategories;
    }
    return arr;
  } catch (e) {
    return defaultCategories;
  }
}

function saveLocalCategories(categories) {
  try {
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2), 'utf8');
  } catch (e) {
    console.error("Error saving local categories:", e);
  }
}

// Auto-aggregate categories from registry + any unindexed categories from existing questions
async function getFullCategoriesRegistry() {
  const definedCats = getLocalCategories();
  const definedMap = new Map();

  definedCats.forEach(cat => {
    definedMap.set(cat.name.trim().toLowerCase(), {
      ...cat,
      subcategories: Array.isArray(cat.subcategories) ? [...cat.subcategories] : []
    });
  });

  const questions = await getAllQuestions();
  questions.forEach(q => {
    const rawCat = (q.category || 'Rajasthan GK').trim();
    const catKey = rawCat.toLowerCase();
    const rawSub = (q.subcategory || 'General').trim();
    const subKey = rawSub.toLowerCase();

    if (!definedMap.has(catKey)) {
      const newCatObj = {
        id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: rawCat,
        icon: "📁",
        description: `Questions in ${rawCat}`,
        subcategories: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      definedMap.set(catKey, newCatObj);
    }

    const catObj = definedMap.get(catKey);
    const existingSub = catObj.subcategories.find(s => s.name.trim().toLowerCase() === subKey || s.id === subKey);
    if (!existingSub && rawSub) {
      catObj.subcategories.push({
        id: `sub_${subKey.replace(/[^a-z0-9]/g, '_') || Date.now()}`,
        name: rawSub,
        label: `📂 ${rawSub}`,
        icon: "📂"
      });
    }
  });

  return Array.from(definedMap.values());
}

async function getAllQuestions() {
  if (db && isFirestoreAvailable) {
    try {
      const snapshot = await db.collection('questions').get();
      const docs = [];
      snapshot.forEach(d => docs.push({ id: d.id, ...d.data() }));
      return docs;
    } catch (e) {
      isFirestoreAvailable = false;
    }
  }
  return getLocalQuestions();
}

async function getStatsAndHierarchy() {
  const questions = await getAllQuestions();
  const categoriesList = await getFullCategoriesRegistry();

  let total = 0;
  let used = 0;
  let unused = 0;

  // Initialize categories hierarchy container
  const categoriesHierarchy = {};
  categoriesList.forEach(cat => {
    const catName = cat.name.trim();
    categoriesHierarchy[catName] = {
      id: cat.id,
      name: catName,
      icon: cat.icon || "📁",
      description: cat.description || "",
      total: 0,
      unused: 0,
      used: 0,
      subcategories: {}
    };

    (cat.subcategories || []).forEach(sub => {
      const subName = sub.name.trim();
      categoriesHierarchy[catName].subcategories[subName] = {
        id: sub.id,
        name: subName,
        label: sub.label || `📂 ${subName}`,
        icon: sub.icon || "📂",
        total: 0,
        unused: 0,
        used: 0,
        topics: {}
      };
    });
  });

  // Backward compatibility structures
  const subCounts = { history: 0, culture: 0, geography: 0, polity: 0 };
  const topicCounts = { history: {}, culture: {}, geography: {}, polity: {} };

  questions.forEach(q => {
    total++;
    const isUsed = !!q.is_used;
    const catName = (q.category || 'Rajasthan GK').trim();
    const subName = (q.subcategory || 'General').trim();
    const topicName = (q.topic || q.source_test || 'General').trim();

    if (isUsed) {
      used++;
    } else {
      unused++;
    }

    // Ensure category exists in stats
    if (!categoriesHierarchy[catName]) {
      categoriesHierarchy[catName] = {
        id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: catName,
        icon: "📁",
        description: `Questions in ${catName}`,
        total: 0,
        unused: 0,
        used: 0,
        subcategories: {}
      };
    }

    const catStat = categoriesHierarchy[catName];
    catStat.total++;
    if (isUsed) catStat.used++;
    else catStat.unused++;

    // Ensure subcategory exists
    if (!catStat.subcategories[subName]) {
      catStat.subcategories[subName] = {
        id: `sub_${subName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: subName,
        label: `📂 ${subName}`,
        icon: "📂",
        total: 0,
        unused: 0,
        used: 0,
        topics: {}
      };
    }

    const subStat = catStat.subcategories[subName];
    subStat.total++;
    if (isUsed) {
      subStat.used++;
    } else {
      subStat.unused++;
    }

    if (!subStat.topics[topicName]) {
      subStat.topics[topicName] = { total: 0, unused: 0, used: 0 };
    }
    subStat.topics[topicName].total++;
    if (isUsed) {
      subStat.topics[topicName].used++;
    } else {
      subStat.topics[topicName].unused++;
    }

    // Legacy fields for backward compatibility
    const normSub = subName.toLowerCase();
    let legacyKey = 'culture';
    if (normSub.includes('hist') || normSub.includes('इतिहास')) legacyKey = 'history';
    else if (normSub.includes('geog') || normSub.includes('भूगोल')) legacyKey = 'geography';
    else if (normSub.includes('pol') || normSub.includes('राज')) legacyKey = 'polity';

    if (!isUsed) {
      subCounts[legacyKey] = (subCounts[legacyKey] || 0) + 1;
      topicCounts[legacyKey][topicName] = (topicCounts[legacyKey][topicName] || 0) + 1;
    }
  });

  return {
    total,
    used,
    unused,
    categories: categoriesHierarchy,
    categoriesList,
    subCounts,
    topicCounts
  };
}

async function getUnusedQuestions(category, subcategory, topic, limit) {
  const all = await getAllQuestions();
  const matched = [];

  const targetCat = (category || '').trim().toLowerCase();
  const targetSub = (subcategory || '').trim().toLowerCase();
  const targetTopic = (topic || '').trim();

  all.forEach(q => {
    if (q.is_used) return;

    const docCat = (q.category || 'Rajasthan GK').trim().toLowerCase();
    const docSub = (q.subcategory || 'General').trim().toLowerCase();
    const docTopic = (q.topic || q.source_test || 'General').trim();

    // Category check
    if (targetCat && targetCat !== 'all' && docCat !== targetCat) return;

    // Subcategory check
    if (targetSub && targetSub !== 'all') {
      const matchExact = docSub === targetSub;
      const matchPartial = docSub.includes(targetSub) || targetSub.includes(docSub);
      if (!matchExact && !matchPartial) return;
    }

    // Topic check
    if (targetTopic && targetTopic !== 'ALL' && docTopic !== targetTopic) return;

    matched.push(q);
  });

  return matched.slice(0, limit);
}

async function markAsUsed(docIds) {
  const idSet = new Set(docIds);
  const local = getLocalQuestions();
  local.forEach(q => {
    if (idSet.has(q.id)) {
      q.is_used = true;
      q.posted_at = new Date().toISOString();
    }
  });
  saveLocalQuestions(local);

  if (db && isFirestoreAvailable) {
    try {
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      docIds.forEach(id => {
        const ref = db.collection('questions').doc(id);
        batch.update(ref, { is_used: true, posted_at: now });
      });
      await batch.commit();
    } catch (e) { }
  }
}

// ==========================================
// 4. HTTP SERVER & REST API
// ==========================================
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Static Assets
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
  }
  if (pathname === '/style.css') {
    return serveStatic(res, path.join(__dirname, 'public', 'style.css'), 'text/css; charset=utf-8');
  }
  if (pathname === '/app.js') {
    return serveStatic(res, path.join(__dirname, 'public', 'app.js'), 'application/javascript; charset=utf-8');
  }

  // Health endpoint
  if (pathname === '/health' || pathname === '/status') {
    return sendJson(res, 200, {
      status: "ONLINE",
      service: "Telegram Quiz Automation Bot",
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  // REST API Routes
  try {
    // 1. GET /api/stats
    if (method === 'GET' && pathname === '/api/stats') {
      const stats = await getStatsAndHierarchy();
      return sendJson(res, 200, { ok: true, stats });
    }

    // 2. GET /api/categories (Fetch all categories with subcategories)
    if (method === 'GET' && pathname === '/api/categories') {
      const categories = await getFullCategoriesRegistry();
      const stats = await getStatsAndHierarchy();
      return sendJson(res, 200, { ok: true, categories, stats: stats.categories });
    }

    // 3. POST /api/categories (Create new category)
    if (method === 'POST' && pathname === '/api/categories') {
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim();
      const icon = String(body.icon || '📁').trim();
      const description = String(body.description || '').trim();
      const subcategories = Array.isArray(body.subcategories) ? body.subcategories : [];

      if (!name) {
        return sendJson(res, 400, { ok: false, error: 'Category name is required.' });
      }

      let categories = getLocalCategories();
      const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return sendJson(res, 400, { ok: false, error: `Category "${name}" already exists.` });
      }

      const newCategory = {
        id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name,
        icon,
        description,
        subcategories: subcategories.map((s, idx) => ({
          id: s.id || `sub_${Date.now()}_${idx}`,
          name: String(s.name || s).trim(),
          label: s.label || `📂 ${String(s.name || s).trim()}`,
          icon: s.icon || '📂'
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      categories.push(newCategory);
      saveLocalCategories(categories);

      return sendJson(res, 201, { ok: true, category: newCategory, categories });
    }

    // 4. PUT /api/categories/:id (Update or rename category)
    if (method === 'PUT' && pathname.startsWith('/api/categories/') && !pathname.includes('/subcategories')) {
      const id = pathname.split('/')[3];
      const body = await parseJsonBody(req);

      let categories = getLocalCategories();
      const cat = categories.find(c => c.id === id);
      if (!cat) {
        return sendJson(res, 404, { ok: false, error: 'Category not found.' });
      }

      const oldName = cat.name;
      if (body.name) cat.name = String(body.name).trim();
      if (body.icon) cat.icon = String(body.icon).trim();
      if (body.description !== undefined) cat.description = String(body.description).trim();
      cat.updatedAt = new Date().toISOString();

      saveLocalCategories(categories);

      // Cascade update to questions if renamed
      if (body.name && oldName !== cat.name) {
        let allQuestions = await getAllQuestions();
        let updateCount = 0;
        allQuestions = allQuestions.map(q => {
          if ((q.category || '').trim().toLowerCase() === oldName.toLowerCase()) {
            updateCount++;
            return { ...q, category: cat.name };
          }
          return q;
        });
        saveLocalQuestions(allQuestions);
      }

      return sendJson(res, 200, { ok: true, category: cat, categories });
    }

    // 5. DELETE /api/categories/:id (Delete category)
    if (method === 'DELETE' && pathname.startsWith('/api/categories/') && !pathname.includes('/subcategories')) {
      const id = pathname.split('/')[3];
      let categories = getLocalCategories();
      const targetCat = categories.find(c => c.id === id);
      if (!targetCat) {
        return sendJson(res, 404, { ok: false, error: 'Category not found.' });
      }

      categories = categories.filter(c => c.id !== id);
      saveLocalCategories(categories);

      return sendJson(res, 200, { ok: true, message: `Category "${targetCat.name}" deleted.`, categories });
    }

    // 6. POST /api/categories/:id/subcategories (Add subcategory to category)
    if (method === 'POST' && pathname.match(/^\/api\/categories\/[^/]+\/subcategories$/)) {
      const catId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim();
      const label = String(body.label || '').trim();
      const icon = String(body.icon || '📂').trim();

      if (!name) {
        return sendJson(res, 400, { ok: false, error: 'Subcategory name is required.' });
      }

      let categories = getLocalCategories();
      const cat = categories.find(c => c.id === catId);
      if (!cat) {
        return sendJson(res, 404, { ok: false, error: 'Parent category not found.' });
      }

      if (!Array.isArray(cat.subcategories)) cat.subcategories = [];
      const existingSub = cat.subcategories.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (existingSub) {
        return sendJson(res, 400, { ok: false, error: `Subcategory "${name}" already exists in ${cat.name}.` });
      }

      const newSub = {
        id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name,
        label: label || `${icon} ${name}`,
        icon
      };

      cat.subcategories.push(newSub);
      cat.updatedAt = new Date().toISOString();
      saveLocalCategories(categories);

      return sendJson(res, 201, { ok: true, subcategory: newSub, category: cat, categories });
    }

    // 7. PUT /api/categories/:id/subcategories/:subId (Rename subcategory)
    if (method === 'PUT' && pathname.match(/^\/api\/categories\/[^/]+\/subcategories\/[^/]+$/)) {
      const parts = pathname.split('/');
      const catId = parts[3];
      const subId = parts[5];
      const body = await parseJsonBody(req);

      let categories = getLocalCategories();
      const cat = categories.find(c => c.id === catId);
      if (!cat) return sendJson(res, 404, { ok: false, error: 'Category not found.' });

      const sub = (cat.subcategories || []).find(s => s.id === subId);
      if (!sub) return sendJson(res, 404, { ok: false, error: 'Subcategory not found.' });

      const oldSubName = sub.name;
      if (body.name) sub.name = String(body.name).trim();
      if (body.label) sub.label = String(body.label).trim();
      if (body.icon) sub.icon = String(body.icon).trim();
      cat.updatedAt = new Date().toISOString();
      saveLocalCategories(categories);

      // Cascade update to questions
      if (body.name && oldSubName !== sub.name) {
        let allQuestions = await getAllQuestions();
        allQuestions = allQuestions.map(q => {
          if ((q.category || '').trim().toLowerCase() === cat.name.toLowerCase() &&
            (q.subcategory || '').trim().toLowerCase() === oldSubName.toLowerCase()) {
            return { ...q, subcategory: sub.name };
          }
          return q;
        });
        saveLocalQuestions(allQuestions);
      }

      return sendJson(res, 200, { ok: true, subcategory: sub, category: cat, categories });
    }

    // 8. DELETE /api/categories/:id/subcategories/:subId (Delete subcategory)
    if (method === 'DELETE' && pathname.match(/^\/api\/categories\/[^/]+\/subcategories\/[^/]+$/)) {
      const parts = pathname.split('/');
      const catId = parts[3];
      const subId = parts[5];

      let categories = getLocalCategories();
      const cat = categories.find(c => c.id === catId);
      if (!cat) return sendJson(res, 404, { ok: false, error: 'Category not found.' });

      cat.subcategories = (cat.subcategories || []).filter(s => s.id !== subId);
      cat.updatedAt = new Date().toISOString();
      saveLocalCategories(categories);

      return sendJson(res, 200, { ok: true, message: 'Subcategory removed.', category: cat, categories });
    }

    // 9. GET /api/questions
    if (method === 'GET' && pathname === '/api/questions') {
      const search = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
      const category = (parsedUrl.searchParams.get('category') || '').toLowerCase().trim();
      const subcategory = (parsedUrl.searchParams.get('subcategory') || '').toLowerCase().trim();
      const topic = (parsedUrl.searchParams.get('topic') || '').trim();
      const status = (parsedUrl.searchParams.get('status') || '').toLowerCase().trim();

      const all = await getAllQuestions();
      const filtered = all.filter(data => {
        const docCat = (data.category || 'Rajasthan GK').toLowerCase().trim();
        const docSub = (data.subcategory || 'General').toLowerCase().trim();
        const docTopic = (data.topic || data.source_test || 'General').trim();
        const isUsed = !!data.is_used;
        const qText = (data.question_text || data.question || '').toLowerCase();
        const optsText = (data.options || []).join(' ').toLowerCase();

        if (category && category !== 'all' && docCat !== category) return false;
        if (subcategory && subcategory !== 'all' && docSub !== subcategory && !docSub.includes(subcategory)) return false;
        if (topic && topic !== 'ALL' && docTopic !== topic) return false;
        if (status === 'unused' && isUsed) return false;
        if (status === 'used' && !isUsed) return false;
        if (search && !qText.includes(search) && !optsText.includes(search) && !docTopic.toLowerCase().includes(search)) return false;

        return true;
      });

      return sendJson(res, 200, { ok: true, questions: filtered, count: filtered.length });
    }

    // 10. POST /api/questions (Add single question)
    if (method === 'POST' && pathname === '/api/questions') {
      const body = await parseJsonBody(req);
      if (!body.question_text || !body.options || body.options.length < 2) {
        return sendJson(res, 400, { ok: false, error: 'Question text and at least 2 options are required.' });
      }

      const newId = `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const docData = {
        id: newId,
        category: (body.category || 'Rajasthan GK').trim(),
        subcategory: (body.subcategory || 'General').trim(),
        topic: (body.topic || 'General').trim(),
        question_text: body.question_text.trim(),
        options: (body.options || []).map(o => String(o).trim()),
        correct_option_id: parseInt(body.correct_option_id || 0, 10),
        explanation: (body.explanation || '').trim(),
        is_used: false,
        created_at: new Date().toISOString(),
        source_test: body.topic || 'Manual'
      };

      const local = getLocalQuestions();
      local.push(docData);
      saveLocalQuestions(local);

      if (db && isFirestoreAvailable) {
        try {
          await db.collection('questions').doc(newId).set(docData);
        } catch (e) { }
      }

      return sendJson(res, 201, { ok: true, id: newId });
    }

    // 11. PUT /api/questions/:id (Update question)
    if (method === 'PUT' && pathname.startsWith('/api/questions/')) {
      const id = pathname.split('/')[3];
      const body = await parseJsonBody(req);

      const local = getLocalQuestions();
      const item = local.find(q => q.id === id);
      if (item) {
        if (body.question_text !== undefined) item.question_text = body.question_text.trim();
        if (body.options !== undefined) item.options = body.options.map(o => String(o).trim());
        if (body.correct_option_id !== undefined) item.correct_option_id = parseInt(body.correct_option_id, 10);
        if (body.explanation !== undefined) item.explanation = body.explanation.trim();
        if (body.category !== undefined) item.category = body.category.trim();
        if (body.subcategory !== undefined) item.subcategory = body.subcategory.trim();
        if (body.topic !== undefined) item.topic = body.topic.trim();
        if (body.is_used !== undefined) item.is_used = !!body.is_used;
        saveLocalQuestions(local);
      }

      if (db && isFirestoreAvailable) {
        try {
          await db.collection('questions').doc(id).update(body);
        } catch (e) { }
      }

      return sendJson(res, 200, { ok: true, id });
    }

    // 12. DELETE /api/questions/:id
    if (method === 'DELETE' && pathname.startsWith('/api/questions/')) {
      const id = pathname.split('/')[3];
      const local = getLocalQuestions().filter(q => q.id !== id);
      saveLocalQuestions(local);

      if (db && isFirestoreAvailable) {
        try {
          await db.collection('questions').doc(id).delete();
        } catch (e) { }
      }

      return sendJson(res, 200, { ok: true, id });
    }

    // 13. POST /api/questions/reset (Reset is_used)
    if (method === 'POST' && pathname === '/api/questions/reset') {
      const local = getLocalQuestions();
      let resetCount = 0;
      local.forEach(q => {
        if (q.is_used) {
          q.is_used = false;
          q.posted_at = null;
          resetCount++;
        }
      });
      saveLocalQuestions(local);

      if (db && isFirestoreAvailable) {
        try {
          const snapshot = await db.collection('questions').where('is_used', '==', true).get();
          let batch = db.batch();
          let count = 0;
          for (const doc of snapshot.docs) {
            batch.update(doc.ref, { is_used: false, posted_at: null });
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch (e) { }
      }

      return sendJson(res, 200, { ok: true, count: resetCount });
    }

    // 14. POST /api/questions/bulk (Bulk Upload)
    if (method === 'POST' && pathname === '/api/questions/bulk') {
      const body = await parseJsonBody(req);
      const questions = body.questions || [];
      if (!Array.isArray(questions) || questions.length === 0) {
        return sendJson(res, 400, { ok: false, error: 'Questions array is required.' });
      }

      const defaultCat = body.defaultCategory || 'Rajasthan GK';
      const defaultSub = body.defaultSubcategory || 'Culture';

      const local = getLocalQuestions();
      const newItems = questions.map((q, idx) => ({
        id: q.id || `q_${Date.now()}_${idx}`,
        category: (q.category || defaultCat).trim(),
        subcategory: (q.subcategory || defaultSub).trim(),
        topic: (q.topic || 'General').trim(),
        question_text: (q.question_text || q.question || '').trim(),
        options: (q.options || []).map(o => String(o).trim()),
        correct_option_id: parseInt(q.correct_option_id || 0, 10),
        explanation: (q.explanation || '').trim(),
        is_used: false,
        created_at: new Date().toISOString(),
        source_test: q.topic || 'Bulk'
      }));

      saveLocalQuestions(local.concat(newItems));

      if (db && isFirestoreAvailable) {
        try {
          let batch = db.batch();
          let count = 0;
          for (const item of newItems) {
            const docRef = db.collection('questions').doc(item.id);
            batch.set(docRef, item);
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch (e) { }
      }

      return sendJson(res, 201, { ok: true, count: newItems.length });
    }

    // 15. GET /api/channels
    if (method === 'GET' && pathname === '/api/channels') {
      const channels = getLocalChannels();
      return sendJson(res, 200, { ok: true, channels, defaultChatId: TELEGRAM_CHANNEL_ID });
    }

    // 16. POST /api/channels (Add or update channel)
    if (method === 'POST' && pathname === '/api/channels') {
      const body = await parseJsonBody(req);
      const chatId = String(body.chatId || '').trim();
      let name = String(body.name || '').trim();
      const botToken = String(body.botToken || '').trim();
      const enabled = body.enabled !== false;
      const id = body.id || `chan_${Date.now()}`;

      if (!chatId) {
        return sendJson(res, 400, { ok: false, error: "Chat ID is required (e.g. -1004340852837 or @channel)" });
      }

      let type = body.type || 'channel';
      try {
        const chatRes = await callTelegramWithToken(botToken, 'getChat', { chat_id: chatId });
        if (chatRes && chatRes.ok && chatRes.result) {
          if (!name && chatRes.result.title) {
            name = chatRes.result.title;
          }
          type = chatRes.result.type || type;
        }
      } catch (e) { }

      if (!name) name = `Channel (${chatId})`;

      const channels = getLocalChannels();
      const existingIndex = channels.findIndex(c => c.id === id || (c.chatId === chatId && (!c.botToken || c.botToken === botToken)));

      const channelObj = {
        id: existingIndex >= 0 ? channels[existingIndex].id : id,
        name,
        chatId,
        botToken,
        enabled,
        type,
        updatedAt: new Date().toISOString()
      };
      if (existingIndex < 0) {
        channelObj.createdAt = new Date().toISOString();
      }

      if (existingIndex >= 0) {
        channels[existingIndex] = { ...channels[existingIndex], ...channelObj };
      } else {
        channels.push(channelObj);
      }

      saveLocalChannels(channels);
      return sendJson(res, 200, { ok: true, channel: channelObj, channels });
    }

    // 17. POST /api/channels/delete
    if (method === 'POST' && (pathname === '/api/channels/delete' || pathname === '/api/channels/remove')) {
      const body = await parseJsonBody(req);
      const id = body.id;
      if (!id) return sendJson(res, 400, { ok: false, error: "Channel ID required" });

      let channels = getLocalChannels();
      channels = channels.filter(c => c.id !== id);
      saveLocalChannels(channels);
      return sendJson(res, 200, { ok: true, channels });
    }

    // 18. POST /api/channels/toggle
    if (method === 'POST' && pathname === '/api/channels/toggle') {
      const body = await parseJsonBody(req);
      const id = body.id;
      const channels = getLocalChannels();
      const chan = channels.find(c => c.id === id);
      if (!chan) return sendJson(res, 404, { ok: false, error: "Channel not found" });

      chan.enabled = body.enabled !== undefined ? !!body.enabled : !chan.enabled;
      chan.updatedAt = new Date().toISOString();
      saveLocalChannels(channels);
      return sendJson(res, 200, { ok: true, channel: chan, channels });
    }

    // 19. POST /api/channels/test
    if (method === 'POST' && pathname === '/api/channels/test') {
      const body = await parseJsonBody(req);
      const chatId = String(body.chatId || '').trim();
      const botToken = String(body.botToken || '').trim();

      if (!chatId) {
        return sendJson(res, 400, { ok: false, error: "Chat ID is required" });
      }

      const botRes = await callTelegramWithToken(botToken, 'getMe');
      if (!botRes || !botRes.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: `Invalid Bot Token or Telegram API unreachable: ${botRes ? (botRes.description || botRes.error) : 'Unknown error'}`
        });
      }

      const chatRes = await callTelegramWithToken(botToken, 'getChat', { chat_id: chatId });
      if (!chatRes || !chatRes.ok) {
        return sendJson(res, 400, {
          ok: false,
          bot: botRes.result,
          error: `Cannot access chat (${chatId}): ${chatRes ? (chatRes.description || chatRes.error) : 'Unknown error'}. Please ensure the bot (@${botRes.result.username}) is added to this chat as an Administrator with permission to post polls!`
        });
      }

      return sendJson(res, 200, {
        ok: true,
        bot: botRes.result,
        chat: chatRes.result,
        message: `✅ Connection verified! Bot @${botRes.result.username} successfully reached "${chatRes.result.title || chatId}".`
      });
    }

    // 20. POST /api/post-quiz (Direct multi-category multi-channel dispatch)
    if (method === 'POST' && pathname === '/api/post-quiz') {
      const body = await parseJsonBody(req);
      const category = (body.category || 'Rajasthan GK').trim();
      const subcategory = (body.subcategory || 'Culture').trim();
      const topic = body.topic || 'ALL';
      const count = parseInt(body.count || 5, 10);
      const channelIds = Array.isArray(body.channelIds) ? body.channelIds : [];

      const allChannels = getLocalChannels();
      let targetChannels = [];

      if (channelIds.length > 0) {
        targetChannels = allChannels.filter(c => channelIds.includes(c.id) && c.enabled !== false);
      } else {
        targetChannels = allChannels.filter(c => c.enabled !== false);
      }

      if (targetChannels.length === 0) {
        targetChannels = [{
          id: 'chan_default',
          name: 'Rajasthan Cet 2026',
          chatId: TELEGRAM_CHANNEL_ID,
          botToken: TELEGRAM_BOT_TOKEN
        }];
      }

      const candidateDocs = await getUnusedQuestions(category, subcategory, topic, count);
      if (candidateDocs.length === 0) {
        return sendJson(res, 400, {
          ok: false,
          error: `No unused questions found for Category: "${category}", Subcategory: "${subcategory}", Chapter: "${topic}".`
        });
      }

      const postedIds = [];
      const dispatchLogs = [];

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

        let atLeastOneSuccess = false;

        for (const chan of targetChannels) {
          const pollData = {
            chat_id: chan.chatId,
            question: formattedQ.substring(0, 295),
            options: cleanOptions,
            type: "quiz",
            correct_option_id: correctOptId,
            is_anonymous: true
          };
          if (cleanExplanation) pollData.explanation = cleanExplanation;

          const tgRes = await callTelegramWithToken(chan.botToken, 'sendPoll', pollData);
          if (tgRes && tgRes.ok) {
            atLeastOneSuccess = true;
            dispatchLogs.push({
              questionId: q.id,
              channelId: chan.id,
              channelName: chan.name,
              success: true
            });
          } else {
            dispatchLogs.push({
              questionId: q.id,
              channelId: chan.id,
              channelName: chan.name,
              success: false,
              error: tgRes ? (tgRes.description || tgRes.error) : 'Unknown error'
            });
          }

          await new Promise(r => setTimeout(r, 600));
        }

        if (atLeastOneSuccess) {
          postedIds.push(q.id);
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      if (postedIds.length > 0) {
        await markAsUsed(postedIds);
      }

      return sendJson(res, 200, {
        ok: true,
        category,
        subcategory,
        topic,
        postedCount: postedIds.length,
        channelsCount: targetChannels.length,
        targetChannels: targetChannels.map(c => ({ id: c.id, name: c.name, chatId: c.chatId })),
        logs: dispatchLogs
      });
    }

    // 21. POST /api/chapters/rename
    if (method === 'POST' && (pathname === '/api/chapters/rename' || pathname === '/api/chapters/edit')) {
      const body = await parseJsonBody(req);
      const category = (body.category || '').trim();
      const subcategory = (body.subcategory || '').trim();
      const oldTopic = String(body.oldTopic || '').trim();
      const newTopic = String(body.newTopic || '').trim();

      if (!oldTopic || !newTopic) {
        return sendJson(res, 400, { ok: false, error: "Both old and new chapter names are required." });
      }

      let allQuestions = await getAllQuestions();
      const updatedDocs = [];

      allQuestions = allQuestions.map(q => {
        const qCat = (q.category || 'Rajasthan GK').trim();
        const qSub = (q.subcategory || 'General').trim();
        const qTop = (q.topic || q.source_test || '').trim();

        const matchCat = !category || qCat.toLowerCase() === category.toLowerCase();
        const matchSub = !subcategory || qSub.toLowerCase() === subcategory.toLowerCase();

        if (matchCat && matchSub && qTop === oldTopic) {
          const updated = {
            ...q,
            topic: newTopic,
            source_test: newTopic
          };
          if (body.newSubcategory) updated.subcategory = body.newSubcategory.trim();
          if (body.newCategory) updated.category = body.newCategory.trim();
          updatedDocs.push(updated);
          return updated;
        }
        return q;
      });

      saveLocalQuestions(allQuestions);

      if (db && isFirestoreAvailable && updatedDocs.length > 0) {
        try {
          let batch = db.batch();
          let count = 0;
          for (const doc of updatedDocs) {
            const ref = db.collection('questions').doc(doc.id);
            batch.update(ref, {
              topic: doc.topic,
              source_test: doc.source_test,
              subcategory: doc.subcategory,
              category: doc.category
            });
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch (e) { }
      }

      return sendJson(res, 200, {
        ok: true,
        updatedCount: updatedDocs.length,
        oldTopic,
        newTopic
      });
    }

    // 22. POST /api/chapters/delete
    if (method === 'POST' && pathname === '/api/chapters/delete') {
      const body = await parseJsonBody(req);
      const category = (body.category || '').trim();
      const subcategory = (body.subcategory || '').trim();
      const topic = String(body.topic || '').trim();

      if (!topic) {
        return sendJson(res, 400, { ok: false, error: "Chapter name is required." });
      }

      let allQuestions = await getAllQuestions();
      const deletedIds = [];

      allQuestions = allQuestions.filter(q => {
        const qCat = (q.category || 'Rajasthan GK').trim();
        const qSub = (q.subcategory || 'General').trim();
        const qTop = (q.topic || q.source_test || '').trim();

        const matchCat = !category || qCat.toLowerCase() === category.toLowerCase();
        const matchSub = !subcategory || qSub.toLowerCase() === subcategory.toLowerCase();

        if (matchCat && matchSub && qTop === topic) {
          deletedIds.push(q.id);
          return false;
        }
        return true;
      });

      saveLocalQuestions(allQuestions);

      if (db && isFirestoreAvailable && deletedIds.length > 0) {
        try {
          let batch = db.batch();
          let count = 0;
          for (const id of deletedIds) {
            const ref = db.collection('questions').doc(id);
            batch.delete(ref);
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch (e) { }
      }

      return sendJson(res, 200, { ok: true, deletedCount: deletedIds.length, topic });
    }

    // 23. POST /api/chapters/reset
    if (method === 'POST' && pathname === '/api/chapters/reset') {
      const body = await parseJsonBody(req);
      const category = (body.category || '').trim();
      const subcategory = (body.subcategory || '').trim();
      const topic = String(body.topic || '').trim();

      if (!topic) {
        return sendJson(res, 400, { ok: false, error: "Chapter name is required." });
      }

      let allQuestions = await getAllQuestions();
      const resetIds = [];

      allQuestions = allQuestions.map(q => {
        const qCat = (q.category || 'Rajasthan GK').trim();
        const qSub = (q.subcategory || 'General').trim();
        const qTop = (q.topic || q.source_test || '').trim();

        const matchCat = !category || qCat.toLowerCase() === category.toLowerCase();
        const matchSub = !subcategory || qSub.toLowerCase() === subcategory.toLowerCase();

        if (matchCat && matchSub && qTop === topic) {
          resetIds.push(q.id);
          return { ...q, is_used: false, posted_at: null };
        }
        return q;
      });

      saveLocalQuestions(allQuestions);

      if (db && isFirestoreAvailable && resetIds.length > 0) {
        try {
          let batch = db.batch();
          let count = 0;
          for (const id of resetIds) {
            const ref = db.collection('questions').doc(id);
            batch.update(ref, { is_used: false, posted_at: null });
            count++;
            if (count >= 400) {
              await batch.commit();
              batch = db.batch();
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        } catch (e) { }
      }

      return sendJson(res, 200, { ok: true, resetCount: resetIds.length, topic });
    }

    return sendJson(res, 404, { ok: false, error: 'Endpoint Not Found' });
  } catch (apiErr) {
    console.error("API error:", apiErr);
    return sendJson(res, 500, { ok: false, error: apiErr.message });
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Web Admin Dashboard & Health check listening on port ${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} in your browser to manage questions & quizzes!`);
});

// ==========================================
// 5. TELEGRAM API CLIENT
// ==========================================
function callTelegramWithToken(token, method, body = {}) {
  const activeToken = token && String(token).trim().length > 0 ? String(token).trim() : TELEGRAM_BOT_TOKEN;
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request(`https://api.telegram.org/bot${activeToken}/${method}`, {
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
          resolve({ ok: false, error: data });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

function callTelegram(method, body = {}) {
  return callTelegramWithToken(TELEGRAM_BOT_TOKEN, method, body);
}

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
// 6. DYNAMIC TELEGRAM BOT INTERACTION FLOW
// ==========================================
const sessions = {};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const firstName = msg.from.first_name || 'Friend';

  if (text.startsWith('/start')) {
    const stats = await getStatsAndHierarchy();
    const categoriesList = Object.keys(stats.categories || {});
    const catListStr = categoriesList.map(c => `• ${stats.categories[c].icon || '📂'} <b>${c}</b> (${stats.categories[c].unused} available)`).join('\n');

    const welcome = `👋 Hello, <b>${firstName}</b>!\n\n🎯 <b>Telegram Quiz Command Bot</b> is live 24/7 in the cloud!\n\nChannel: <b>Rajasthan Cet 2026</b> (<code>${TELEGRAM_CHANNEL_ID}</code>)\n\n📚 <b>Active Categories:</b>\n${catListStr || '• 🏰 Rajasthan GK'}\n\nCommands:\n• /postquiz - Choose Category, Subject & Topic to post\n• /stats - View detailed database breakdown\n• /help - Help guide`;

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
    const help = `ℹ️ <b>How to use the Multi-Category Quiz Bot:</b>\n\n1. Send /postquiz\n2. Select your <b>Category</b> (e.g. Rajasthan GK, India GK, Science)\n3. Select your <b>Subcategory / Subject</b>\n4. Select your <b>Chapter / Topic</b>\n5. Choose question count (1, 2, 3, 5, 10)\n6. Choose when to post (Now or Scheduled in 5/15/30/60 mins)\n\nThe bot automatically creates native Quiz Polls in your connected channels!`;
    await callTelegram('sendMessage', { chat_id: chatId, text: help, parse_mode: 'HTML' });
  }
}

async function sendStats(chatId, messageId = null) {
  try {
    const stats = await getStatsAndHierarchy();
    const { total, used, unused, categories } = stats;

    let text = `📊 <b>Database Statistics Overview</b>\n\n• <b>Total Questions:</b> <code>${total}</code>\n• <b>Available (Unused):</b> <code>${unused}</code>\n• <b>Already Posted:</b> <code>${used}</code>\n\n📂 <b>Questions Breakdown by Category:</b>\n\n`;

    const catEntries = Object.entries(categories || {});
    if (catEntries.length === 0) {
      text += `<i>(No categories created yet)</i>\n`;
    } else {
      for (const [catName, catData] of catEntries) {
        text += `${catData.icon || '📁'} <b>${catName}</b> &mdash; <code>${catData.unused}</code> available (${catData.total} total)\n`;
        const subEntries = Object.entries(catData.subcategories || {});
        for (const [subName, subData] of subEntries) {
          text += `  • <b>${subData.label || subName}:</b> <code>${subData.unused}</code> available\n`;
          const topicEntries = Object.entries(subData.topics || {});
          if (topicEntries.length > 0) {
            for (const [tName, tCount] of topicEntries) {
              text += `    - <i>${tName}</i>: <code>${tCount}</code>\n`;
            }
          }
        }
        text += `\n`;
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

// Step 1: Category Menu
async function sendCategoryMenu(chatId, messageId = null) {
  try {
    const stats = await getStatsAndHierarchy();
    const categories = stats.categories || {};
    const catEntries = Object.entries(categories);

    if (catEntries.length === 0) {
      const text = "⚠️ No categories found. Please create a category in the Web Admin Dashboard first.";
      if (messageId) {
        await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text });
      } else {
        await callTelegram('sendMessage', { chat_id: chatId, text });
      }
      return;
    }

    const keyboard = [];
    catEntries.forEach(([catName, catData], idx) => {
      const label = `${catData.icon || '📁'} ${catName} (${catData.unused})`;
      keyboard.push([{ text: label, callback_data: `cat:${idx}` }]);
    });

    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = "🎯 <b>Step 1/5: Select Category</b>\n\nChoose the main exam / subject category for your quiz:";
    if (messageId) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    } else {
      await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    }
  } catch (err) {
    console.error("Error in sendCategoryMenu:", err);
  }
}

// Step 2: Subcategory Menu
async function sendSubcategoryMenuForCat(chatId, userId, catIdx, messageId = null) {
  try {
    const stats = await getStatsAndHierarchy();
    const catEntries = Object.entries(stats.categories || {});
    const selected = catEntries[catIdx];

    if (!selected) {
      return sendCategoryMenu(chatId, messageId);
    }

    const [catName, catData] = selected;
    const subEntries = Object.entries(catData.subcategories || {});

    sessions[userId] = {
      catIdx,
      catName,
      catData,
      subList: subEntries.map(s => s[0])
    };

    if (subEntries.length === 0) {
      const keyboard = [
        [{ text: "🔙 Back to Categories", callback_data: "cmd_postquiz" }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ];
      const text = `⚠️ No subcategories found for <b>${catName}</b>. Please create subcategories in the Web Admin Dashboard.`;
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    const keyboard = [];
    subEntries.forEach(([subName, subData], idx) => {
      const label = `${subData.label || subName} (${subData.unused})`;
      keyboard.push([{ text: label, callback_data: `sub:${idx}` }]);
    });

    keyboard.push([{ text: "🔙 Back to Categories", callback_data: "cmd_postquiz" }]);
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = `🎯 <b>Step 2/5: Select Subcategory</b>\n\nCategory: <b>${catName}</b>\n\nChoose the subject / section for your quiz:`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("Error in sendSubcategoryMenuForCat:", err);
  }
}

// Step 3: Topic / Chapter Menu
async function sendTopicMenu(chatId, userId, subIdx, messageId = null) {
  try {
    const session = sessions[userId];
    if (!session) {
      return sendCategoryMenu(chatId, messageId);
    }

    const subName = session.subList[subIdx];
    const subData = session.catData.subcategories[subName] || { name: subName, label: subName, unused: 0, topics: {} };
    const topics = Object.entries(subData.topics || {});
    const totalAvailable = subData.unused || 0;

    session.subIdx = subIdx;
    session.subName = subName;
    session.subLabel = subData.label || subName;
    session.topicsList = topics.map(t => t[0]);
    session.topicCounts = Object.fromEntries(topics);
    session.totalAvailable = totalAvailable;

    if (topics.length === 0 || totalAvailable === 0) {
      const keyboard = [
        [{ text: "🔙 Back to Subcategories", callback_data: `cat:${session.catIdx}` }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ];
      const text = `⚠️ <b>No unused questions available</b> in <b>${session.subLabel}</b> (${session.catName}) right now.\n\nPlease upload questions for this section or choose another subject.`;
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    const keyboard = [];
    keyboard.push([{ text: `🎲 All Topics / Mixed (${totalAvailable} available)`, callback_data: "top:all" }]);

    topics.forEach(([topicName, count], idx) => {
      keyboard.push([{ text: `📖 ${topicName} (${count})`, callback_data: `top:${idx}` }]);
    });

    keyboard.push([{ text: "🔙 Back to Subcategories", callback_data: `cat:${session.catIdx}` }]);
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = `🎯 <b>Step 3/5: Select Topic / Chapter</b>\n\n• Category: <b>${session.catName}</b>\n• Subject: <b>${session.subLabel}</b>\n\nChoose a specific chapter to post questions from:`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("Error in sendTopicMenu:", err);
  }
}

// Step 4: Count Menu
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

    keyboard.push([{ text: "🔙 Back to Topics", callback_data: `sub:${session.subIdx}` }]);
    keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

    const text = `🎯 <b>Step 4/5: Number of Questions</b>\n\n• Category: <b>${session.catName}</b>\n• Subject: <b>${session.subLabel}</b>\n• Chapter: <b>${displayTopic}</b>\n• Available: <code>${available}</code>\n\nHow many questions would you like to post?`;
    await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("Error in sendCountMenu:", err);
  }
}

// Step 5: Schedule / Dispatch Menu
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
      [
        { text: "🔙 Back to Count", callback_data: "back_count" },
        { text: "❌ Cancel", callback_data: "cancel" }
      ]
    ];

    const text = `🎯 <b>Step 5/5: Schedule Quiz Posting</b>\n\n• Category: <b>${session.catName}</b>\n• Subject: <b>${session.subLabel}</b>\n• Chapter: <b>${session.displayTopic}</b>\n• Questions: <b>${count}</b>\n• Destination: <b>Rajasthan Cet 2026</b>\n\nWhen would you like to post this quiz?`;
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
  if (data === "cmd_postquiz") return sendCategoryMenu(chatId, messageId);
  if (data === "cmd_stats") return sendStats(chatId, messageId);

  // Step 2: Category chosen
  if (data.startsWith("cat:")) {
    const catIdx = parseInt(data.substring(4), 10);
    return sendSubcategoryMenuForCat(chatId, userId, catIdx, messageId);
  }

  // Step 3: Subcategory chosen
  if (data.startsWith("sub:")) {
    const subIdx = parseInt(data.substring(4), 10);
    return sendTopicMenu(chatId, userId, subIdx, messageId);
  }

  // Step 4: Topic chosen
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

  // Step 5: Count chosen
  if (data.startsWith("cnt:")) {
    const count = parseInt(data.substring(4), 10);
    return sendScheduleMenu(chatId, userId, count, messageId);
  }

  // Final: Time chosen -> Post or Schedule
  if (data.startsWith("time:")) {
    const delay = parseInt(data.substring(5), 10);
    const session = sessions[userId];
    if (!session) {
      await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text: "⚠️ Session expired. Type /postquiz again." });
      return;
    }

    const { catName, subName, subLabel, topic, displayTopic, count } = session;
    delete sessions[userId];

    if (delay === 0) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏳ Fetching <code>${count}</code> question(s) from <b>${catName} &gt; ${subLabel}</b> and publishing...`,
        parse_mode: 'HTML'
      });
      postQuizToChannel(chatId, catName, subName, subLabel, topic, displayTopic, count);
    } else {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `⏰ <b>Quiz Scheduled!</b>\n\n• Category: <b>${catName}</b>\n• Subject: <b>${subLabel}</b>\n• Chapter: <b>${displayTopic}</b>\n• Questions: <b>${count}</b>\n• Time: <b>In ${delay} minutes</b>\n\nI will post automatically! 🚀`,
        parse_mode: 'HTML'
      });
      setTimeout(() => {
        postQuizToChannel(chatId, catName, subName, subLabel, topic, displayTopic, count);
      }, delay * 60 * 1000);
    }
  }
}

async function postQuizToChannel(adminChatId, catName, subName, subLabel, topic, displayTopic, count) {
  try {
    const candidateDocs = await getUnusedQuestions(catName, subName, topic, count);
    if (candidateDocs.length === 0) {
      await callTelegram('sendMessage', {
        chat_id: adminChatId,
        text: `⚠️ No unused questions found for <b>${displayTopic}</b> in <b>${catName} &gt; ${subLabel}</b>.`,
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
      if (res && res.ok) postedIds.push(q.id);

      await new Promise(r => setTimeout(r, 1500));
    }

    if (postedIds.length > 0) {
      await markAsUsed(postedIds);
    }

    await callTelegram('sendMessage', {
      chat_id: adminChatId,
      text: `✅ <b>Successfully posted ${postedIds.length} quiz question(s) to your channel!</b>\n\n• Category: <b>${catName}</b>\n• Subject: <b>${subLabel}</b>\n• Chapter: <b>${displayTopic}</b>\n• Channel: <b>Rajasthan Cet 2026</b>\n• Questions marked as used. 🎯`,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error("Error posting quiz:", err);
    await callTelegram('sendMessage', { chat_id: adminChatId, text: `❌ Error posting quiz: <code>${err.message}</code>`, parse_mode: 'HTML' });
  }
}

// ==========================================
// 7. POLLING LOOP & LIFECYCLE
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception trapped:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection trapped:', reason);
});

let lastUpdateId = 0;

async function pollUpdates() {
  try {
    const res = await callTelegram('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 20
    });

    if (res && res.ok && Array.isArray(res.result) && res.result.length > 0) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        if (update.message) await handleMessage(update.message);
        else if (update.callback_query) await handleCallback(update.callback_query);
      }
    }
  } catch (e) {
    console.error("Telegram polling error:", e.message);
  }
  setTimeout(pollUpdates, 1500);
}

console.log("====================================================");
console.log("🚀 Multi-Category Telegram Quiz Bot & Command Center Starting...");
console.log(`• Bot: @Raj_56bot`);
console.log(`• Channel: ${TELEGRAM_CHANNEL_ID}`);
console.log("====================================================");

pollUpdates();

