const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'export_tests_1787746005272.json');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log(`Total tests in file: ${raw.length}`);

let totalQuestions = 0;
const parsedQuestions = [];

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

raw.forEach((test, tIdx) => {
  const testTitle = test.title || `Test ${tIdx + 1}`;
  const questions = test.questions || [];
  console.log(`Test "${testTitle}": ${questions.length} questions`);

  questions.forEach(q => {
    totalQuestions++;

    // Prefer Hindi if available, fallback to English or direct string
    let questionText = "";
    if (typeof q.question === 'object' && q.question !== null) {
      questionText = q.question.hindi || q.question.english || "";
    } else if (typeof q.question === 'string') {
      questionText = q.question;
    } else if (typeof q.question_text === 'string') {
      questionText = q.question_text;
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

    // Correct Option ID
    let correctId = 0;
    if (q.correctAnswer !== undefined) {
      correctId = getLetterIdx(q.correctAnswer);
    } else if (q.correct_option_id !== undefined) {
      correctId = parseInt(q.correct_option_id, 10);
    }

    // Explanation
    let explanation = "";
    if (typeof q.explanation === 'object' && q.explanation !== null) {
      explanation = q.explanation.hindi || q.explanation.english || "";
    } else if (typeof q.explanation === 'string') {
      explanation = q.explanation;
    }

    // Clean explanation of Markdown formatting for Telegram if needed
    explanation = explanation.replace(/^###\s*व्याख्या\s*/i, '').replace(/^###\s*Explanation\s*/i, '').trim();

    parsedQuestions.push({
      category: "Rajasthan GK",
      question_text: questionText.trim(),
      options: options.map(opt => String(opt).trim()),
      correct_option_id: correctId,
      explanation: explanation,
      is_used: false,
      created_at: new Date().toISOString(),
      source_test: testTitle
    });
  });
});

console.log(`\nTotal parsed questions: ${parsedQuestions.length}`);
console.log("\nSample Parsed Question 1:");
console.log(JSON.stringify(parsedQuestions[0], null, 2));

console.log("\nSample Parsed Question 2:");
console.log(JSON.stringify(parsedQuestions[1], null, 2));
