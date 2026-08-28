const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const configPath = path.join('C:', 'Users', 'krish', '.config', 'configstore', 'firebase-tools.json');
if (!fs.existsSync(configPath)) {
  console.error("❌ No firebase config found");
  process.exit(1);
}

const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = firebaseConfig.tokens || {};
let accessToken = tokens.access_token;
const refreshToken = tokens.refresh_token;
const siteId = "telegram-9f787";

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

function httpsReq(urlStr, method, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqHeaders = { ...headers };
    let payload = null;
    if (body) {
      if (Buffer.isBuffer(body)) {
        payload = body;
      } else if (typeof body === 'object') {
        payload = Buffer.from(JSON.stringify(body), 'utf8');
        reqHeaders['Content-Type'] = 'application/json; charset=utf-8';
      } else {
        payload = Buffer.from(String(body), 'utf8');
      }
      reqHeaders['Content-Length'] = payload.length;
    }

    const req = https.request(url, { method, headers: reqHeaders }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (e) {
            resolve(raw);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const zlib = require('zlib');

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function deploy() {
  console.log(`🚀 Starting Firebase Hosting deployment for site "${siteId}"...`);
  const token = await getValidToken();
  const authHeader = { 'Authorization': `Bearer ${token}` };

  // 1. Create a new Version
  console.log('📦 [1/5] Creating new site version...');
  const versionPayload = {
    config: {
      rewrites: [
        {
          glob: "**",
          path: "/index.html"
        }
      ]
    }
  };
  const versionResp = await httpsReq(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/versions`,
    'POST',
    authHeader,
    versionPayload
  );
  const versionName = versionResp.name; // sites/telegram-9f787/versions/...
  console.log(`  ✓ Version created: ${versionName}`);

  // 2. Gzip & Hash files in public directory
  console.log('📂 [2/5] Compressing, indexing and hashing public/ assets...');
  const publicDir = path.join(__dirname, 'public');
  const filesList = fs.readdirSync(publicDir);
  const fileHashMap = {}; // { '/index.html': gzippedSha256 }
  const fileBufferMap = {}; // { gzippedSha256: gzippedBuffer }

  for (const filename of filesList) {
    const fullPath = path.join(publicDir, filename);
    if (fs.statSync(fullPath).isFile()) {
      const rawContent = fs.readFileSync(fullPath);
      const gzippedContent = zlib.gzipSync(rawContent);
      const hash = computeSha256(gzippedContent);
      const relativeUrl = `/${filename}`;
      fileHashMap[relativeUrl] = hash;
      fileBufferMap[hash] = gzippedContent;
      console.log(`  - ${relativeUrl} (Gzipped: ${gzippedContent.length} bytes, SHA256: ${hash.substring(0, 10)}...)`);
    }
  }

  // 3. Populate files
  console.log('📡 [3/5] Populating file manifest...');
  const populateResp = await httpsReq(
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`,
    'POST',
    authHeader,
    { files: fileHashMap }
  );

  const uploadUrl = populateResp.uploadUrl;
  const requiredHashes = populateResp.uploadRequiredHashes || [];
  console.log(`  ✓ Manifest uploaded. Required files to upload: ${requiredHashes.length}`);

  // 4. Upload missing / changed files
  if (requiredHashes.length > 0) {
    console.log(`⬆️ [4/5] Uploading ${requiredHashes.length} gzipped file(s)...`);
    for (const hash of requiredHashes) {
      const buffer = fileBufferMap[hash];
      if (!buffer) {
        throw new Error(`Missing buffer for hash: ${hash}`);
      }
      await httpsReq(
        `${uploadUrl}/${hash}`,
        'POST',
        {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        buffer
      );
      console.log(`  ✓ Uploaded ${hash.substring(0, 12)}... (${buffer.length} bytes)`);
    }
  } else {
    console.log('⚡ [4/5] All file hashes already cached on CDN!');
  }

  // 5. Finalize version
  console.log('🔒 [5/5] Finalizing version...');
  await httpsReq(
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}?updateMask=status`,
    'PATCH',
    authHeader,
    { status: "FINALIZED" }
  );

  // 6. Release version
  console.log('🚀 Releasing version to production...');
  await httpsReq(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/releases?versionName=${encodeURIComponent(versionName)}`,
    'POST',
    authHeader,
    {}
  );

  console.log(`\n🎉 DEPLOYMENT COMPLETE!`);
  console.log(`🌐 Live URL: https://${siteId}.web.app`);
  console.log(`🌐 Live URL: https://${siteId}.firebaseapp.com\n`);
}

deploy().catch(err => {
  console.error("❌ Deployment failed:", err.message);
  process.exit(1);
});
