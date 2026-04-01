/* ============================================================
   MATH QUIZ PWA — app.js
   Quiz engine + Dynamic JSON Upload System (Feature 8)
   + GitHub Sync (Feature 9)
   ============================================================ */

// ── Storage keys ───────────────────────────────────────────
const WEAK_KEY    = 'mathquiz_weak_stats';
const BANK_KEY    = 'mathquiz_question_bank';
const META_KEY    = 'mathquiz_bank_meta';
const GITHUB_KEY  = 'mathquiz_github_url';

// ── State ──────────────────────────────────────────────────
let allQuestions  = [];
let sessionQueue  = [];
let sessionIndex  = 0;
let score         = 0;
let attempted     = 0;
let sessionWrong  = [];
let weakStats     = {};
let currentMode   = 'normal';
let selectedTopic = 'All';
let currentQ      = null;

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadWeakStats();
  bindEvents();

  // If GitHub URLs are saved, always fetch fresh data from GitHub (phone auto-refresh)
  const hasGithubUrls = !!localStorage.getItem(GITHUB_KEY);

  if (hasGithubUrls) {
    // Start with localStorage as a fast first render
    loadFromLocalStorage();
    onQuestionsReady('github');
    // Then fetch fresh from GitHub in the background
    await loadAllGithubSources();
  } else {
    const loaded = loadFromLocalStorage();
    if (loaded) {
      onQuestionsReady('uploaded');
    } else {
      try {
        const r = await fetch('./questions.json');
        if (!r.ok) throw new Error('fetch failed');
        const data = await r.json();
        allQuestions = data;
        onQuestionsReady('default');
      } catch {
        showUploadResult('error', 'Could not load built-in questions. Upload a JSON file or load from GitHub to begin.');
        showScreen('home');
      }
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
});

function onQuestionsReady(source) {
  populateTopics();
  updateHomeStats();
  updateBankUI(source);
  showScreen('home');
}

// ══════════════════════════════════════════════════════════
// FEATURE 9: GITHUB SYNC
// ══════════════════════════════════════════════════════════

function restoreGithubUrl() {
  const saved = localStorage.getItem(GITHUB_KEY);
  if (saved) {
    const input = document.getElementById('github-url-input');
    if (input) input.value = saved;
  }
}

function convertToRawUrl(url) {
  url = url.trim();
  // Already a raw URL
  if (url.includes('raw.githubusercontent.com')) return url;
  // Convert normal GitHub URL to raw
  // https://github.com/user/repo/blob/main/file.json
  // → https://raw.githubusercontent.com/user/repo/main/file.json
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (match) {
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  }
  return url; // Return as-is and let fetch fail naturally
}

