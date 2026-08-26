const fs = require('fs');
const path = require('path');

function formatMarkdownTable(text) {
  if (!text.includes('|')) return text;

  // Split lines
  const lines = text.split('\n');
  const newLines = [];
  let inTable = false;
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      
      // Skip separator lines like | :--- | :--- | or |---|---|
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        headers = cells;
        // Optionally add a clean header line
        // newLines.push(`📌 ${headers.join(' ⟷ ')}`);
        continue;
      }

      // Format row: e.g. "(A) पाबूजी ➔ (1) पगलिया"
      if (cells.length >= 2) {
        newLines.push(`${cells[0]} ➔ ${cells[1]}`);
      } else if (cells.length === 1) {
        newLines.push(cells[0]);
      }
    } else {
      inTable = false;
      newLines.push(line);
    }
  }

  return newLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const filePath = path.join(__dirname, 'export_tests_1787746005272.json');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

raw.forEach(test => {
  (test.questions || []).forEach((q, idx) => {
    const orig = q.question?.hindi || "";
    if (orig.includes('|')) {
      console.log(`\n================ Question #${q.id || idx + 1} ================`);
      console.log("--- BEFORE ---");
      console.log(orig);
      console.log("\n--- AFTER ---");
      const formatted = formatMarkdownTable(orig);
      console.log(formatted);
      console.log(`Length: ${formatted.length} / 300 chars`);
    }
  });
});
