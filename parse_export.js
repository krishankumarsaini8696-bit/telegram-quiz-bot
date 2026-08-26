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

function detectSubcategory(testCategory, testTitle) {
  const combined = `${testCategory || ''} ${testTitle || ''}`.toLowerCase();
  if (combined.includes('art') || combined.includes('culture') || combined.includes('संस्कृति') || combined.includes('देवता') || combined.includes('मेले') || combined.includes('त्यौहार') || combined.includes('दुर्ग') || combined.includes('नृत्य') || combined.includes('साहित्य') || combined.includes('संत')) {
    return "Culture";
  }
  if (combined.includes('geography') || combined.includes('भूगोल') || combined.includes('कृषि') || combined.includes('नदी') || combined.includes('नदियां') || combined.includes('जलवायु') || combined.includes('खनिज') || combined.includes('वन') || combined.includes('सिंचाई')) {
    return "Geography";
  }
  if (combined.includes('polity') || combined.includes('राजव्यवस्था') || combined.includes('विधानसभा') || combined.includes('राज्यपाल') || combined.includes('पंचायत') || combined.includes('न्यायालय') || combined.includes('rpsc')) {
    return "Polity";
  }
  if (combined.includes('history') || combined.includes('इतिहास') || combined.includes('क्रांति') || combined.includes('सभ्यता') || combined.includes('राजवंश') || combined.includes('एकीकरण') || combined.includes('आंदोलन') || combined.includes('प्रजामंडल')) {
    return "History";
  }
  return "Culture";
}

raw.forEach((test, tIdx) => {
  const testTitle = (test.title || `Test ${tIdx + 1}`).trim();
  const rawCat = test.category || test.examCategory || "";
  const subcategory = detectSubcategory(rawCat, testTitle);
  const topic = testTitle;
  const questions = test.questions || [];
  console.log(`Test "${testTitle}" -> Subcategory: ${subcategory}, Topic: ${topic} (${questions.length} questions)`);

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
      subcategory: subcategory,
      topic: topic,
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

// Write to questions.json
fs.writeFileSync(path.join(__dirname, 'questions.json'), JSON.stringify(parsedQuestions, null, 2), 'utf8');
console.log(`✅ Saved ${parsedQuestions.length} Rajasthan GK questions to questions.json!`);
