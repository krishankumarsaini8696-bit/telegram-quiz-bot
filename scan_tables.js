const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'export_tests_1787746005272.json');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

raw.forEach((test, tIdx) => {
  const questions = test.questions || [];
  questions.forEach((q, qIdx) => {
    const qHindi = q.question?.hindi || "";
    const qEnglish = q.question?.english || "";
    const explHindi = q.explanation?.hindi || "";
    
    if (qHindi.includes('\n') || qHindi.includes('<table') || qHindi.includes('—') || qHindi.includes(':') || qHindi.includes('1.')) {
      console.log(`\n--- Question #${q.id || qIdx + 1} ---`);
      console.log("Q (Hindi):", qHindi);
      if (q.options?.hindi) {
        console.log("Options (Hindi):", q.options.hindi);
      }
    }
  });
});
