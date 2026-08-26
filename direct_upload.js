const fs = require('fs');
const https = require('https');
const path = require('path');

const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
if (!fs.existsSync(configPath)) {
  console.error("No firebase config found");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = firebaseConfig.tokens || {};
const user = firebaseConfig.user || {};
console.log("Logged in user:", user.email);

let accessToken = tokens.access_token;
const refreshToken = tokens.refresh_token;

async function getValidToken() {
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60000 && accessToken) {
    return accessToken;
  }
  // Refresh token using Google OAuth endpoint
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

async function uploadQuestions() {
  const token = await getValidToken();
  const questionsPath = path.join(__dirname, 'questions.json');
  const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  console.log(`Found ${questions.length} questions to upload to project telegram-9f787...`);

  const projectId = "telegram-9f787";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/questions`;

  let uploadedCount = 0;

  for (const q of questions) {
    const firestoreDoc = {
      fields: {
        category: { stringValue: q.category || "General" },
        question_text: { stringValue: q.question_text || "" },
        options: {
          arrayValue: {
            values: (q.options || []).map(opt => ({ stringValue: String(opt) }))
          }
        },
        correct_option_id: { integerValue: String(q.correct_option_id || 0) },
        explanation: { stringValue: q.explanation || "" },
        is_used: { booleanValue: false },
        created_at: { timestampValue: new Date().toISOString() }
      }
    };

    await new Promise((resolve, reject) => {
      const body = JSON.stringify(firestoreDoc);
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let respData = '';
        res.on('data', c => respData += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            uploadedCount++;
            resolve();
          } else {
            console.error(`Error uploading question: ${res.statusCode} - ${respData}`);
            resolve(); // continue
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  console.log(`✅ Finished: Successfully uploaded ${uploadedCount}/${questions.length} questions to Firestore project: ${projectId}!`);
}

uploadQuestions().catch(err => {
  console.error("Upload error:", err);
});
