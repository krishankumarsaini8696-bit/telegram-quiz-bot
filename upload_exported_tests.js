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

function getLetterIdx(ans) {
  if (typeof ans === 'number') return ans;
  if (typeof ans === 'string') {
    const clean = ans.trim().toUpperCase();
    if (clean === 'A' || clean === '1') return 0;
    if (clean === 'B' || clean === '2') return 1;
    if (clean === 'C' || clean === '3') return 2;
    if (clean === 'D' || clean === '4') return 3;
    if (clean === 'E' || clean === '5') return 4;
  }
  return 0;
}

async function uploadExportedTests() {
  const token = await getValidToken();
  const filePath = path.join(__dirname, 'export_tests_1787746005272.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const projectId = "telegram-9f787";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/questions`;

  let uploadedCount = 0;
  let skippedCount = 0;

  for (const test of raw) {
    const rawCat = test.category || test.examCategory || "";
    let subcategory = "Culture";
    const combined = `${rawCat} ${testTitle}`.toLowerCase();
    if (combined.includes('art') || combined.includes('culture') || combined.includes('संस्कृति') || combined.includes('देवता') || combined.includes('मेले') || combined.includes('त्यौहार') || combined.includes('दुर्ग') || combined.includes('नृत्य') || combined.includes('साहित्य') || combined.includes('संत')) {
      subcategory = "Culture";
    } else if (combined.includes('geography') || combined.includes('भूगोल') || combined.includes('कृषि') || combined.includes('नदी') || combined.includes('नदियां') || combined.includes('जलवायु') || combined.includes('खनिज') || combined.includes('वन') || combined.includes('सिंचाई')) {
      subcategory = "Geography";
    } else if (combined.includes('polity') || combined.includes('राजव्यवस्था') || combined.includes('विधानसभा') || combined.includes('राज्यपाल') || combined.includes('पंचायत') || combined.includes('न्यायालय') || combined.includes('rpsc')) {
      subcategory = "Polity";
    } else if (combined.includes('history') || combined.includes('इतिहास') || combined.includes('क्रांति') || combined.includes('सभ्यता') || combined.includes('राजवंश') || combined.includes('एकीकरण') || combined.includes('आंदोलन') || combined.includes('प्रजामंडल')) {
      subcategory = "History";
    }

    for (const q of questions) {
      // Question text (prefer Hindi)
      let questionText = "";
      if (typeof q.question === 'object' && q.question !== null) {
        questionText = q.question.hindi || q.question.english || "";
      } else if (typeof q.question === 'string') {
        questionText = q.question;
      }

      // Options
      let options = [];
      if (q.options) {
        if (Array.isArray(q.options)) {
          options = q.options;
        } else if (typeof q.options === 'object') {
          options = q.options.hindi || q.options.english || [];
        }
      }

      if (!questionText || options.length < 2) {
        skippedCount++;
        continue;
      }

      // Correct Option ID
      let correctId = 0;
      if (q.correctAnswer !== undefined) {
        correctId = getLetterIdx(q.correctAnswer);
      }

      // Explanation
      let explanation = "";
      if (typeof q.explanation === 'object' && q.explanation !== null) {
        explanation = q.explanation.hindi || q.explanation.english || "";
      } else if (typeof q.explanation === 'string') {
        explanation = q.explanation;
      }
      explanation = explanation.replace(/^###\s*व्याख्या\s*/i, '').replace(/^###\s*Explanation\s*/i, '').trim();

      const firestoreDoc = {
        fields: {
          category: { stringValue: "Rajasthan GK" },
          subcategory: { stringValue: subcategory },
          topic: { stringValue: testTitle },
          question_text: { stringValue: questionText.trim() },
          options: {
            arrayValue: {
              values: options.map(opt => ({ stringValue: String(opt).trim() }))
            }
          },
          correct_option_id: { integerValue: String(correctId) },
          explanation: { stringValue: explanation },
          is_used: { booleanValue: false },
          created_at: { timestampValue: new Date().toISOString() },
          source_test: { stringValue: testTitle }
        }
      };

      await new Promise((resolve) => {
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
            } else {
              console.error(`Error uploading: ${res.statusCode} - ${respData}`);
            }
            resolve();
          });
        });
        req.on('error', (err) => {
          console.error("Upload req error:", err);
          resolve();
        });
        req.write(body);
        req.end();
      });
    }
  }

  console.log(`\n🎉 Finished: Successfully added ${uploadedCount} questions to Firestore under "Rajasthan GK"! (Skipped: ${skippedCount})`);
}

uploadExportedTests().catch(err => console.error("Error:", err));
