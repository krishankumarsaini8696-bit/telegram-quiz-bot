const fs = require('fs');
const https = require('https');
const path = require('path');

// 1. Get Firebase Access Token
const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
if (!fs.existsSync(configPath)) {
  console.error("❌ No firebase config found in configstore.");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = firebaseConfig.tokens || {};
const refreshToken = tokens.refresh_token;
let accessToken = tokens.access_token;
const projectId = "telegram-9f787";

async function getValidToken() {
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60000 && accessToken) {
    return accessToken;
  }
  const postData = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    grant_type: "refresh_token",
    refresh_token: refreshToken
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
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            accessToken = parsed.access_token;
            resolve(accessToken);
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

function jsonToFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(item => {
            if (typeof item === 'object' && item !== null) {
              return { mapValue: { fields: jsonToFirestoreFields(item) } };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: jsonToFirestoreFields(val) } };
    }
  }
  return fields;
}

function firestoreRequest(method, endpoint, body = null, token) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${endpoint}`;
    const payload = body ? JSON.stringify(body) : null;
    const payloadBuffer = payload ? Buffer.from(payload, 'utf8') : null;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (payloadBuffer) {
      headers['Content-Length'] = payloadBuffer.length;
    }

    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve({});
          }
        } else {
          reject(new Error(`[${res.statusCode}] ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (payloadBuffer) req.write(payloadBuffer);
    req.end();
  });
}

// Helper to write a specific document
async function setDoc(collection, docId, data, token) {
  const endpoint = `${collection}/${encodeURIComponent(docId)}`;
  return firestoreRequest('PATCH', endpoint, { fields: jsonToFirestoreFields(data) }, token);
}

// Helper to delete a specific document
async function deleteDoc(docPath, token) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/${docPath}`;
    const req = https.request(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetch all existing documents in a collection
async function listAllDocs(collection, token) {
  const docs = [];
  let pageToken = '';
  do {
    const endpoint = `${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    try {
      const resp = await firestoreRequest('GET', endpoint, null, token);
      if (resp.documents && Array.isArray(resp.documents)) {
        docs.push(...resp.documents);
      }
      pageToken = resp.nextPageToken || '';
    } catch (e) {
      console.warn(`Warning reading ${collection}:`, e.message);
      break;
    }
  } while (pageToken);
  return docs;
}

async function runSync() {
  console.log("🚀 Starting Full Firestore Synchronization & Normalization...\n");
  const token = await getValidToken();

  // 1. Sync Categories
  console.log("📂 [1/3] Syncing Categories...");
  const categoriesPath = path.join(__dirname, 'categories.json');
  if (fs.existsSync(categoriesPath)) {
    const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
    for (const cat of categories) {
      const docId = cat.id || `cat_${cat.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      await setDoc('categories', docId, { ...cat, id: docId }, token);
      console.log(`  ✓ Synced Category: "${cat.name}" with ${cat.subcategories?.length || 0} subjects`);
    }
  }

  // 2. Sync Channels
  console.log("\n📢 [2/3] Syncing Telegram Channels...");
  const channelsPath = path.join(__dirname, 'channels.json');
  if (fs.existsSync(channelsPath)) {
    const channels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
    for (const chan of channels) {
      const docId = chan.id || `chan_${Date.now()}`;
      await setDoc('channels', docId, { ...chan, id: docId }, token);
      console.log(`  ✓ Synced Channel: "${chan.name}" (${chan.chatId})`);
    }
  }

  // 3. Clean up legacy/corrupted questions and upload 530 standardized questions
  console.log("\n📚 [3/3] Normalizing & Syncing Questions...");
  const questionsPath = path.join(__dirname, 'questions.json');
  if (!fs.existsSync(questionsPath)) {
    console.error("❌ questions.json not found!");
    return;
  }
  const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
  console.log(`Found ${questions.length} questions in questions.json.`);

  // List existing Firestore question docs to remove orphans
  const existingFirestoreDocs = await listAllDocs('questions', token);
  console.log(`Currently found ${existingFirestoreDocs.length} existing docs in Firestore questions collection.`);

  const validDocIds = new Set(questions.map((q, idx) => q.id || `q_${idx + 1}`));
  let deletedCount = 0;

  for (const doc of existingFirestoreDocs) {
    const docName = doc.name; // projects/.../documents/questions/{id}
    const docId = docName.split('/').pop();
    if (!validDocIds.has(docId)) {
      await deleteDoc(docName, token);
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`  🧹 Cleaned up ${deletedCount} corrupted/legacy documents.`);
  }

  // Batch upload questions
  let uploadedCount = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const docId = q.id || `q_${i + 1}`;
    
    // Normalization & subcategory detection
    let category = (q.category || "Rajasthan GK").trim();
    let subcategory = (q.subcategory || "").trim();
    let topic = (q.topic || q.source_test || "General").trim();

    if (!subcategory) {
      const combined = `${category} ${topic}`.toLowerCase();
      if (combined.includes('लोक देवता') || combined.includes('culture') || combined.includes('संस्कृति') || combined.includes('मेले')) {
        subcategory = "Culture";
      } else if (combined.includes('भौतिक') || combined.includes('विस्तार') || combined.includes('भूगोल') || combined.includes('geography')) {
        subcategory = "Geography";
      } else if (combined.includes('वंश') || combined.includes('इतिहास') || combined.includes('history')) {
        subcategory = "History";
      } else {
        subcategory = "Culture";
      }
    }

    const payload = {
      id: docId,
      category: category,
      subcategory: subcategory,
      topic: topic,
      question_text: q.question_text || q.question || "",
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      correct_option_id: q.correct_option_id !== undefined ? parseInt(q.correct_option_id, 10) : 0,
      explanation: q.explanation || "",
      is_used: false,
      created_at: q.created_at || new Date().toISOString(),
      source_test: q.source_test || topic
    };

    await setDoc('questions', docId, payload, token);
    uploadedCount++;
    if (uploadedCount % 50 === 0 || uploadedCount === questions.length) {
      process.stdout.write(`  ⏳ Uploaded ${uploadedCount}/${questions.length} questions...\r`);
    }
  }

  console.log(`\n\n🎉 SUCCESS: All ${uploadedCount} questions, categories, and channels synced to Firestore!`);
}

runSync().catch(err => {
  console.error("\n❌ Sync Failed:", err);
  process.exit(1);
});
