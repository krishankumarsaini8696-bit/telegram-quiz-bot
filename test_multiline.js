const https = require('https');

const TELEGRAM_BOT_TOKEN = "8846369362:AAHdB98_mTP74soB5sssbVv_XE5NZMgy72I";
const TELEGRAM_CHANNEL_ID = "-1004340852837";

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

async function testMultiline() {
  const formattedText = `📋 <b>सुमेलित कीजिए:</b>\n\n<b>सूची-I (लोक देवता) ➔ सूची-II (पत्नी का नाम)</b>\n(A) तेजाजी ➔ (1) नेतलदे\n(B) रामदेव जी ➔ (2) फूलमदे (सुप्यारदे)\n(C) गोगाजी ➔ (3) पेमल\n(D) पाबूजी ➔ (4) केलमदे\n\n👇 <b>सही कूट का चयन करें:</b>`;

  console.log("Sending formatted question message...");
  const msgRes = await callTelegram('sendMessage', {
    chat_id: TELEGRAM_CHANNEL_ID,
    text: formattedText,
    parse_mode: 'HTML'
  });
  console.log("Message result:", msgRes.ok);

  console.log("Sending corresponding Quiz poll...");
  const pollRes = await callTelegram('sendPoll', {
    chat_id: TELEGRAM_CHANNEL_ID,
    question: "उपरोक्त प्रश्न का सही कूट (Answer) चुनें:",
    options: [
      "A-4, B-2, C-3, D-1",
      "A-3, B-1, C-4, D-2",
      "A-3, B-4, C-1, D-2",
      "A-1, B-3, C-2, D-4"
    ],
    type: "quiz",
    correct_option_id: 1,
    explanation: "तेजाजी-पेमल, रामदेव जी-नेतलदे, गोगाजी-केलमदे, पाबूजी-फूलमदे",
    is_anonymous: true
  });
  console.log("Poll result:", pollRes.ok);
}

testMultiline();
