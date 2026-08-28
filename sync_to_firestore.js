const fs = require('fs');
const https = require('https');
const path = require('path');

const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = firebaseConfig.tokens?.access_token;
const projectId = "telegram-9f787";

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

function writeDoc(collection, docId, data) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
    const payload = JSON.stringify({ fields: jsonToFirestoreFields(data) });
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Firestore Error [${res.statusCode}]: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function syncAll() {
  console.log('🔄 Syncing Categories to Firestore...');
  try {
    const categories = JSON.parse(fs.readFileSync('categories.json', 'utf8'));
    for (const cat of categories) {
      const docId = cat.id || `cat_${Date.now()}`;
      await writeDoc('categories', docId, cat);
      console.log(`  ✓ Synced Category: ${cat.name} (${docId})`);
    }
  } catch (e) {
    console.error('Error syncing categories:', e.message);
  }

  console.log('\n🔄 Syncing Channels to Firestore...');
  try {
    const channels = JSON.parse(fs.readFileSync('channels.json', 'utf8'));
    for (const chan of channels) {
      const docId = chan.id || `chan_${Date.now()}`;
      await writeDoc('channels', docId, chan);
      console.log(`  ✓ Synced Channel: ${chan.name} (${chan.chatId})`);
    }
  } catch (e) {
    console.error('Error syncing channels:', e.message);
  }

  console.log('\n🎉 All metadata synced to Firestore successfully!');
}

syncAll();
