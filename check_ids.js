const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const ids = new Set();
let match;
while ((match = idRegex.exec(appJs)) !== null) {
  ids.add(match[1]);
}

console.log('Total unique getElementById lookups:', ids.size);
const missing = [];
ids.forEach(id => {
  if (!indexHtml.includes(`id="${id}"`) && !indexHtml.includes(`id='${id}'`)) {
    missing.push(id);
  }
});

console.log('Missing IDs in index.html:');
missing.forEach(id => console.log('  ❌ ' + id));