async function loadFromGithub() {
  const input   = document.getElementById('github-url-input');
  const btn     = document.getElementById('btn-github-load');
  const rawUrl  = input ? input.value.trim() : '';

  if (!rawUrl) {
    showUploadResult('error', 'Please paste a GitHub raw URL first.');
    return;
  }

  const url = convertToRawUrl(rawUrl);

  // Update button state
  btn.disabled    = true;
  btn.textContent = '⏳ Loading…';

  // Show loading indicator
  showUploadResult('partial', 'Fetching from GitHub…', url);

  try {
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} — check the URL is correct and the repo is public`);
    }

    const raw = await response.json();

    if (!Array.isArray(raw)) {
      throw new Error('JSON must be an array of question objects');
    }

    let valid = 0, skipped = 0;
    const newQuestions = [];
    raw.forEach(function(item, idx) {
      const q = validateQuestion(item, idx);
      if (q) { newQuestions.push(q); valid++; }
      else skipped++;
    });

    if (newQuestions.length === 0) {
      throw new Error('No valid questions found in the file (' + skipped + ' invalid entries)');
    }

    const prevLen = allQuestions.length;
    const merged  = mergeQuestions(allQuestions, newQuestions);
    const added   = merged.length - prevLen;
    allQuestions  = merged;

    // Save URL for next time
    let urls = JSON.parse(localStorage.getItem(GITHUB_KEY) || "[]");

if (!urls.includes(rawUrl)) {
  urls.push(rawUrl);
}

localStorage.setItem(GITHUB_KEY, JSON.stringify(urls));

    saveToLocalStorage(merged, { files: 1, total: merged.length, source: 'github' });
    populateTopics();
    updateHomeStats();
    updateBankUI('github');

    const detail = [];
    if (skipped > 0)   detail.push(skipped + ' invalid entries skipped');
    if (added < valid) detail.push((valid - added) + ' duplicates skipped');
    detail.push('URL saved — next visit will remember it');

    showUploadResult('success',
      '✅ Loaded ' + added + ' questions from GitHub',
      detail.join(' · ')
    );
    showToast('GitHub sync complete! ' + added + ' questions loaded.');

  } catch (err) {
    showUploadResult('error',
      'GitHub load failed',
      err.message + ' · Make sure the repo is public and the URL is a raw JSON file'
    );
  } finally {
    btn.disabled    = false;
    btn.textContent = '⬇ Load from GitHub';
  }
}

async function refreshFromGithub() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) {
    showToast('No GitHub URL saved yet.');
    return;
  }

  const btn = document.getElementById('btn-github-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }

  // Clear current bank so we get fresh data (keeps weak stats)
  localStorage.removeItem(BANK_KEY);
  allQuestions = [];

  await loadAllGithubSources();

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
}

function clearGithubUrl() {
  localStorage.removeItem(GITHUB_KEY);
  const input = document.getElementById('github-url-input');
  if (input) input.value = '';
  showToast('GitHub URL cleared.');
}

// ══════════════════════════════════════════════════════════
// FEATURE 8: DYNAMIC JSON UPLOAD SYSTEM
// ══════════════════════════════════════════════════════════

function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  const dropLabel = document.getElementById('drop-zone').querySelector('.drop-label');
  dropLabel.textContent = 'Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '...';

  const fileArray = Array.from(files);
  const promises  = fileArray.map(readFileAsJSON);

  Promise.allSettled(promises).then(results => {
    let totalValid   = 0;
    let totalSkipped = 0;
    let filesOk      = 0;
    let filesFailed  = 0;
    const details    = [];
    const newQuestions = [];

    results.forEach((result, i) => {
      const fname = fileArray[i].name;
      if (result.status === 'rejected') {
        filesFailed++;
        details.push('FAIL ' + fname + ': ' + result.reason);
        return;
      }
      const { valid, skipped, questions } = result.value;
      filesOk++;
      totalValid   += valid;
      totalSkipped += skipped;
      newQuestions.push(...questions);
      details.push('OK ' + fname + ': ' + valid + ' valid' + (skipped > 0 ? ', ' + skipped + ' skipped' : ''));
    });

    if (newQuestions.length === 0) {
      resetDropZone();
      showUploadResult('error',
        'No valid questions found in ' + filesFailed + ' file' + (filesFailed !== 1 ? 's' : '') + '.',
        details.join(' · ')
      );
      return;
    }

    const prevLen = allQuestions.length;
    const merged  = mergeQuestions(allQuestions, newQuestions);
    const added   = merged.length - prevLen;
    allQuestions  = merged;

    saveToLocalStorage(merged, { files: filesOk, total: merged.length, source: 'uploaded' });
    populateTopics();
    updateHomeStats();
    updateBankUI('uploaded');
    resetDropZone();

    const type = filesFailed > 0 ? 'partial' : 'success';
    const headline = filesFailed > 0
      ? 'Loaded ' + added + ' new questions (' + filesFailed + ' file' + (filesFailed > 1 ? 's' : '') + ' failed)'
      : 'Loaded ' + totalValid + ' questions from ' + filesOk + ' file' + (filesOk > 1 ? 's' : '');

    const detailParts = [];
    if (added < totalValid) detailParts.push((totalValid - added) + ' duplicates removed');
    if (totalSkipped > 0)  detailParts.push(totalSkipped + ' invalid questions skipped');
    detailParts.push(...details);

    showUploadResult(type, headline, detailParts.join(' · '));
  });
}

function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      reject('Not a .json file'); return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      let raw;
      try { raw = JSON.parse(e.target.result); }
      catch { reject('Invalid JSON syntax'); return; }

      if (!Array.isArray(raw)) {
        reject('JSON must be an array'); return;
      }

      let valid = 0, skipped = 0;
      const questions = [];
      raw.forEach(function(item, idx) {
        const q = validateQuestion(item, idx);
        if (q) { questions.push(q); valid++; }
        else skipped++;
      });
      resolve({ valid, skipped, questions });
    };
    reader.onerror = function() { reject('FileReader error'); };
    reader.readAsText(file);
  });
}

function validateQuestion(item, idx) {
  if (typeof item !== 'object' || item === null) return null;

  const question = String(item.question || '').trim();
  if (!question) return null;

  if (!Array.isArray(item.options) || item.options.length !== 4) return null;

  const options = item.options.map(function(o) { return String(o || '').trim(); });
  if (options.some(function(o) { return o === ''; })) return null;

  const correct = String(item.correct || '').trim();
  if (!correct || !options.includes(correct)) return null;

  const topic = String(item.topic || 'General').trim();
  const id    = item.id != null ? item.id : stableHash(question);

  return { id: id, question: question, options: options, correct: correct, topic: topic };
}

function mergeQuestions(existing, incoming) {
  const seenIds  = new Set(existing.map(function(q) { return String(q.id); }));
  // Only deduplicate by question text — same question from two files = real duplicate
  const seenText = new Set(existing.map(function(q) { return q.question.toLowerCase().trim(); }));

  const toAdd = [];
  incoming.forEach(function(q) {
    const text = q.question.toLowerCase().trim();
    // Skip true duplicates (same question text)
    if (seenText.has(text)) return;

    // If the ID clashes with an existing one (different question, same id from another file),
    // generate a new unique ID so both questions are kept
    let sid = String(q.id);
    if (seenIds.has(sid)) {
      sid = stableHash(text + '_' + Date.now() + '_' + Math.random());
      q = Object.assign({}, q, { id: sid });
    }

    seenIds.add(sid);
    seenText.add(text);
    toAdd.push(q);
  });

  return existing.concat(toAdd);
}

function saveToLocalStorage(questions, meta) {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(questions));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch(e) {
    try {
      localStorage.removeItem(BANK_KEY);
      localStorage.setItem(BANK_KEY, JSON.stringify(questions));
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      showUploadResult('error', 'Storage quota exceeded. Try a smaller question bank.');
    }
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    allQuestions = parsed;
    return true;
  } catch { return false; }
}

function clearQuestionBank() {
  localStorage.removeItem(BANK_KEY);
  localStorage.removeItem(META_KEY);
  allQuestions = [];

  showUploadResult('partial', 'Uploaded bank cleared. Reloading built-in questions...');

  fetch('./questions.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allQuestions = data;
      onQuestionsReady('default');
      showUploadResult('success', 'Built-in questions restored (' + data.length + ' questions).');
    })
    .catch(function() {
      showUploadResult('error', 'Could not reload built-in questions.');
    });
}

// ── Upload UI helpers ──────────────────────────────────────

function updateBankUI(source) {
  const badge    = document.getElementById('upload-source-badge');
  const status   = document.getElementById('bank-status');
  const clearBtn = document.getElementById('btn-clear-bank');
  const meta     = getStoredMeta();
  const refreshBtn = document.getElementById('btn-github-refresh');

  if (source === 'github' && meta) {
    badge.textContent = 'GITHUB';
    badge.classList.add('uploaded');
    badge.classList.add('github');
    status.textContent = allQuestions.length + ' questions from GitHub';
    clearBtn.style.display = 'flex';
    if (refreshBtn) refreshBtn.style.display = 'flex';
  } else if (source === 'uploaded' && meta) {
    badge.textContent = 'CUSTOM';
    badge.classList.add('uploaded');
    badge.classList.remove('github');
    status.textContent = allQuestions.length + ' questions from ' + meta.files + ' file' + (meta.files !== 1 ? 's' : '');
    clearBtn.style.display = 'flex';
    if (refreshBtn) refreshBtn.style.display = 'none';
  } else {
    badge.textContent = 'DEFAULT';
    badge.classList.remove('uploaded');
    badge.classList.remove('github');
    status.textContent = allQuestions.length + ' built-in questions';
    clearBtn.style.display = 'none';
    if (refreshBtn) refreshBtn.style.display = 'none';
  }

  // Show refresh if any GitHub URLs are saved
  const savedUrls = localStorage.getItem(GITHUB_KEY);
  if (savedUrls && refreshBtn) refreshBtn.style.display = 'flex';
}

function getStoredMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)); }
  catch { return null; }
}

function showUploadResult(type, headline, detail) {
  const el = document.getElementById('upload-result');
  el.style.display = 'block';
  el.className = 'upload-result ' + type;
  el.innerHTML = '<div style="font-weight:600">' + headline + '</div>' +
    (detail ? '<div class="result-detail">' + detail + '</div>' : '');
}

function resetDropZone() {
  document.getElementById('drop-zone').querySelector('.drop-label').textContent = 'Drop JSON files here';
  document.getElementById('file-input').value = '';
}

function stableHash(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return 'h_' + (h >>> 0).toString(16);
}

// ══════════════════════════════════════════════════════════
// QUIZ ENGINE
// ══════════════════════════════════════════════════════════

function loadWeakStats() {
  try { weakStats = JSON.parse(localStorage.getItem(WEAK_KEY)) || {}; }
  catch { weakStats = {}; }
}

function saveWeakStats() {
  localStorage.setItem(WEAK_KEY, JSON.stringify(weakStats));
}

function populateTopics() {
  const topics = ['All'].concat(
    Array.from(new Set(allQuestions.map(function(q) { return q.topic; }))).sort()
  );
  const sel  = document.getElementById('topic-select');
  const prev = sel.value;
  sel.innerHTML = topics.map(function(t) {
    return '<option value="' + t + '">' + t + '</option>';
  }).join('');
  if (topics.includes(prev)) sel.value = prev;
  else { sel.value = 'All'; selectedTopic = 'All'; }
}

function updateHomeStats() {
  const weakCount      = getWeakQuestions().length;
  const totalAttempted = Object.values(weakStats).reduce(function(s,v) { return s + v.attempts; }, 0);

  document.getElementById('stat-total').textContent     = allQuestions.length;
  document.getElementById('stat-weak').textContent      = weakCount;
  document.getElementById('stat-attempted').textContent = totalAttempted;

  document.getElementById('btn-weak-mode').disabled = weakCount === 0;
  document.getElementById('btn-weak-test').disabled = weakCount === 0;
  document.getElementById('weak-count-badge').textContent = weakCount > 0 ? weakCount + ' weak' : 'none yet';
}

function bindEvents() {
  document.getElementById('btn-start').addEventListener('click', function() { startQuiz('normal'); });
  document.getElementById('btn-weak-mode').addEventListener('click', showWeakList);
  document.getElementById('btn-weak-test').addEventListener('click', function() { startQuiz('weaktest'); });
  document.getElementById('btn-next').addEventListener('click', nextQuestion);
  document.getElementById('btn-home').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-result-home').addEventListener('click', function() { showScreen('home'); updateHomeStats(); });
  document.getElementById('btn-retry-wrong').addEventListener('click', function() { startQuiz('retry'); });
  document.getElementById('btn-weaklist-home').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-start-weak-test').addEventListener('click', function() { startQuiz('weaktest'); });
  document.getElementById('topic-select').addEventListener('change', function(e) { selectedTopic = e.target.value; });
  document.getElementById('btn-clear-bank').addEventListener('click', clearQuestionBank);

  // GitHub sync events
  document.getElementById('btn-github-load').addEventListener('click', loadFromGithub);
  document.getElementById('btn-github-refresh').addEventListener('click', refreshFromGithub);
  document.getElementById('btn-github-clear').addEventListener('click', clearGithubUrl);

  // Allow pressing Enter in URL input
  document.getElementById('github-url-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadFromGithub();
  });

  // Upload events
  var fileInput = document.getElementById('file-input');
  var dropZone  = document.getElementById('drop-zone');

  dropZone.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function(e) { handleFileUpload(e.target.files); });

  dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', function() {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFileUpload(e.dataTransfer.files);
  });
}

function startQuiz(mode) {
  if (allQuestions.length === 0) { showToast('No questions loaded!'); return; }

  currentMode  = mode;
  score        = 0;
  attempted    = 0;
  sessionWrong = [];
  sessionIndex = 0;

  if (mode === 'normal') {
    var pool = selectedTopic === 'All'
      ? allQuestions.slice()
      : allQuestions.filter(function(q) { return q.topic === selectedTopic; });
    sessionQueue = shuffle(pool);
  } else if (mode === 'weaktest' || mode === 'weak') {
    sessionQueue = getWeakQueueSorted();
    if (sessionQueue.length === 0) { showToast('No weak questions yet!'); return; }
  } else if (mode === 'retry') {
    if (sessionWrong.length === 0) { showToast('No wrong answers this session!'); return; }
    sessionQueue = shuffle(sessionWrong.slice());
    sessionWrong = [];
  }

  if (sessionQueue.length === 0) { showToast('No questions for this filter!'); return; }

  showScreen('quiz');
  updateModeIndicator();
  loadQuestion();
}

function loadQuestion() {
  if (sessionIndex >= sessionQueue.length) { showResult(); return; }

  currentQ = sessionQueue[sessionIndex];

  var pct = Math.round((sessionIndex / sessionQueue.length) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = (sessionIndex + 1) + ' / ' + sessionQueue.length;
  document.getElementById('topic-pill').textContent    = currentQ.topic;
  document.getElementById('q-number').textContent      = 'Question ' + (sessionIndex + 1);
  document.getElementById('q-text').textContent        = currentQ.question;

  var stat  = weakStats[currentQ.id];
  var qStat = document.getElementById('q-weak-stat');
  if (stat && stat.wrong > 0) {
    qStat.innerHTML     = '<span class="weak-badge">❗ ' + stat.wrong + ' wrong before</span>';
    qStat.style.display = 'flex';
  } else {
    qStat.style.display = 'none';
  }

  var letters   = ['A', 'B', 'C', 'D'];
  var container = document.getElementById('options-container');
  container.innerHTML = '';
  currentQ.options.forEach(function(opt, i) {
    var btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = '<span class="option-letter">' + letters[i] + '</span><span>' + opt + '</span>';
    btn.addEventListener('click', function() { checkAnswer(opt, btn); });
    container.appendChild(btn);
  });

  document.getElementById('feedback').style.display = 'none';
  document.getElementById('btn-next').style.display = 'none';
}

function checkAnswer(selected, clickedBtn) {
  document.querySelectorAll('.option-btn').forEach(function(b) { b.disabled = true; });

  var isCorrect = selected === currentQ.correct;
  attempted++;
  updateWeakStats(currentQ.id, isCorrect);

  if (isCorrect) {
    score++;
    clickedBtn.classList.add('correct');
    showFeedback(true, null);
  } else {
    clickedBtn.classList.add('wrong');
    sessionWrong.push(currentQ);
    document.querySelectorAll('.option-btn').forEach(function(b) {
      if (b.querySelector('span:last-child').textContent === currentQ.correct)
        b.classList.add('reveal-correct');
    });
    showFeedback(false, currentQ.correct);
  }

  document.getElementById('btn-next').style.display = 'flex';
  sessionIndex++;
}

function showFeedback(correct, correctAnswer) {
  var fb = document.getElementById('feedback');
  fb.style.display = 'flex';
  fb.className     = 'feedback-banner ' + (correct ? 'correct' : 'wrong');
  fb.innerHTML     = correct
    ? '<span class="feedback-icon">✅</span><span>Correct!</span>'
    : '<span class="feedback-icon">❌</span><span>Wrong — Answer: <strong>' + correctAnswer + '</strong></span>';
}

function nextQuestion() { loadQuestion(); }

function updateWeakStats(id, isCorrect) {
  if (!weakStats[id]) weakStats[id] = { attempts: 0, wrong: 0 };
  weakStats[id].attempts++;
  if (!isCorrect) weakStats[id].wrong++;
  else if (weakStats[id].wrong > 0) weakStats[id].wrong = Math.max(0, weakStats[id].wrong - 1);
  saveWeakStats();
}

function getWeakQuestions() {
  return allQuestions.filter(function(q) { return weakStats[q.id] && weakStats[q.id].wrong > 0; });
}

function getWeakQueueSorted() {
  return getWeakQuestions().sort(function(a, b) {
    return (weakStats[b.id] ? weakStats[b.id].wrong : 0) - (weakStats[a.id] ? weakStats[a.id].wrong : 0);
  });
}

function showResult() {
  var pct = attempted > 0 ? Math.round((score / attempted) * 100) : 0;

  document.getElementById('result-score').textContent   = score;
  document.getElementById('result-total').textContent   = attempted;
  document.getElementById('result-pct').textContent     = pct + '%';
  document.getElementById('result-pct2').textContent    = pct + '%';
  document.getElementById('result-correct').textContent = score;
  document.getElementById('result-wrong').textContent   = attempted - score;

  var circumference = 2 * Math.PI * 40;
  var fill = document.getElementById('ring-fill');
  fill.style.strokeDasharray  = circumference;
  fill.style.strokeDashoffset = circumference;
  setTimeout(function() {
    fill.style.strokeDashoffset = circumference - (pct / 100) * circumference;
  }, 100);

  var retryBtn = document.getElementById('btn-retry-wrong');
  retryBtn.style.display = sessionWrong.length > 0 ? 'flex' : 'none';
  if (sessionWrong.length > 0) retryBtn.textContent = '🔁 Retry ' + sessionWrong.length + ' Wrong';

  showScreen('result');
  updateHomeStats();
}

function showWeakList() {
  var weakQs    = getWeakQueueSorted();
  var container = document.getElementById('weak-list');

  if (weakQs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div>' +
      '<p>No weak questions! Keep practicing to build up your weak list.</p></div>';
  } else {
    container.innerHTML = weakQs.map(function(q) {
      var s   = weakStats[q.id];
      var qTx = q.question.length > 70 ? q.question.slice(0, 70) + '…' : q.question;
      return '<div class="weak-item">' +
        '<div class="weak-item-rank">' + s.wrong + '✗</div>' +
        '<div class="weak-item-q">' + qTx + '</div>' +
        '<div class="weak-item-meta">' + s.attempts + ' tries<br>' +
        '<span style="color:var(--muted);font-size:0.65rem">' + q.topic + '</span></div>' +
        '</div>';
    }).join('');
  }

  document.getElementById('weak-count-text').textContent =
    weakQs.length + ' question' + (weakQs.length !== 1 ? 's' : '') + ' need attention';

  showScreen('weaklist');
}

function updateModeIndicator() {
  var el = document.getElementById('mode-indicator');
  if (currentMode === 'weaktest' || currentMode === 'weak') {
    el.textContent = '🔴 Weak Mode'; el.className = 'mode-indicator';
  } else if (currentMode === 'retry') {
    el.textContent = '🔁 Retry Mode'; el.className = 'mode-indicator';
  } else {
    el.textContent = '🟡 Normal Quiz'; el.className = 'mode-indicator normal';
  }
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2800);
}

async function loadAllGithubSources() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) return;

  // Support both old string format and new array format
  let urls;
  try {
    const parsed = JSON.parse(raw);
    urls = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    urls = [raw];
  }

  if (urls.length === 0) return;

  showUploadResult('partial', '⏳ Auto-refreshing ' + urls.length + ' GitHub source' + (urls.length > 1 ? 's' : '') + '...');

  let totalAdded = 0;
  for (const url of urls) {
    const added = await fetchAndMergeGithubUrl(url);
    totalAdded += added;
  }

  saveToLocalStorage(allQuestions, { files: urls.length, total: allQuestions.length, source: 'github' });
  populateTopics();
  updateHomeStats();
  updateBankUI('github');

  if (totalAdded > 0) {
    showUploadResult('success',
      '✅ Auto-synced from GitHub — ' + allQuestions.length + ' questions total',
      totalAdded + ' new questions added this refresh'
    );
  }
}

// Fetches one URL, merges into allQuestions, returns count of newly added questions
async function fetchAndMergeGithubUrl(rawUrl) {
  try {
    const url = convertToRawUrl(rawUrl);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Not an array');

    const newQuestions = [];
    raw.forEach(function(item, idx) {
      const q = validateQuestion(item, idx);
      if (q) newQuestions.push(q);
    });

    const prevLen = allQuestions.length;
    allQuestions = mergeQuestions(allQuestions, newQuestions);
    return allQuestions.length - prevLen;

  } catch (err) {
    console.error('GitHub load failed for', rawUrl, ':', err);
    return 0;
  }
}
