/* ============================================================
   MATH QUIZ PWA — app.js  v2.0
   + Overall Quiz (custom count, mixed topics)
   + Count-up Timer (optional)
   + Session History (topic + overall + weak)
   + Weak Mode unified across all quiz types
   ============================================================ */

// ── Storage keys ───────────────────────────────────────────
const WEAK_KEY     = 'mathquiz_weak_stats';
const BANK_KEY     = 'mathquiz_question_bank';
const META_KEY     = 'mathquiz_bank_meta';
const GITHUB_KEY   = 'mathquiz_github_url';
const HISTORY_KEY  = 'mathquiz_session_history';

// ── State ──────────────────────────────────────────────────
let allQuestions   = [];
let sessionQueue   = [];
let sessionIndex   = 0;
let score          = 0;
let attempted      = 0;
let sessionWrong   = [];
let weakStats      = {};
let currentMode    = 'normal';   // normal | overall | weaktest | retry
let selectedTopics = [];         // array of selected topic strings (multi-select)
let currentQ       = null;

// Timer state
let timerMode      = 'none';     // none | countup
let timerSeconds   = 0;
let timerInterval  = null;

// Overall quiz setup state
let overallQCount  = 20;

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadWeakStats();
  bindEvents();

  // Restore saved GitHub URL into input
  restoreGithubUrl();

  const hasGithubUrls = !!localStorage.getItem(GITHUB_KEY);

  if (hasGithubUrls) {
    loadFromLocalStorage();
    onQuestionsReady('github');
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
  updateSetupHint();
  showScreen('home');
}

// ══════════════════════════════════════════════════════════
// GITHUB SYNC
// ══════════════════════════════════════════════════════════

function restoreGithubUrl() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const urls = Array.isArray(parsed) ? parsed : [parsed];
    const input = document.getElementById('github-url-input');
    if (input && urls.length > 0) input.value = urls[0];
  } catch {
    const input = document.getElementById('github-url-input');
    if (input) input.value = raw;
  }
}

function convertToRawUrl(url) {
  url = url.trim();
  if (url.includes('raw.githubusercontent.com')) return url;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  return url;
}

