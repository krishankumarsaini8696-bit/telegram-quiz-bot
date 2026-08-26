const fs = require('fs');
const https = require('https');
const path = require('path');

const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = firebaseConfig.tokens || {};
const user = firebaseConfig.user || {};

async function checkDatabase() {
  const token = tokens.access_token;
  const projectId = "telegram-9f787";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/questions`;

  const req = https.request(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const docs = json.documents || [];
        console.log(`\n🎉 Verification Success!`);
        console.log(`Total documents found in Firestore: ${docs.length}`);
        
        const categories = {};
        docs.forEach(d => {
          const cat = d.fields.category?.stringValue || "General";
          categories[cat] = (categories[cat] || 0) + 1;
        });

        console.log("\n📚 Questions by Category in Firestore:");
        Object.entries(categories).forEach(([cat, count]) => {
          console.log(`  - ${cat}: ${count} questions`);
        });
      } catch (e) {
        console.error("Parse error:", e, data);
      }
    });
  });
  req.on('error', console.error);
  req.end();
}

checkDatabase();
