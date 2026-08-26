const https = require('https');

const token = "8846369362:AAHdB98_mTP74soB5sssbVv_XE5NZMgy72I";
const chatId = "-1004340852837";

function apiCall(method, data = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let resp = '';
      res.on('data', c => resp += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(resp));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function test() {
  console.log("Testing Bot Token...");
  const me = await apiCall("getMe");
  console.log("Bot Info:", me);

  console.log(`\nTesting Chat ID: ${chatId}...`);
  const chat = await apiCall("getChat", { chat_id: chatId });
  console.log("Chat Info:", chat);
}

test();
