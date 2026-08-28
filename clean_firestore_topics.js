const fs = require('fs');
const https = require('https');
const path = require('path');

const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = firebaseConfig.tokens.access_token;
const projectId = 'telegram-9f787';

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

function patchDocById(docId, topic, subcategory) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/questions/${docId}?updateMask.fieldPaths=topic&updateMask.fieldPaths=source_test&updateMask.fieldPaths=subcategory`;
    const payload = JSON.stringify({
      fields: {
        topic: { stringValue: topic },
        source_test: { stringValue: topic },
        subcategory: { stringValue: subcategory }
      }
    });
    const buf = Buffer.from(payload, 'utf8');
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buf.length
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function fixAllById() {
  console.log('Writing clean UTF-8 topics from questions.json to Firestore by ID...');
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const docId = q.id || `q_${i + 1}`;
    await patchDocById(docId, q.topic, q.subcategory);
    if ((i + 1) % 100 === 0 || i === questions.length - 1) {
      process.stdout.write(`  ✓ Updated ${i + 1}/${questions.length} docs...\r`);
    }
  }
  console.log('\n🎉 Finished updating all 530 docs with clean UTF-8 topics!');
}

fixAllById();