async function loadFromGithub() {
  const input  = document.getElementById('github-url-input');
  const btn    = document.getElementById('btn-github-load');
  const rawUrl = input ? input.value.trim() : '';

  if (!rawUrl) { showUploadResult('error', 'Please paste a GitHub raw URL first.'); return; }

  const url = convertToRawUrl(rawUrl);
  btn.disabled = true; btn.textContent = '⏳ Loading…';
  showUploadResult('partial', 'Fetching from GitHub…', url);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} — check the URL is correct and the repo is public`);

    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('JSON must be an array of question objects');

    let valid = 0, skipped = 0;
    const newQuestions = [];
    raw.forEach(function(item, idx) {
      const q = validateQuestion(item, idx);
      if (q) { newQuestions.push(q); valid++; } else skipped++;
    });

    if (newQuestions.length === 0) throw new Error('No valid questions found (' + skipped + ' invalid entries)');

    const prevLen = allQuestions.length;
    const merged  = mergeQuestions(allQuestions, newQuestions);
    const added   = merged.length - prevLen;
    allQuestions  = merged;

    let urls = JSON.parse(localStorage.getItem(GITHUB_KEY) || '[]');
    if (!urls.includes(rawUrl)) urls.push(rawUrl);
    localStorage.setItem(GITHUB_KEY, JSON.stringify(urls));

    saveToLocalStorage(merged, { files: 1, total: merged.length, source: 'github' });
    populateTopics(); updateHomeStats(); updateBankUI('github'); updateSetupHint();

    const detail = [];
    if (skipped > 0)   detail.push(skipped + ' invalid entries skipped');
    if (added < valid) detail.push((valid - added) + ' duplicates skipped');
    detail.push('URL saved — next visit will remember it');

    showUploadResult('success', '✅ Loaded ' + added + ' questions from GitHub', detail.join(' · '));
    showToast('GitHub sync complete! ' + added + ' questions loaded.');

  } catch (err) {
    showUploadResult('error', 'GitHub load failed', err.message + ' · Make sure the repo is public and the URL is a raw JSON file');
  } finally {
    btn.disabled = false; btn.textContent = '⬇ Load from GitHub';
  }
}

async function refreshFromGithub() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) { showToast('No GitHub URL saved yet.'); return; }

  const btn = document.getElementById('btn-github-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }

  localStorage.removeItem(BANK_KEY);
  allQuestions = [];
  await loadAllGithubSources();

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
}

function clearGithubUrl() {
  localStorage.removeItem(GITHUB_KEY);
  const input = document.getElementById('github-url-input');
  if (input) input.value = '';
  updateBankUI('default');
  showToast('GitHub URL cleared.');
}

async function loadAllGithubSources() {
  const urls = getSavedGithubUrls();
  if (urls.length === 0) return;

  showUploadResult('partial', '⏳ Auto-refreshing ' + urls.length + ' GitHub source' + (urls.length > 1 ? 's' : '') + '...');

  let totalAdded = 0;
  for (const url of urls) { totalAdded += await fetchAndMergeGithubUrl(url); }

  saveToLocalStorage(allQuestions, { files: urls.length, total: allQuestions.length, source: 'github' });
  populateTopics(); updateHomeStats(); updateBankUI('github'); updateSetupHint();

  if (totalAdded > 0) {
    showUploadResult('success',
      '✅ Auto-synced from GitHub — ' + allQuestions.length + ' questions total',
      totalAdded + ' new questions added this refresh'
    );
  }
}

async function fetchAndMergeGithubUrl(rawUrl) {
  try {
    const url = convertToRawUrl(rawUrl);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Not an array');
    const newQuestions = [];
    raw.forEach(function(item, idx) { const q = validateQuestion(item, idx); if (q) newQuestions.push(q); });
    const prevLen = allQuestions.length;
    allQuestions = mergeQuestions(allQuestions, newQuestions);
    return allQuestions.length - prevLen;
  } catch (err) { console.error('GitHub load failed for', rawUrl, ':', err); return 0; }
}

// ══════════════════════════════════════════════════════════
// FILE UPLOAD
// ══════════════════════════════════════════════════════════

function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  const dropLabel = document.getElementById('drop-zone').querySelector('.drop-label');
  dropLabel.textContent = 'Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '...';

  const fileArray = Array.from(files);
  Promise.allSettled(fileArray.map(readFileAsJSON)).then(results => {
    let totalValid = 0, totalSkipped = 0, filesOk = 0, filesFailed = 0;
    const details = [], newQuestions = [];

    results.forEach((result, i) => {
      const fname = fileArray[i].name;
      if (result.status === 'rejected') {
        filesFailed++; details.push('FAIL ' + fname + ': ' + result.reason);
        return;
      }
      const { valid, skipped, questions } = result.value;
      filesOk++; totalValid += valid; totalSkipped += skipped;
      newQuestions.push(...questions);
      details.push('OK ' + fname + ': ' + valid + ' valid' + (skipped > 0 ? ', ' + skipped + ' skipped' : ''));
    });

    if (newQuestions.length === 0) {
      resetDropZone();
      showUploadResult('error', 'No valid questions found in ' + filesFailed + ' file' + (filesFailed !== 1 ? 's' : '') + '.', details.join(' · '));
      return;
    }

    const prevLen = allQuestions.length;
    const merged  = mergeQuestions(allQuestions, newQuestions);
    const added   = merged.length - prevLen;
    allQuestions  = merged;

    saveToLocalStorage(merged, { files: filesOk, total: merged.length, source: 'uploaded' });
    populateTopics(); updateHomeStats(); updateBankUI('uploaded'); resetDropZone(); updateSetupHint();

    const type = filesFailed > 0 ? 'partial' : 'success';
    const headline = filesFailed > 0
      ? 'Loaded ' + added + ' new questions (' + filesFailed + ' file' + (filesFailed > 1 ? 's' : '') + ' failed)'
      : 'Loaded ' + totalValid + ' questions from ' + filesOk + ' file' + (filesOk > 1 ? 's' : '');

    const detailParts = [];
    if (added < totalValid) detailParts.push((totalValid - added) + ' duplicates removed');
    if (totalSkipped > 0)   detailParts.push(totalSkipped + ' invalid questions skipped');
    detailParts.push(...details);
    showUploadResult(type, headline, detailParts.join(' · '));
  });
}

function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    if (!file.name.toLowerCase().endsWith('.json')) { reject('Not a .json file'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
      let raw;
      try { raw = JSON.parse(e.target.result); } catch { reject('Invalid JSON syntax'); return; }
      if (!Array.isArray(raw)) { reject('JSON must be an array'); return; }
      let valid = 0, skipped = 0;
      const questions = [];
      raw.forEach(function(item, idx) {
        const q = validateQuestion(item, idx);
        if (q) { questions.push(q); valid++; } else skipped++;
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
  if (!Array.isArray(item.options) || (item.options.length !== 4 && item.options.length !== 5)) return null;
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
  const seenText = new Set(existing.map(function(q) { return q.question.toLowerCase().trim(); }));
  const toAdd    = [];
  incoming.forEach(function(q) {
    const text = q.question.toLowerCase().trim();
    if (seenText.has(text)) return;
    let sid = String(q.id);
    if (seenIds.has(sid)) { sid = stableHash(text + '_' + Date.now() + '_' + Math.random()); q = Object.assign({}, q, { id: sid }); }
    seenIds.add(sid); seenText.add(text); toAdd.push(q);
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
    } catch { showUploadResult('error', 'Storage quota exceeded. Try a smaller question bank.'); }
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    allQuestions = parsed; return true;
  } catch { return false; }
}

var clearConfirmStep = 0;
var clearConfirmTimer = null;

function clearQuestionBank() {
  clearConfirmStep++;
  clearTimeout(clearConfirmTimer);
  clearConfirmTimer = setTimeout(function() { clearConfirmStep = 0; updateClearBtnLabel(); }, 8000);

  if (clearConfirmStep === 1) {
    updateClearBtnLabel();
    showUploadResult('partial', '⚠️ Step 1 of 4 — Are you sure?', 'This will delete ALL ' + allQuestions.length + ' questions. Tap 3 more times to confirm.');
    return;
  }
  if (clearConfirmStep === 2) {
    updateClearBtnLabel();
    showUploadResult('partial', '⚠️ Step 2 of 4 — This cannot be undone', 'Tap 2 more times.');
    return;
  }
  if (clearConfirmStep === 3) {
    updateClearBtnLabel();
    showUploadResult('partial', '🔴 Step 3 of 4 — Last warning!', 'You are about to delete ' + allQuestions.length + ' questions. Tap once more to confirm.');
    return;
  }
  if (clearConfirmStep >= 4) {
    clearConfirmStep = 0;
    clearTimeout(clearConfirmTimer);
    updateClearBtnLabel();
    localStorage.removeItem(BANK_KEY); localStorage.removeItem(META_KEY); localStorage.removeItem(GITHUB_KEY);
    allQuestions = [];
    showUploadResult('partial', 'Bank cleared. Reloading built-in questions…');
    fetch('./questions.json').then(function(r) { return r.json(); }).then(function(data) {
      allQuestions = data; onQuestionsReady('default');
      showUploadResult('success', '✅ Built-in questions restored (' + data.length + ' questions). GitHub URL also cleared.');
    }).catch(function() { showUploadResult('error', 'Could not reload built-in questions.'); showScreen('home'); });
  }
}

function updateClearBtnLabel() {
  var btn = document.getElementById('btn-clear-bank');
  if (!btn) return;
  var labels = ['🗑 Clear Bank','⚠️ Tap again (1/4)','⚠️ Tap again (2/4)','🔴 Tap again (3/4)','💀 Tap to CONFIRM DELETE (4/4)'];
  btn.textContent = labels[Math.min(clearConfirmStep, 4)];
  btn.style.color       = clearConfirmStep >= 3 ? 'var(--red)' : '';
  btn.style.borderColor = clearConfirmStep >= 3 ? 'var(--red)' : '';
}

// ── Upload UI helpers ──────────────────────────────────────

function updateBankUI(source) {
  const badge      = document.getElementById('upload-source-badge');
  const status     = document.getElementById('bank-status');
  const clearBtn   = document.getElementById('btn-clear-bank');
  const refreshBtn = document.getElementById('btn-github-refresh');
  const exportBtn  = document.getElementById('btn-export');
  const savedGithubUrls = getSavedGithubUrls();
  const hasGithub  = savedGithubUrls.length > 0;
  const meta       = getStoredMeta();

  if (source === 'github' && meta) {
    badge.textContent = 'GITHUB'; badge.classList.add('uploaded', 'github');
    status.textContent = allQuestions.length + ' questions · ' + savedGithubUrls.length + ' source' + (savedGithubUrls.length !== 1 ? 's' : '') + ' saved';
    clearBtn.style.display = 'flex';
  } else if (source === 'uploaded' && meta) {
    badge.textContent = 'CUSTOM'; badge.classList.add('uploaded'); badge.classList.remove('github');
    status.textContent = allQuestions.length + ' questions from ' + meta.files + ' file' + (meta.files !== 1 ? 's' : '');
    clearBtn.style.display = 'flex';
  } else {
    badge.textContent = hasGithub ? 'GITHUB' : 'DEFAULT';
    if (hasGithub) {
      badge.classList.add('uploaded', 'github');
      status.textContent = allQuestions.length + ' questions · ' + savedGithubUrls.length + ' source' + (savedGithubUrls.length !== 1 ? 's' : '') + ' saved';
      clearBtn.style.display = 'flex';
    } else {
      badge.classList.remove('uploaded', 'github');
      status.textContent = allQuestions.length + ' built-in questions';
      clearBtn.style.display = 'none';
    }
  }

  if (exportBtn) { exportBtn.style.display = allQuestions.length > 0 ? 'flex' : 'none'; exportBtn.textContent = '⬇ Export All (' + allQuestions.length + ' Qs)'; }
  if (refreshBtn) { refreshBtn.style.display = hasGithub ? 'flex' : 'none'; if (hasGithub) refreshBtn.textContent = '🔄 Refresh (' + savedGithubUrls.length + ')'; }

  restoreGithubUrl();
}

function getSavedGithubUrls() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [p]; } catch { return raw ? [raw] : []; }
}

function getStoredMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)); } catch { return null; }
}

function showUploadResult(type, headline, detail) {
  const el = document.getElementById('upload-result');
  el.style.display = 'block'; el.className = 'upload-result ' + type;
  el.innerHTML = '<div style="font-weight:600">' + headline + '</div>' + (detail ? '<div class="result-detail">' + detail + '</div>' : '');
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

function exportQuestionBank() {
  if (allQuestions.length === 0) { showToast('No questions to export!'); return; }
  const exportData = allQuestions.map(function(q) { return { id: q.id, topic: q.topic, question: q.question, options: q.options.slice(), correct: q.correct }; });
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const filename = 'mathquiz-questions-' + exportData.length + '-' + getTodayStr() + '.json';
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ Exported ' + exportData.length + ' questions as ' + filename);
  showUploadResult('success', '✅ Exported ' + exportData.length + ' questions', 'File: ' + filename);
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ══════════════════════════════════════════════════════════
// QUIZ ENGINE
// ══════════════════════════════════════════════════════════

function loadWeakStats() {
  try { weakStats = JSON.parse(localStorage.getItem(WEAK_KEY)) || {}; } catch { weakStats = {}; }
}

function saveWeakStats() { localStorage.setItem(WEAK_KEY, JSON.stringify(weakStats)); }

function populateTopics() {
  const topics = Array.from(new Set(allQuestions.map(function(q) { return q.topic; }))).sort();
  const list   = document.getElementById('multi-select-list');
  if (!list) return;

  // Keep previously selected topics that still exist
  selectedTopics = selectedTopics.filter(function(t) { return topics.includes(t); });

  list.innerHTML = topics.map(function(t) {
    const checked = selectedTopics.includes(t) ? 'checked' : '';
    const count   = allQuestions.filter(function(q) { return q.topic === t; }).length;
    return '<label class="multi-select-item">' +
      '<input type="checkbox" class="topic-checkbox" value="' + escHtml(t) + '" ' + checked + '/>' +
      '<span class="topic-item-name">' + escHtml(t) + '</span>' +
      '<span class="topic-item-count">' + count + '</span>' +
      '</label>';
  }).join('');

  // Bind checkbox events
  list.querySelectorAll('.topic-checkbox').forEach(function(cb) {
    cb.addEventListener('change', function() {
      if (this.checked) {
        if (!selectedTopics.includes(this.value)) selectedTopics.push(this.value);
      } else {
        selectedTopics = selectedTopics.filter(function(t) { return t !== cb.value; });
      }
      updateMultiSelectLabel();
      updateTopicQCount();
    });
  });

  updateMultiSelectLabel();
  updateTopicQCount();
}

function updateMultiSelectLabel() {
  const label = document.getElementById('multi-select-label');
  if (!label) return;
  if (selectedTopics.length === 0) {
    label.textContent = 'Select topics…';
  } else if (selectedTopics.length === 1) {
    label.textContent = selectedTopics[0];
  } else {
    label.textContent = selectedTopics.length + ' topics selected';
  }
}

function updateTopicQCount() {
  const hint = document.getElementById('topic-q-count');
  if (!hint) return;
  if (selectedTopics.length === 0) {
    hint.textContent = 'Select at least one topic to start';
    return;
  }
  const count = allQuestions.filter(function(q) { return selectedTopics.includes(q.topic); }).length;
  hint.textContent = count + ' question' + (count !== 1 ? 's' : '') + ' in selection';
}

function updateHomeStats() {
  const weakCount      = getWeakQuestions().length;
  const totalAttempted = Object.values(weakStats).reduce(function(s, v) { return s + v.attempts; }, 0);

  document.getElementById('stat-total').textContent     = allQuestions.length;
  document.getElementById('stat-weak').textContent      = weakCount;
  document.getElementById('stat-attempted').textContent = totalAttempted;

  document.getElementById('btn-weak-mode').disabled = weakCount === 0;
  document.getElementById('btn-weak-test').disabled = weakCount === 0;
  document.getElementById('weak-count-badge').textContent = weakCount > 0 ? weakCount + ' weak' : 'none yet';

  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) { exportBtn.style.display = allQuestions.length > 0 ? 'flex' : 'none'; exportBtn.textContent = '⬇ Export All (' + allQuestions.length + ' Qs)'; }
}

function updateSetupHint() {
  const hint = document.getElementById('setup-available-hint');
  if (hint) hint.textContent = allQuestions.length + ' questions available';
  const inp = document.getElementById('overall-q-count');
  if (inp && allQuestions.length > 0 && parseInt(inp.value) > allQuestions.length) {
    inp.value = allQuestions.length;
    overallQCount = allQuestions.length;
  }
}

// ══════════════════════════════════════════════════════════
// TIMER
// ══════════════════════════════════════════════════════════

function startTimer() {
  stopTimer();
  if (timerMode !== 'countup') return;
  timerSeconds = 0;
  updateTimerDisplay();
  document.getElementById('timer-display').style.display = 'flex';
  timerInterval = setInterval(function() {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  document.getElementById('timer-value').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return s + 's';
  return m + 'm ' + s + 's';
}

// ══════════════════════════════════════════════════════════
// SESSION HISTORY
// ══════════════════════════════════════════════════════════

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveSession(entry) {
  const history = loadHistory();
  history.unshift(entry); // newest first
  // Keep last 100 sessions max
  if (history.length > 100) history.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function buildSessionEntry() {
  const pct = attempted > 0 ? Math.round((score / attempted) * 100) : 0;
  return {
    id:        Date.now(),
    date:      new Date().toISOString(),
    mode:      currentMode,          // normal | overall | weaktest | retry
    topic:     currentMode === 'normal' ? (selectedTopics.length === 1 ? selectedTopics[0] : selectedTopics.length + ' Topics') : (currentMode === 'overall' ? 'All Topics' : 'Weak'),
    total:     attempted,
    correct:   score,
    wrong:     attempted - score,
    pct:       pct,
    timeSecs:  timerMode === 'countup' ? timerSeconds : null
  };
}

function renderHistory(filterTab) {
  const all      = loadHistory();
  const filtered = filterTab === 'all' ? all : all.filter(function(s) {
    if (filterTab === 'topic')   return s.mode === 'normal';
    if (filterTab === 'overall') return s.mode === 'overall';
    if (filterTab === 'weak')    return s.mode === 'weaktest' || s.mode === 'retry';
    return true;
  });

  const container = document.getElementById('history-list');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No sessions yet' + (filterTab !== 'all' ? ' in this category' : '') + '.</p></div>';
    return;
  }

  container.innerHTML = filtered.map(function(s) {
    const d    = new Date(s.date);
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const modeLabel = s.mode === 'overall' ? '🌐 Overall' : s.mode === 'normal' ? '📘 Topic' : s.mode === 'weaktest' ? '🔴 Weak Test' : '🔁 Retry';
    const pctColor  = s.pct >= 80 ? 'var(--green)' : s.pct >= 50 ? 'var(--amber)' : 'var(--red)';
    const timeInfo  = s.timeSecs != null ? '<span class="hist-time">⏱ ' + formatTime(s.timeSecs) + '</span>' : '';

    return '<div class="history-item">' +
      '<div class="hist-top">' +
        '<span class="hist-mode">' + modeLabel + '</span>' +
        '<span class="hist-topic">' + escHtml(s.topic) + '</span>' +
        timeInfo +
      '</div>' +
      '<div class="hist-bottom">' +
        '<div class="hist-score">' +
          '<span class="hist-big" style="color:' + pctColor + '">' + s.pct + '%</span>' +
          '<span class="hist-sub">' + s.correct + ' / ' + s.total + ' correct</span>' +
        '</div>' +
        '<div class="hist-date">' + dateStr + '<br>' + timeStr + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════════════════════
// BIND EVENTS
// ══════════════════════════════════════════════════════════

function bindEvents() {
  // Home
  document.getElementById('btn-start').addEventListener('click', function() { startQuiz('normal'); });
  document.getElementById('btn-weak-mode').addEventListener('click', showWeakList);
  document.getElementById('btn-weak-test').addEventListener('click', function() { startQuiz('weaktest'); });
  document.getElementById('btn-history').addEventListener('click', function() { showHistoryScreen('all'); });

  // Overall Quiz setup
  document.getElementById('btn-overall-setup').addEventListener('click', function() {
    updateSetupHint();
    showScreen('overall-setup');
  });
  document.getElementById('btn-overall-setup-back').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-start-overall').addEventListener('click', function() {
    const val = parseInt(document.getElementById('overall-q-count').value) || 20;
    overallQCount = Math.max(1, Math.min(val, allQuestions.length || val));
    const radios = document.querySelectorAll('input[name="timer-mode"]');
    radios.forEach(function(r) { if (r.checked) timerMode = r.value; });
    startQuiz('overall');
  });

  // Number stepper
  document.getElementById('num-dec').addEventListener('click', function() {
    const inp = document.getElementById('overall-q-count');
    const val = parseInt(inp.value) || 20;
    if (val > 1) inp.value = val - 1;
  });
  document.getElementById('num-inc').addEventListener('click', function() {
    const inp  = document.getElementById('overall-q-count');
    const val  = parseInt(inp.value) || 20;
    const max  = allQuestions.length || 500;
    if (val < max) inp.value = val + 1;
  });
  document.getElementById('overall-q-count').addEventListener('change', function() {
    const max = allQuestions.length || 500;
    let val = parseInt(this.value) || 1;
    val = Math.max(1, Math.min(val, max));
    this.value = val;
  });

  // Quiz
  document.getElementById('btn-next').addEventListener('click', nextQuestion);
  document.getElementById('btn-home').addEventListener('click', function() { stopTimer(); showScreen('home'); });
  document.getElementById('btn-result-home').addEventListener('click', function() { showScreen('home'); updateHomeStats(); });
  document.getElementById('btn-retry-wrong').addEventListener('click', function() { startQuiz('retry'); });

  // Weak list
  document.getElementById('btn-weaklist-home').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-start-weak-test').addEventListener('click', function() { startQuiz('weaktest'); });

  // History
  document.getElementById('btn-history-home').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-clear-history').addEventListener('click', function() {
    if (confirm('Clear all session history? This cannot be undone.')) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory('all');
      showToast('History cleared.');
    }
  });
  document.querySelectorAll('.history-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.history-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      renderHistory(tab.dataset.tab);
    });
  });

  // Multi-select topic dropdown
  var multiToggle   = document.getElementById('multi-select-toggle');
  var multiDropdown = document.getElementById('multi-select-dropdown');

  multiToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = multiDropdown.classList.toggle('open');
    multiToggle.classList.toggle('open', isOpen);
  });

  document.addEventListener('click', function(e) {
    var wrap = document.getElementById('multi-select-wrap');
    if (wrap && !wrap.contains(e.target)) {
      multiDropdown.classList.remove('open');
      multiToggle.classList.remove('open');
    }
  });

  document.getElementById('btn-select-all-topics').addEventListener('click', function() {
    var topics = Array.from(new Set(allQuestions.map(function(q) { return q.topic; }))).sort();
    selectedTopics = topics.slice();
    document.querySelectorAll('.topic-checkbox').forEach(function(cb) { cb.checked = true; });
    updateMultiSelectLabel();
    updateTopicQCount();
  });

  document.getElementById('btn-clear-topics').addEventListener('click', function() {
    selectedTopics = [];
    document.querySelectorAll('.topic-checkbox').forEach(function(cb) { cb.checked = false; });
    updateMultiSelectLabel();
    updateTopicQCount();
  });

  // Bank
  document.getElementById('btn-clear-bank').addEventListener('click', clearQuestionBank);
  document.getElementById('btn-export').addEventListener('click', exportQuestionBank);

  // GitHub
  document.getElementById('btn-github-load').addEventListener('click', loadFromGithub);
  document.getElementById('btn-github-refresh').addEventListener('click', refreshFromGithub);
  document.getElementById('btn-github-clear').addEventListener('click', clearGithubUrl);
  document.getElementById('github-url-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') loadFromGithub(); });

  // File upload
  var fileInput = document.getElementById('file-input');
  var dropZone  = document.getElementById('drop-zone');
  dropZone.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function(e) { handleFileUpload(e.target.files); });
  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', function(e) { e.preventDefault(); dropZone.classList.remove('dragover'); handleFileUpload(e.dataTransfer.files); });
}

// ══════════════════════════════════════════════════════════
// START QUIZ
// ══════════════════════════════════════════════════════════

function startQuiz(mode) {
  if (allQuestions.length === 0) { showToast('No questions loaded!'); return; }

  // For retry — capture sessionWrong BEFORE resetting state
  var retryQueue = [];
  if (mode === 'retry') {
    if (sessionWrong.length === 0) { showToast('No wrong answers this session!'); return; }
    retryQueue = shuffle(sessionWrong.slice());
  }

  currentMode  = mode;
  score        = 0;
  attempted    = 0;
  sessionWrong = [];
  sessionIndex = 0;

  // If not overall, reset timer mode to none (timer only for overall)
  if (mode !== 'overall') timerMode = 'none';

  if (mode === 'normal') {
    if (selectedTopics.length === 0) { showToast('Select at least one topic first!'); return; }
    var pool = allQuestions.filter(function(q) { return selectedTopics.includes(q.topic); });
    if (pool.length === 0) { showToast('No questions for selected topics!'); return; }
    sessionQueue = shuffle(pool);

  } else if (mode === 'overall') {
    var count = Math.min(overallQCount, allQuestions.length);
    sessionQueue = shuffle(allQuestions.slice()).slice(0, count);

  } else if (mode === 'weaktest' || mode === 'weak') {
    sessionQueue = getWeakQueueSorted();
    if (sessionQueue.length === 0) { showToast('No weak questions yet!'); return; }

  } else if (mode === 'retry') {
    sessionQueue = retryQueue;
  }

  if (sessionQueue.length === 0) { showToast('No questions for this filter!'); return; }

  // Start timer if enabled
  startTimer();

  showScreen('quiz');
  updateModeIndicator();
  loadQuestion();
}

// ══════════════════════════════════════════════════════════
// QUESTION LOADING
// ══════════════════════════════════════════════════════════

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

  var letters   = ['A', 'B', 'C', 'D', 'E'];
  var container = document.getElementById('options-container');
  container.innerHTML = '';
  currentQ.options.forEach(function(opt, i) {
    var btn       = document.createElement('button');
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
      if (b.querySelector('span:last-child').textContent === currentQ.correct) b.classList.add('reveal-correct');
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

// ══════════════════════════════════════════════════════════
// RESULT SCREEN
// ══════════════════════════════════════════════════════════

function showResult() {
  stopTimer();

  var pct = attempted > 0 ? Math.round((score / attempted) * 100) : 0;

  document.getElementById('result-score').textContent   = score;
  document.getElementById('result-total').textContent   = attempted;
  document.getElementById('result-pct').textContent     = pct + '%';
  document.getElementById('result-pct2').textContent    = pct + '%';
  document.getElementById('result-correct').textContent = score;
  document.getElementById('result-wrong').textContent   = attempted - score;

  // Show timer row if we used count-up
  var timeRow = document.getElementById('result-time-row');
  if (timerMode === 'countup') {
    timeRow.style.display = 'flex';
    document.getElementById('result-time-val').textContent = formatTime(timerSeconds);
  } else {
    timeRow.style.display = 'none';
  }

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

  // Save to history
  if (attempted > 0) saveSession(buildSessionEntry());

  showScreen('result');
  updateHomeStats();
}

// ══════════════════════════════════════════════════════════
// WEAK LIST SCREEN
// ══════════════════════════════════════════════════════════

function showWeakList() {
  var weakQs    = getWeakQueueSorted();
  var container = document.getElementById('weak-list');

  if (weakQs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>No weak questions! Keep practicing.</p></div>';
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

  document.getElementById('weak-count-text').textContent = weakQs.length + ' question' + (weakQs.length !== 1 ? 's' : '') + ' need attention';
  showScreen('weaklist');
}

// ══════════════════════════════════════════════════════════
// HISTORY SCREEN
// ══════════════════════════════════════════════════════════

function showHistoryScreen(tab) {
  document.querySelectorAll('.history-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  renderHistory(tab);
  showScreen('history');
}

// ══════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════

function updateModeIndicator() {
  var el = document.getElementById('mode-indicator');
  if (currentMode === 'weaktest' || currentMode === 'weak') {
    el.textContent = '🔴 Weak Mode'; el.className = 'mode-indicator';
  } else if (currentMode === 'retry') {
    el.textContent = '🔁 Retry Mode'; el.className = 'mode-indicator';
  } else if (currentMode === 'overall') {
    el.textContent = '🌐 Overall Quiz'; el.className = 'mode-indicator overall';
  } else {
    var topicLabel = selectedTopics.length === 0 ? 'No Topic' : selectedTopics.length === 1 ? selectedTopics[0] : selectedTopics.length + ' Topics';
    el.textContent = '🟡 ' + topicLabel; el.className = 'mode-indicator normal';
  }
  // Show/hide timer display bar based on mode
  document.getElementById('timer-display').style.display = (timerMode === 'countup') ? 'flex' : 'none';
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
