/* ============================================================
   QUIZ PWA — app.js  v4.0
   + Two fully isolated subjects: Maths & Reasoning
   + Subject tab switcher on home screen
   + All state (bank, weak, github, history) namespaced per subject
   + PDF Performance Report Export (jsPDF + Chart.js)
   + Dark mode ONLY (bluish theme)
   ============================================================ */

// ── Subject config ─────────────────────────────────────────
const SUBJECTS = {
  maths: {
    key:         'maths',
    label:       'MathQuiz',
    icon:        '∑',
    fallbackJson: './questions.json',
    grad:        'var(--grad-main)',
    accentVar:   '--violet',
    pillClass:   'subject-pill-maths',
  },
  reasoning: {
    key:         'reasoning',
    label:       'ReasoningQuiz',
    icon:        '🧩',
    fallbackJson: null,
    grad:        'var(--grad-cyan)',
    accentVar:   '--cyan',
    pillClass:   'subject-pill-reasoning',
  }
};

// ── Active subject ─────────────────────────────────────────
let activeSubject = 'maths';   // 'maths' | 'reasoning'

// ── Per-subject storage key helpers ───────────────────────
function sKey(base) { return 'quiz_' + activeSubject + '_' + base; }
const WEAK_KEY      = () => sKey('weak_stats');
const BANK_KEY      = () => sKey('question_bank');
const META_KEY      = () => sKey('bank_meta');
const GITHUB_KEY    = () => sKey('github_url');
const HISTORY_KEY   = () => sKey('session_history');
const BOOKMARK_KEY  = () => sKey('bookmarks');

// XP is global across both subjects (one player profile)
const XP_KEY        = 'quiz_xp_total';

// ── XP / Gamification config ───────────────────────────────
const XP_PER_CORRECT  = 10;
const XP_PER_WRONG    = 2;
const LEVELS = [
  { level: 1,  title: 'Novice',       xpMin: 0     },
  { level: 2,  title: 'Apprentice',   xpMin: 100   },
  { level: 3,  title: 'Scholar',      xpMin: 300   },
  { level: 4,  title: 'Thinker',      xpMin: 600   },
  { level: 5,  title: 'Analyst',      xpMin: 1000  },
  { level: 6,  title: 'Expert',       xpMin: 1500  },
  { level: 7,  title: 'Strategist',   xpMin: 2200  },
  { level: 8,  title: 'Master',       xpMin: 3000  },
  { level: 9,  title: 'Grandmaster',  xpMin: 4200  },
  { level: 10, title: 'Legend',       xpMin: 6000  },
];

// ── State ──────────────────────────────────────────────────
let allQuestions   = [];
let sessionQueue   = [];
let sessionIndex   = 0;
let score          = 0;
let attempted      = 0;
let sessionWrong   = [];
let weakStats      = {};
let currentMode    = 'normal';
let selectedTopics = [];
let currentQ       = null;
let bookmarks      = {};

// Timer state
let timerMode      = 'none';
let timerSeconds   = 0;
let timerInterval  = null;

// Overall quiz setup state
let overallQCount  = 20;

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Dark mode ONLY — always apply dark
  applyTheme('dark');

  bindSubjectTabs();
  bindEvents();
  loadBookmarks();
  updateXPBar();
  await switchSubject('maths', true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
});

// ══════════════════════════════════════════════════════════
// SUBJECT SWITCHING
// ══════════════════════════════════════════════════════════

function bindSubjectTabs() {
  document.querySelectorAll('.subject-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var subj = tab.dataset.subject;
      if (subj === activeSubject) return;
      switchSubject(subj, false);
    });
  });
}

async function switchSubject(subj, isInit) {
  activeSubject = subj;
  var cfg = SUBJECTS[subj];

  document.querySelectorAll('.subject-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.subject === subj);
    t.classList.toggle('tab-maths',     t.dataset.subject === 'maths');
    t.classList.toggle('tab-reasoning', t.dataset.subject === 'reasoning');
  });

  document.getElementById('logo-icon').textContent = cfg.icon;
  document.getElementById('logo-text').textContent  = cfg.label;

  var pill = document.getElementById('quiz-subject-pill');
  pill.textContent = cfg.icon + ' ' + cfg.label.replace('Quiz','');
  pill.className = 'quiz-subject-pill ' + cfg.pillClass;

  allQuestions   = [];
  selectedTopics = [];
  weakStats      = {};
  sessionQueue   = [];
  sessionIndex   = 0;
  score          = 0;
  attempted      = 0;
  sessionWrong   = [];

  var ur = document.getElementById('upload-result');
  if (ur) { ur.style.display = 'none'; ur.textContent = ''; }

  loadWeakStats();
  loadBookmarks();
  restoreGithubUrl();

  var hasGithubUrls = !!localStorage.getItem(GITHUB_KEY());

  if (hasGithubUrls) {
    loadFromLocalStorage();
    onQuestionsReady('github');
    await loadAllGithubSources();
  } else {
    var loaded = loadFromLocalStorage();
    if (loaded) {
      onQuestionsReady('uploaded');
    } else if (cfg.fallbackJson) {
      try {
        var r = await fetch(cfg.fallbackJson);
        if (!r.ok) throw new Error('fetch failed');
        var data = await r.json();
        allQuestions = data;
        onQuestionsReady('default');
      } catch {
        showUploadResult('error', 'Could not load built-in questions. Upload a JSON file or load from GitHub to begin.');
        showScreen('home');
      }
    } else {
      onQuestionsReady('default');
    }
  }

  if (!isInit) showScreen('home');
}

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
  var raw = localStorage.getItem(GITHUB_KEY());
  if (!raw) {
    var input = document.getElementById('github-url-input');
    if (input) input.value = '';
    return;
  }
  try {
    var parsed = JSON.parse(raw);
    var urls   = Array.isArray(parsed) ? parsed : [parsed];
    var input  = document.getElementById('github-url-input');
    if (input && urls.length > 0) input.value = urls[0];
  } catch {
    var input = document.getElementById('github-url-input');
    if (input) input.value = raw;
  }
}

function convertToRawUrl(url) {
  url = url.trim();
  if (url.includes('raw.githubusercontent.com')) return url;
  var match = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (match) return 'https://raw.githubusercontent.com/' + match[1] + '/' + match[2] + '/' + match[3];
  return url;
}

async function loadFromGithub() {
  var input  = document.getElementById('github-url-input');
  var btn    = document.getElementById('btn-github-load');
  var rawUrl = input ? input.value.trim() : '';

  if (!rawUrl) { showUploadResult('error', 'Please paste a GitHub raw URL first.'); return; }

  var url = convertToRawUrl(rawUrl);
  btn.disabled = true; btn.textContent = '⏳ Loading…';
  showUploadResult('partial', 'Fetching from GitHub…', url);

  try {
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' — check the URL is correct and the repo is public');

    var raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('JSON must be an array of question objects');

    var valid = 0, skipped = 0;
    var newQuestions = [];
    raw.forEach(function(item, idx) {
      var q = validateQuestion(item, idx);
      if (q) { newQuestions.push(q); valid++; } else skipped++;
    });

    if (newQuestions.length === 0) throw new Error('No valid questions found (' + skipped + ' invalid entries)');

    var prevLen = allQuestions.length;
    var merged  = mergeQuestions(allQuestions, newQuestions);
    var added   = merged.length - prevLen;
    allQuestions = merged;

    var urls = JSON.parse(localStorage.getItem(GITHUB_KEY()) || '[]');
    if (!urls.includes(rawUrl)) urls.push(rawUrl);
    localStorage.setItem(GITHUB_KEY(), JSON.stringify(urls));

    saveToLocalStorage(merged, { files: 1, total: merged.length, source: 'github' });
    populateTopics(); updateHomeStats(); updateBankUI('github'); updateSetupHint();

    var detail = [];
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
  var raw = localStorage.getItem(GITHUB_KEY());
  if (!raw) { showToast('No GitHub URL saved yet.'); return; }

  var btn = document.getElementById('btn-github-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }

  localStorage.removeItem(BANK_KEY());
  allQuestions = [];
  await loadAllGithubSources();

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
}

function clearGithubUrl() {
  localStorage.removeItem(GITHUB_KEY());
  var input = document.getElementById('github-url-input');
  if (input) input.value = '';
  updateBankUI('default');
  showToast('GitHub URL cleared.');
}

async function loadAllGithubSources() {
  var urls = getSavedGithubUrls();
  if (urls.length === 0) return;

  showUploadResult('partial', '⏳ Auto-refreshing ' + urls.length + ' GitHub source' + (urls.length > 1 ? 's' : '') + '...');

  var totalAdded = 0;
  for (var i = 0; i < urls.length; i++) { totalAdded += await fetchAndMergeGithubUrl(urls[i]); }

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
    var url      = convertToRawUrl(rawUrl);
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Not an array');
    var newQuestions = [];
    raw.forEach(function(item, idx) { var q = validateQuestion(item, idx); if (q) newQuestions.push(q); });
    var prevLen  = allQuestions.length;
    allQuestions = mergeQuestions(allQuestions, newQuestions);
    return allQuestions.length - prevLen;
  } catch (err) { console.error('GitHub load failed for', rawUrl, ':', err); return 0; }
}

// ══════════════════════════════════════════════════════════
// FILE UPLOAD
// ══════════════════════════════════════════════════════════

function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  var dropLabel = document.getElementById('drop-zone').querySelector('.drop-label');
  dropLabel.textContent = 'Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '...';

  var fileArray = Array.from(files);
  Promise.allSettled(fileArray.map(readFileAsJSON)).then(function(results) {
    var totalValid = 0, totalSkipped = 0, filesOk = 0, filesFailed = 0;
    var details = [], newQuestions = [];

    results.forEach(function(result, i) {
      var fname = fileArray[i].name;
      if (result.status === 'rejected') {
        filesFailed++; details.push('FAIL ' + fname + ': ' + result.reason);
        return;
      }
      var v = result.value;
      filesOk++; totalValid += v.valid; totalSkipped += v.skipped;
      newQuestions.push.apply(newQuestions, v.questions);
      details.push('OK ' + fname + ': ' + v.valid + ' valid' + (v.skipped > 0 ? ', ' + v.skipped + ' skipped' : ''));
    });

    if (newQuestions.length === 0) {
      resetDropZone();
      showUploadResult('error', 'No valid questions found in ' + filesFailed + ' file' + (filesFailed !== 1 ? 's' : '') + '.', details.join(' · '));
      return;
    }

    var prevLen = allQuestions.length;
    var merged  = mergeQuestions(allQuestions, newQuestions);
    var added   = merged.length - prevLen;
    allQuestions = merged;

    saveToLocalStorage(merged, { files: filesOk, total: merged.length, source: 'uploaded' });
    populateTopics(); updateHomeStats(); updateBankUI('uploaded'); resetDropZone(); updateSetupHint();

    var type = filesFailed > 0 ? 'partial' : 'success';
    var headline = filesFailed > 0
      ? 'Loaded ' + added + ' new questions (' + filesFailed + ' file' + (filesFailed > 1 ? 's' : '') + ' failed)'
      : 'Loaded ' + totalValid + ' questions from ' + filesOk + ' file' + (filesOk > 1 ? 's' : '');

    var detailParts = [];
    if (added < totalValid) detailParts.push((totalValid - added) + ' duplicates removed');
    if (totalSkipped > 0)   detailParts.push(totalSkipped + ' invalid questions skipped');
    detailParts.push.apply(detailParts, details);
    showUploadResult(type, headline, detailParts.join(' · '));
  });
}

function readFileAsJSON(file) {
  return new Promise(function(resolve, reject) {
    if (!file.name.toLowerCase().endsWith('.json')) { reject('Not a .json file'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      var raw;
      try { raw = JSON.parse(e.target.result); } catch { reject('Invalid JSON syntax'); return; }
      if (!Array.isArray(raw)) { reject('JSON must be an array'); return; }
      var valid = 0, skipped = 0;
      var questions = [];
      raw.forEach(function(item, idx) {
        var q = validateQuestion(item, idx);
        if (q) { questions.push(q); valid++; } else skipped++;
      });
      resolve({ questions: questions, valid: valid, skipped: skipped });
    };
    reader.onerror = function() { reject('FileReader error'); };
    reader.readAsText(file);
  });
}

function validateQuestion(item, idx) {
  if (typeof item !== 'object' || item === null) return null;
  var question = String(item.question || '').trim();
  if (!question) return null;
  if (!Array.isArray(item.options) || (item.options.length !== 4 && item.options.length !== 5)) return null;
  var options = item.options.map(function(o) { return String(o || '').trim(); });
  if (options.some(function(o) { return o === ''; })) return null;
  var correct = String(item.correct || '').trim();
  if (!correct || !options.includes(correct)) return null;
  var topic = String(item.topic || 'General').trim();
  var id    = item.id != null ? item.id : stableHash(question);
  return { id: id, question: question, options: options, correct: correct, topic: topic };
}

function mergeQuestions(existing, incoming) {
  var seenIds  = new Set(existing.map(function(q) { return String(q.id); }));
  var seenText = new Set(existing.map(function(q) { return q.question.toLowerCase().trim(); }));
  var toAdd    = [];
  incoming.forEach(function(q) {
    var text = q.question.toLowerCase().trim();
    if (seenText.has(text)) return;
    var sid = String(q.id);
    if (seenIds.has(sid)) {
      sid = stableHash(text + '_' + Date.now() + '_' + Math.random());
      q = Object.assign({}, q, { id: sid });
    }
    seenIds.add(sid); seenText.add(text); toAdd.push(q);
  });
  return existing.concat(toAdd);
}

function saveToLocalStorage(questions, meta) {
  try {
    localStorage.setItem(BANK_KEY(), JSON.stringify(questions));
    localStorage.setItem(META_KEY(), JSON.stringify(meta));
  } catch(e) {
    try {
      localStorage.removeItem(BANK_KEY());
      localStorage.setItem(BANK_KEY(), JSON.stringify(questions));
      localStorage.setItem(META_KEY(), JSON.stringify(meta));
    } catch { showUploadResult('error', 'Storage quota exceeded. Try a smaller question bank.'); }
  }
}

function loadFromLocalStorage() {
  try {
    var raw = localStorage.getItem(BANK_KEY());
    if (!raw) return false;
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    allQuestions = parsed; return true;
  } catch { return false; }
}

var clearConfirmStep  = 0;
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
    localStorage.removeItem(BANK_KEY());
    localStorage.removeItem(META_KEY());
    localStorage.removeItem(GITHUB_KEY());
    allQuestions = [];

    var cfg = SUBJECTS[activeSubject];
    if (cfg.fallbackJson) {
      showUploadResult('partial', 'Bank cleared. Reloading built-in questions…');
      fetch(cfg.fallbackJson).then(function(r) { return r.json(); }).then(function(data) {
        allQuestions = data; onQuestionsReady('default');
        showUploadResult('success', '✅ Built-in questions restored (' + data.length + ' questions). GitHub URL also cleared.');
      }).catch(function() { showUploadResult('error', 'Could not reload built-in questions.'); showScreen('home'); });
    } else {
      showUploadResult('success', '✅ Bank cleared. Upload a JSON file to begin.');
      onQuestionsReady('default');
    }
  }
}

function updateClearBtnLabel() {
  var btn = document.getElementById('btn-clear-bank');
  if (!btn) return;
  var labels = ['🗑 Clear Bank','⚠️ Tap again (1/4)','⚠️ Tap again (2/4)','🔴 Tap again (3/4)','💀 Tap to CONFIRM DELETE (4/4)'];
  btn.textContent     = labels[Math.min(clearConfirmStep, 4)];
  btn.style.color       = clearConfirmStep >= 3 ? 'var(--red)' : '';
  btn.style.borderColor = clearConfirmStep >= 3 ? 'var(--red)' : '';
}

// ── Upload UI helpers ──────────────────────────────────────

function updateBankUI(source) {
  var badge      = document.getElementById('upload-source-badge');
  var status     = document.getElementById('bank-status');
  var clearBtn   = document.getElementById('btn-clear-bank');
  var refreshBtn = document.getElementById('btn-github-refresh');
  var exportBtn  = document.getElementById('btn-export');
  var savedGithubUrls = getSavedGithubUrls();
  var hasGithub  = savedGithubUrls.length > 0;
  var meta       = getStoredMeta();

  badge.classList.remove('uploaded', 'github');

  if (source === 'github' && meta) {
    badge.textContent = 'GITHUB'; badge.classList.add('uploaded', 'github');
    status.textContent = allQuestions.length + ' questions · ' + savedGithubUrls.length + ' source' + (savedGithubUrls.length !== 1 ? 's' : '') + ' saved';
    clearBtn.style.display = 'flex';
  } else if (source === 'uploaded' && meta) {
    badge.textContent = 'CUSTOM'; badge.classList.add('uploaded');
    status.textContent = allQuestions.length + ' questions from ' + meta.files + ' file' + (meta.files !== 1 ? 's' : '');
    clearBtn.style.display = 'flex';
  } else {
    badge.textContent = hasGithub ? 'GITHUB' : 'DEFAULT';
    if (hasGithub) {
      badge.classList.add('uploaded', 'github');
      status.textContent = allQuestions.length + ' questions · ' + savedGithubUrls.length + ' source' + (savedGithubUrls.length !== 1 ? 's' : '') + ' saved';
      clearBtn.style.display = 'flex';
    } else {
      status.textContent = allQuestions.length > 0
        ? allQuestions.length + ' built-in questions'
        : (SUBJECTS[activeSubject].fallbackJson ? 'Using built-in questions' : 'No questions loaded — upload a JSON file');
      clearBtn.style.display = 'none';
    }
  }

  if (exportBtn) {
    exportBtn.style.display = allQuestions.length > 0 ? 'flex' : 'none';
    exportBtn.textContent   = '⬇ Export All (' + allQuestions.length + ' Qs)';
  }
  if (refreshBtn) {
    refreshBtn.style.display = hasGithub ? 'flex' : 'none';
    if (hasGithub) refreshBtn.textContent = '🔄 Refresh (' + savedGithubUrls.length + ')';
  }

  restoreGithubUrl();
}

function getSavedGithubUrls() {
  var raw = localStorage.getItem(GITHUB_KEY());
  if (!raw) return [];
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : [p]; } catch { return raw ? [raw] : []; }
}

function getStoredMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY())); } catch { return null; }
}

function showUploadResult(type, headline, detail) {
  var el = document.getElementById('upload-result');
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
  var exportData = allQuestions.map(function(q) {
    return { id: q.id, topic: q.topic, question: q.question, options: q.options.slice(), correct: q.correct };
  });
  var json     = JSON.stringify(exportData, null, 2);
  var blob     = new Blob([json], { type: 'application/json' });
  var url      = URL.createObjectURL(blob);
  var filename = activeSubject + 'quiz-questions-' + exportData.length + '-' + getTodayStr() + '.json';
  var a        = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ Exported ' + exportData.length + ' questions as ' + filename);
  showUploadResult('success', '✅ Exported ' + exportData.length + ' questions', 'File: ' + filename);
}

function getTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ══════════════════════════════════════════════════════════
// QUIZ ENGINE
// ══════════════════════════════════════════════════════════

function loadWeakStats() {
  try { weakStats = JSON.parse(localStorage.getItem(WEAK_KEY())) || {}; } catch { weakStats = {}; }
}

function saveWeakStats() { localStorage.setItem(WEAK_KEY(), JSON.stringify(weakStats)); }

function populateTopics() {
  var topics = Array.from(new Set(allQuestions.map(function(q) { return q.topic; }))).sort();
  var list   = document.getElementById('multi-select-list');
  if (!list) return;

  selectedTopics = selectedTopics.filter(function(t) { return topics.includes(t); });

  list.innerHTML = topics.map(function(t) {
    var checked = selectedTopics.includes(t) ? 'checked' : '';
    var count   = allQuestions.filter(function(q) { return q.topic === t; }).length;
    return '<label class="multi-select-item">' +
      '<input type="checkbox" class="topic-checkbox" value="' + escHtml(t) + '" ' + checked + '/>' +
      '<span class="topic-item-name">' + escHtml(t) + '</span>' +
      '<span class="topic-item-count">' + count + '</span>' +
      '</label>';
  }).join('');

  if (topics.length === 0) {
    list.innerHTML = '<div style="padding:12px 14px;font-size:0.82rem;color:var(--muted);font-weight:600">No questions loaded yet.</div>';
  }

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
  var label = document.getElementById('multi-select-label');
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
  var hint = document.getElementById('topic-q-count');
  if (!hint) return;
  if (selectedTopics.length === 0) {
    hint.textContent = 'Select at least one topic to start';
    return;
  }
  var count = allQuestions.filter(function(q) { return selectedTopics.includes(q.topic); }).length;
  hint.textContent = count + ' question' + (count !== 1 ? 's' : '') + ' in selection';
}

function updateHomeStats() {
  var weakCount      = getWeakQuestions().length;
  var bmCount        = Object.keys(bookmarks).length;
  var totalAttempted = Object.values(weakStats).reduce(function(s, v) { return s + v.attempts; }, 0);

  document.getElementById('stat-total').textContent     = allQuestions.length || '—';
  document.getElementById('stat-weak').textContent      = weakCount;
  document.getElementById('stat-attempted').textContent = totalAttempted;

  document.getElementById('btn-weak-mode').disabled = weakCount === 0;
  document.getElementById('btn-weak-test').disabled = weakCount === 0;
  document.getElementById('weak-count-badge').textContent = weakCount > 0 ? weakCount + ' weak' : 'none yet';

  var bmBadge = document.getElementById('bookmark-count-badge');
  if (bmBadge) bmBadge.textContent = bmCount > 0 ? bmCount + ' saved' : 'none yet';

  var exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.style.display = allQuestions.length > 0 ? 'flex' : 'none';
    exportBtn.textContent   = '⬇ Export All (' + allQuestions.length + ' Qs)';
  }
}

function updateSetupHint() {
  var hint = document.getElementById('setup-available-hint');
  if (hint) hint.textContent = allQuestions.length + ' questions available';
  var inp = document.getElementById('overall-q-count');
  if (inp && allQuestions.length > 0 && parseInt(inp.value) > allQuestions.length) {
    inp.value    = allQuestions.length;
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
  timerInterval = setInterval(function() { timerSeconds++; updateTimerDisplay(); }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay() {
  var m = Math.floor(timerSeconds / 60);
  var s = timerSeconds % 60;
  document.getElementById('timer-value').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  var m = Math.floor(seconds / 60);
  var s = seconds % 60;
  if (m === 0) return s + 's';
  return m + 'm ' + s + 's';
}

// ══════════════════════════════════════════════════════════
// SESSION HISTORY
// ══════════════════════════════════════════════════════════

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY())) || []; } catch { return []; }
}

function saveSession(entry) {
  var history = loadHistory();
  history.unshift(entry);
  if (history.length > 100) history.pop();
  localStorage.setItem(HISTORY_KEY(), JSON.stringify(history));
}

function buildSessionEntry() {
  var pct = attempted > 0 ? Math.round((score / attempted) * 100) : 0;
  return {
    id:       Date.now(),
    date:     new Date().toISOString(),
    subject:  activeSubject,
    mode:     currentMode,
    topic:    currentMode === 'normal'
                ? (selectedTopics.length === 1 ? selectedTopics[0] : selectedTopics.length + ' Topics')
                : (currentMode === 'overall' ? 'All Topics' : currentMode === 'bookmark' ? 'Bookmarks' : 'Weak'),
    total:    attempted,
    correct:  score,
    wrong:    attempted - score,
    pct:      pct,
    timeSecs: timerMode === 'countup' ? timerSeconds : null
  };
}

function renderHistory(filterTab) {
  var all      = loadHistory();
  var filtered = filterTab === 'all' ? all : all.filter(function(s) {
    if (filterTab === 'topic')   return s.mode === 'normal';
    if (filterTab === 'overall') return s.mode === 'overall';
    if (filterTab === 'weak')    return s.mode === 'weaktest' || s.mode === 'retry';
    return true;
  });

  var container = document.getElementById('history-list');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No sessions yet' + (filterTab !== 'all' ? ' in this category' : '') + '.</p></div>';
    return;
  }

  container.innerHTML = filtered.map(function(s) {
    var d        = new Date(s.date);
    var dateStr  = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    var timeStr  = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    var modeLabel = s.mode === 'overall' ? '🌐 Overall' : s.mode === 'normal' ? '📘 Topic' : s.mode === 'weaktest' ? '🔴 Weak Test' : '🔁 Retry';
    var pctColor  = s.pct >= 80 ? 'var(--green)' : s.pct >= 50 ? 'var(--amber)' : 'var(--red)';
    var timeInfo  = s.timeSecs != null ? '<span class="hist-time">⏱ ' + formatTime(s.timeSecs) + '</span>' : '';
    var subjCfg   = SUBJECTS[s.subject] || SUBJECTS['maths'];
    var subjBadge = '<span class="hist-subject-badge hist-subj-' + (s.subject || 'maths') + '">' + subjCfg.icon + ' ' + (s.subject === 'reasoning' ? 'Reasoning' : 'Maths') + '</span>';

    return '<div class="history-item">' +
      '<div class="hist-top">' +
        '<span class="hist-mode">' + modeLabel + '</span>' +
        subjBadge +
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
  document.getElementById('btn-bookmarks').addEventListener('click', showBookmarkScreen);
  document.getElementById('btn-analytics').addEventListener('click', showAnalyticsScreen);

  // Bookmarks screen
  document.getElementById('btn-bookmark-home').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-start-bookmark-quiz').addEventListener('click', startBookmarkQuiz);

  // Analytics screen
  document.getElementById('btn-analytics-home').addEventListener('click', function() { showScreen('home'); });

  // PDF Report button
  var pdfBtn = document.getElementById('btn-pdf-report');
  if (pdfBtn) pdfBtn.addEventListener('click', function() { openReportModal(); });

  // Report modal close
  var closeModal = document.getElementById('btn-close-report-modal');
  if (closeModal) closeModal.addEventListener('click', function() { closeReportModal(); });

  // Generate Report confirm
  var genBtn = document.getElementById('btn-generate-report');
  if (genBtn) genBtn.addEventListener('click', function() { handleGenerateReport(); });

  // Bookmark toggle button in quiz
  document.getElementById('btn-bookmark').addEventListener('click', toggleBookmark);

  // Overall Quiz setup
  document.getElementById('btn-overall-setup').addEventListener('click', function() {
    updateSetupHint();
    showScreen('overall-setup');
  });
  document.getElementById('btn-overall-setup-back').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('btn-start-overall').addEventListener('click', function() {
    var val = parseInt(document.getElementById('overall-q-count').value) || 20;
    overallQCount = Math.max(1, Math.min(val, allQuestions.length || val));
    var radios = document.querySelectorAll('input[name="timer-mode"]');
    radios.forEach(function(r) { if (r.checked) timerMode = r.value; });
    startQuiz('overall');
  });

  // Number stepper
  document.getElementById('num-dec').addEventListener('click', function() {
    var inp = document.getElementById('overall-q-count');
    var val = parseInt(inp.value) || 20;
    if (val > 1) inp.value = val - 1;
  });
  document.getElementById('num-inc').addEventListener('click', function() {
    var inp = document.getElementById('overall-q-count');
    var val = parseInt(inp.value) || 20;
    var max = allQuestions.length || 500;
    if (val < max) inp.value = val + 1;
  });
  document.getElementById('overall-q-count').addEventListener('change', function() {
    var max = allQuestions.length || 500;
    var val = parseInt(this.value) || 1;
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
    if (!confirm('Clear all session history?')) return;
    localStorage.removeItem(HISTORY_KEY());
    renderHistory('all');
    showToast('History cleared.');
  });
  document.querySelectorAll('.history-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.history-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      renderHistory(tab.dataset.tab);
    });
  });

  // File upload events
  var dropZone  = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function() { handleFileUpload(this.files); });

  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFileUpload(e.dataTransfer.files);
  });

  // GitHub controls
  document.getElementById('btn-github-load').addEventListener('click', loadFromGithub);
  document.getElementById('btn-github-refresh').addEventListener('click', refreshFromGithub);
  document.getElementById('btn-github-clear').addEventListener('click', clearGithubUrl);

  // Export questions bank
  document.getElementById('btn-export').addEventListener('click', exportQuestionBank);

  // Clear bank
  document.getElementById('btn-clear-bank').addEventListener('click', clearQuestionBank);

  // Multi-select topic
  document.getElementById('multi-select-toggle').addEventListener('click', function() {
    var dd = document.getElementById('multi-select-dropdown');
    dd.classList.toggle('open');
  });
  document.addEventListener('click', function(e) {
    var wrap = document.getElementById('multi-select-wrap');
    if (wrap && !wrap.contains(e.target)) {
      var dd = document.getElementById('multi-select-dropdown');
      dd.classList.remove('open');
    }
  });
  document.getElementById('btn-select-all-topics').addEventListener('click', function() {
    document.querySelectorAll('.topic-checkbox').forEach(function(cb) {
      cb.checked = true;
      if (!selectedTopics.includes(cb.value)) selectedTopics.push(cb.value);
    });
    updateMultiSelectLabel(); updateTopicQCount();
  });
  document.getElementById('btn-clear-topics').addEventListener('click', function() {
    document.querySelectorAll('.topic-checkbox').forEach(function(cb) { cb.checked = false; });
    selectedTopics = [];
    updateMultiSelectLabel(); updateTopicQCount();
  });
}

// ══════════════════════════════════════════════════════════
// QUIZ START
// ══════════════════════════════════════════════════════════

function startQuiz(mode) {
  currentMode = mode;
  score = 0; attempted = 0; sessionWrong = []; sessionIndex = 0;
  timerMode = 'none';

  if (mode === 'normal') {
    if (selectedTopics.length === 0) { showToast('Select at least one topic first!'); return; }
    var pool = allQuestions.filter(function(q) { return selectedTopics.includes(q.topic); });
    if (pool.length === 0) { showToast('No questions in selected topics!'); return; }
    sessionQueue = shuffle(pool);
  } else if (mode === 'overall') {
    if (allQuestions.length === 0) { showToast('No questions loaded!'); return; }
    sessionQueue = shuffle(allQuestions).slice(0, overallQCount);
    timerMode    = document.querySelector('input[name="timer-mode"]:checked')?.value || 'none';
  } else if (mode === 'weaktest') {
    var wq = getWeakQueueSorted();
    if (wq.length === 0) { showToast('No weak questions yet!'); return; }
    sessionQueue = shuffle(wq);
  } else if (mode === 'retry') {
    if (sessionWrong.length === 0) { showToast('No wrong answers to retry!'); return; }
    sessionQueue = shuffle(sessionWrong.slice());
    sessionWrong = [];
  }

  startTimer();
  showScreen('quiz');
  updateModeIndicator();
  loadQuestion();
}

function loadQuestion() {
  if (sessionIndex >= sessionQueue.length) { showResult(); return; }

  currentQ = sessionQueue[sessionIndex];
  var total = sessionQueue.length;

  document.getElementById('progress-text').textContent = (sessionIndex + 1) + ' / ' + total;
  document.getElementById('progress-fill').style.width = ((sessionIndex / total) * 100) + '%';
  document.getElementById('q-number').textContent      = 'Question ' + (sessionIndex + 1);
  document.getElementById('q-text').textContent        = currentQ.question;
  document.getElementById('topic-pill').textContent    = currentQ.topic;

  var bmBtn = document.getElementById('btn-bookmark');
  if (bmBtn) {
    var isBookmarked = !!bookmarks[currentQ.id];
    bmBtn.textContent = isBookmarked ? '🔖' : '🏷️';
    bmBtn.classList.toggle('bookmarked', isBookmarked);
  }

  // Weak stat badge
  var weakStatEl = document.getElementById('q-weak-stat');
  if (weakStats[currentQ.id] && weakStats[currentQ.id].wrong > 0) {
    weakStatEl.style.display = 'block';
    var ws = weakStats[currentQ.id];
    weakStatEl.innerHTML = '<span class="weak-q-badge">⚠️ Attempted ' + ws.attempts + 'x · ' + ws.wrong + ' wrong</span>';
  } else {
    weakStatEl.style.display = 'none';
  }

  // Options
  var container = document.getElementById('options-container');
  container.innerHTML = '';
  var opts = currentQ.options.slice();
  opts.forEach(function(opt) {
    var btn = document.createElement('button');
    btn.className   = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', function() { selectOption(opt, btn); });
    container.appendChild(btn);
  });

  document.getElementById('feedback').style.display = 'none';
  document.getElementById('btn-next').style.display  = 'none';
}

function selectOption(selected, btn) {
  var optBtns = document.querySelectorAll('.option-btn');
  optBtns.forEach(function(b) { b.disabled = true; });

  var isCorrect = selected === currentQ.correct;
  attempted++;

  if (isCorrect) {
    score++;
    btn.classList.add('correct');
    document.getElementById('feedback').textContent   = '✅ Correct!';
    document.getElementById('feedback').className     = 'feedback-banner correct';
    awardXP(XP_PER_CORRECT);
  } else {
    btn.classList.add('wrong');
    sessionWrong.push(currentQ);
    optBtns.forEach(function(b) { if (b.textContent === currentQ.correct) b.classList.add('correct'); });
    document.getElementById('feedback').textContent   = '❌ Wrong! Correct: ' + currentQ.correct;
    document.getElementById('feedback').className     = 'feedback-banner wrong';
    awardXP(XP_PER_WRONG);
  }

  updateWeakStats(currentQ.id, isCorrect);
  document.getElementById('feedback').style.display = 'block';
  document.getElementById('btn-next').style.display  = 'flex';
  sessionIndex++;
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
// GAMIFICATION — XP / LEVELS / RANKS
// ══════════════════════════════════════════════════════════

function getTotalXP() {
  return parseInt(localStorage.getItem(XP_KEY) || '0', 10);
}

function awardXP(amount) {
  var prev = getTotalXP();
  var next = prev + amount;
  localStorage.setItem(XP_KEY, next);
  updateXPBar();
  var prevInfo = getLevelInfo(prev);
  var nextInfo = getLevelInfo(next);
  if (nextInfo.level > prevInfo.level) {
    showToast('🎉 Level Up! You are now Level ' + nextInfo.level + ' — ' + nextInfo.title + '!');
  }
}

function getLevelInfo(xp) {
  var info = LEVELS[0];
  for (var i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].xpMin) info = LEVELS[i];
    else break;
  }
  var nextLevelData = info.level < LEVELS.length ? LEVELS[info.level] : null;
  var xpIntoLevel   = xp - info.xpMin;
  var xpNeeded      = nextLevelData ? nextLevelData.xpMin - info.xpMin : 0;
  var pct           = xpNeeded > 0 ? Math.min(100, Math.round((xpIntoLevel / xpNeeded) * 100)) : 100;
  return { level: info.level, title: info.title, xp: xp, xpIntoLevel: xpIntoLevel, xpNeeded: xpNeeded, pct: pct };
}

function getRankEmoji(level) {
  if (level >= 10) return '👑';
  if (level >= 8)  return '🏆';
  if (level >= 6)  return '💎';
  if (level >= 4)  return '🥇';
  if (level >= 2)  return '🥈';
  return '🥉';
}

function updateXPBar() {
  var xp   = getTotalXP();
  var info = getLevelInfo(xp);
  var el   = document.getElementById('xp-bar-wrap');
  if (!el) return;

  document.getElementById('xp-level-badge').textContent  = 'Lv.' + info.level;
  document.getElementById('xp-rank-title').textContent   = getRankEmoji(info.level) + ' ' + info.title;
  document.getElementById('xp-bar-fill').style.width     = info.pct + '%';
  document.getElementById('xp-bar-label').textContent    = info.xp + ' XP';
}

// ══════════════════════════════════════════════════════════
// BOOKMARKS
// ══════════════════════════════════════════════════════════

function loadBookmarks() {
  try { bookmarks = JSON.parse(localStorage.getItem(BOOKMARK_KEY())) || {}; } catch { bookmarks = {}; }
}

function saveBookmarks() {
  localStorage.setItem(BOOKMARK_KEY(), JSON.stringify(bookmarks));
}

function toggleBookmark() {
  if (!currentQ) return;
  if (bookmarks[currentQ.id]) {
    delete bookmarks[currentQ.id];
    showToast('Bookmark removed.');
  } else {
    bookmarks[currentQ.id] = { id: currentQ.id, topic: currentQ.topic, question: currentQ.question, options: currentQ.options, correct: currentQ.correct, savedAt: Date.now() };
    showToast('🔖 Bookmarked!');
  }
  saveBookmarks();
  var bmBtn = document.getElementById('btn-bookmark');
  if (bmBtn) {
    var isBookmarked = !!bookmarks[currentQ.id];
    bmBtn.textContent = isBookmarked ? '🔖' : '🏷️';
    bmBtn.classList.toggle('bookmarked', isBookmarked);
  }
  updateHomeStats();
}

function showBookmarkScreen() {
  var list       = Object.values(bookmarks);
  var container  = document.getElementById('bookmark-list');

  document.getElementById('bookmark-count-text').textContent =
    list.length + ' question' + (list.length !== 1 ? 's' : '') + ' bookmarked';

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔖</div><p>No bookmarks yet.<br>Tap 🏷️ during a quiz to save questions.</p></div>';
  } else {
    list.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    container.innerHTML = list.map(function(q) {
      var qTx = q.question.length > 80 ? q.question.slice(0, 80) + '…' : q.question;
      return '<div class="bookmark-item" data-id="' + q.id + '">' +
        '<div class="bookmark-item-top">' +
          '<span class="bookmark-topic-pill">' + escHtml(q.topic) + '</span>' +
          '<button class="bookmark-remove-btn" onclick="removeBookmark(\'' + q.id + '\')">✕</button>' +
        '</div>' +
        '<div class="bookmark-item-q">' + escHtml(qTx) + '</div>' +
        '<div class="bookmark-item-ans">✅ <strong>' + escHtml(q.correct) + '</strong></div>' +
      '</div>';
    }).join('');
  }

  document.getElementById('btn-start-bookmark-quiz').disabled = list.length === 0;
  showScreen('bookmarks');
}

function removeBookmark(id) {
  delete bookmarks[id];
  saveBookmarks();
  showBookmarkScreen();
  updateHomeStats();
}

function startBookmarkQuiz() {
  var list = Object.values(bookmarks);
  if (list.length === 0) { showToast('No bookmarks to quiz!'); return; }
  currentMode  = 'bookmark';
  score        = 0; attempted = 0; sessionWrong = []; sessionIndex = 0;
  timerMode    = 'none';
  sessionQueue = shuffle(list);
  startTimer();
  showScreen('quiz');
  updateModeIndicator();
  loadQuestion();
}

// ══════════════════════════════════════════════════════════
// ANALYTICS SCREEN — Topic Accuracy
// ══════════════════════════════════════════════════════════

function showAnalyticsScreen() {
  var topics = Array.from(new Set(allQuestions.map(function(q) { return q.topic; }))).sort();

  var topicStats = topics.map(function(topic) {
    var qs = allQuestions.filter(function(q) { return q.topic === topic; });
    var totalAttempts = 0, totalWrong = 0;
    qs.forEach(function(q) {
      var s = weakStats[q.id];
      if (s) { totalAttempts += s.attempts; totalWrong += s.wrong; }
    });
    var correct = totalAttempts - totalWrong;
    var pct = totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : -1;
    return { topic: topic, attempts: totalAttempts, correct: correct, wrong: totalWrong, pct: pct, qCount: qs.length };
  });

  var attempted_topics = topicStats.filter(function(t) { return t.pct >= 0; });
  var unattempted      = topicStats.filter(function(t) { return t.pct < 0; });

  attempted_topics.sort(function(a, b) { return a.pct - b.pct; });

  var totalA = 0, totalC = 0;
  attempted_topics.forEach(function(t) { totalA += t.attempts; totalC += t.correct; });
  var overallPct = totalA > 0 ? Math.round((totalC / totalA) * 100) : 0;

  var xp   = getTotalXP();
  var info = getLevelInfo(xp);

  document.getElementById('analytics-overall-pct').textContent  = totalA > 0 ? overallPct + '%' : '—';
  document.getElementById('analytics-total-attempts').textContent = totalA;
  document.getElementById('analytics-topics-done').textContent  = attempted_topics.length + ' / ' + topics.length;
  document.getElementById('analytics-xp-val').textContent       = xp + ' XP';
  document.getElementById('analytics-rank-val').textContent     = getRankEmoji(info.level) + ' ' + info.title + ' (Lv.' + info.level + ')';

  var container = document.getElementById('analytics-topic-list');
  if (attempted_topics.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>No attempts yet.<br>Start a quiz to see your topic accuracy.</p></div>';
  } else {
    container.innerHTML = attempted_topics.map(function(t, idx) {
      var barColor = t.pct >= 80 ? 'var(--lime)' : t.pct >= 50 ? 'var(--orange)' : 'var(--pink)';
      var rankBadge = idx === 0 ? '<span class="worst-badge">Weakest</span>' : (idx === attempted_topics.length - 1 ? '<span class="best-badge">Strongest</span>' : '');
      return '<div class="analytics-topic-row">' +
        '<div class="analytics-topic-top">' +
          '<span class="analytics-topic-name">' + escHtml(t.topic) + '</span>' +
          rankBadge +
          '<span class="analytics-topic-pct" style="color:' + barColor + '">' + t.pct + '%</span>' +
        '</div>' +
        '<div class="analytics-bar-track">' +
          '<div class="analytics-bar-fill" style="width:' + t.pct + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<div class="analytics-topic-meta">' + t.correct + ' correct / ' + t.attempts + ' attempts · ' + t.qCount + ' Qs</div>' +
      '</div>';
    }).join('');

    if (unattempted.length > 0) {
      container.innerHTML += '<div class="analytics-unattempted-label">Not yet attempted (' + unattempted.length + ' topics)</div>' +
        unattempted.map(function(t) {
          return '<div class="analytics-topic-row unattempted">' +
            '<div class="analytics-topic-top">' +
              '<span class="analytics-topic-name">' + escHtml(t.topic) + '</span>' +
              '<span class="analytics-topic-pct" style="color:var(--muted)">—</span>' +
            '</div>' +
            '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:0%"></div></div>' +
            '<div class="analytics-topic-meta">' + t.qCount + ' questions available</div>' +
          '</div>';
        }).join('');
    }
  }

  showScreen('analytics');
}

// ══════════════════════════════════════════════════════════
// THEME / SCREEN / UTILITIES
// ══════════════════════════════════════════════════════════

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function updateModeIndicator() {
  var el = document.getElementById('mode-indicator');
  if (currentMode === 'weaktest' || currentMode === 'weak') {
    el.textContent = '🔴 Weak Mode'; el.className = 'mode-indicator';
  } else if (currentMode === 'retry') {
    el.textContent = '🔁 Retry Mode'; el.className = 'mode-indicator';
  } else if (currentMode === 'overall') {
    el.textContent = '🌐 Overall Quiz'; el.className = 'mode-indicator overall';
  } else if (currentMode === 'bookmark') {
    el.textContent = '🔖 Bookmarks Quiz'; el.className = 'mode-indicator bookmark';
  } else {
    var topicLabel = selectedTopics.length === 0 ? 'No Topic' : selectedTopics.length === 1 ? selectedTopics[0] : selectedTopics.length + ' Topics';
    el.textContent = '🟡 ' + topicLabel; el.className = 'mode-indicator normal';
  }
  document.getElementById('timer-display').style.display = (timerMode === 'countup') ? 'flex' : 'none';
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelector('.subject-tab-bar').style.display = (name === 'home') ? 'flex' : 'none';
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

// ══════════════════════════════════════════════════════════
// PDF PERFORMANCE REPORT — FULL IMPLEMENTATION
// ══════════════════════════════════════════════════════════

/* ── Report Modal UI ── */

function openReportModal() {
  var modal = document.getElementById('report-modal');
  if (modal) {
    modal.classList.add('open');
    // Pre-select active subject
    var subjectSelect = document.getElementById('report-subject-select');
    if (subjectSelect) subjectSelect.value = activeSubject;
  }
}

function closeReportModal() {
  var modal = document.getElementById('report-modal');
  if (modal) modal.classList.remove('open');
}

function handleGenerateReport() {
  var subjectSelect  = document.getElementById('report-subject-select');
  var combinedCheck  = document.getElementById('report-combined-check');
  var subject        = subjectSelect ? subjectSelect.value : activeSubject;
  var includeCombined = combinedCheck ? combinedCheck.checked : false;

  closeReportModal();
  generatePerformanceReport({ subject: subject, includeCombined: includeCombined });
}

/* ══════════════════════════════════════════════════════════
   MAIN REPORT GENERATOR
   generatePerformanceReport(options)
   options.subject         : 'maths' | 'reasoning'
   options.includeCombined : boolean
   ══════════════════════════════════════════════════════════ */

async function generatePerformanceReport(options) {
  options = options || {};
  var subject         = options.subject || activeSubject;
  var includeCombined = options.includeCombined || false;

  // Show loading overlay
  showReportLoader(true);

  try {
    // Load jsPDF dynamically if not already loaded
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js');

    if (includeCombined) {
      await buildCombinedReport();
    } else {
      var data = getAnalyticsData(subject);
      await buildPDF(data, subject);
    }
  } catch(err) {
    console.error('PDF generation error:', err);
    showToast('❌ Report generation failed. Please try again.');
  } finally {
    showReportLoader(false);
  }
}

function showReportLoader(show) {
  var overlay = document.getElementById('report-loader');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

function loadScript(src) {
  return new Promise(function(resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    var s   = document.createElement('script');
    s.src   = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ── DATA COLLECTION ── */

function getAnalyticsData(subject) {
  var savedSubject = activeSubject; // save current

  // Temporarily read subject keys
  var weakKey    = 'quiz_' + subject + '_weak_stats';
  var historyKey = 'quiz_' + subject + '_session_history';
  var bankKey    = 'quiz_' + subject + '_question_bank';

  var weakData    = {};
  var history     = [];
  var questions   = [];

  try { weakData  = JSON.parse(localStorage.getItem(weakKey)) || {}; }    catch { weakData = {}; }
  try { history   = JSON.parse(localStorage.getItem(historyKey)) || []; } catch { history = []; }
  try { questions = JSON.parse(localStorage.getItem(bankKey)) || []; }    catch { questions = []; }

  // Limit to last 50 sessions
  history = history.slice(0, 50);

  // XP / Level (global)
  var xp   = getTotalXP();
  var info = getLevelInfo(xp);

  // Overall stats
  var totalAttempts = 0, totalCorrect = 0;
  Object.values(weakData).forEach(function(s) {
    totalAttempts += s.attempts;
    totalCorrect  += (s.attempts - s.wrong);
  });
  var overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  // Total time from history
  var totalTimeSecs = history.reduce(function(sum, s) { return sum + (s.timeSecs || 0); }, 0);

  // Topic stats
  var topics = Array.from(new Set(questions.map(function(q) { return q.topic; }))).sort();
  var topicStats = topics.map(function(topic) {
    var qs = questions.filter(function(q) { return q.topic === topic; });
    var att = 0, wrong = 0;
    qs.forEach(function(q) {
      var s = weakData[q.id];
      if (s) { att += s.attempts; wrong += s.wrong; }
    });
    var correct = att - wrong;
    var pct = att > 0 ? Math.round((correct / att) * 100) : 0;
    return { topic: topic, attempts: att, correct: correct, wrong: wrong, pct: pct, qCount: qs.length, hasData: att > 0 };
  });

  // Sort for weak/strong
  var attemptedTopics = topicStats.filter(function(t) { return t.hasData; });
  attemptedTopics.sort(function(a, b) { return a.pct - b.pct; }); // worst first
  var weakTopics   = attemptedTopics.slice(0, 5);
  var strongTopics = attemptedTopics.slice(-3).reverse();

  // Session trend (last 10 sessions with accuracy)
  var sessionTrend = history.slice(0, 10).reverse().map(function(s, i) {
    return { label: 'S' + (i + 1), pct: s.pct || 0, date: s.date };
  });

  // Speed analysis
  var timedSessions = history.filter(function(s) { return s.timeSecs && s.total > 0; });
  var avgTimePerQ   = 0;
  var fastestSess   = null, slowestSess = null;
  if (timedSessions.length > 0) {
    var perQTimes = timedSessions.map(function(s) { return s.timeSecs / s.total; });
    avgTimePerQ = Math.round(perQTimes.reduce(function(a,b){return a+b;},0) / perQTimes.length);
    fastestSess = timedSessions.reduce(function(a,b){ return (a.timeSecs/a.total) < (b.timeSecs/b.total) ? a : b; });
    slowestSess = timedSessions.reduce(function(a,b){ return (a.timeSecs/a.total) > (b.timeSecs/b.total) ? a : b; });
  }

  // Consistency score (active days in last 30)
  var now = Date.now();
  var days30 = 30 * 24 * 3600 * 1000;
  var activeDays = new Set(
    history.filter(function(s) { return now - new Date(s.date).getTime() < days30; })
           .map(function(s) { return new Date(s.date).toDateString(); })
  ).size;
  var consistencyScore = Math.min(100, Math.round((activeDays / 30) * 100));

  // Smart insights
  var insights = generateInsights({
    overallAccuracy: overallAccuracy,
    totalAttempts: totalAttempts,
    weakTopics: weakTopics,
    strongTopics: strongTopics,
    sessionTrend: sessionTrend,
    avgTimePerQ: avgTimePerQ,
    consistencyScore: consistencyScore,
    subject: subject
  });

  return {
    subject: subject,
    subjectLabel: SUBJECTS[subject] ? SUBJECTS[subject].label.replace('Quiz','') : subject,
    questions: questions,
    history: history,
    weakData: weakData,
    topicStats: topicStats,
    attemptedTopics: attemptedTopics,
    weakTopics: weakTopics,
    strongTopics: strongTopics,
    sessionTrend: sessionTrend,
    overallAccuracy: overallAccuracy,
    totalAttempts: totalAttempts,
    totalCorrect: totalCorrect,
    totalWrong: totalAttempts - totalCorrect,
    totalTimeSecs: totalTimeSecs,
    avgTimePerQ: avgTimePerQ,
    fastestSess: fastestSess,
    slowestSess: slowestSess,
    consistencyScore: consistencyScore,
    activeDays: activeDays,
    insights: insights,
    xp: xp,
    levelInfo: info,
    reportDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  };
}

/* ── INSIGHTS ENGINE ── */

function generateInsights(params) {
  var insights = [];
  var acc = params.overallAccuracy;
  var weak = params.weakTopics;
  var strong = params.strongTopics;
  var trend = params.sessionTrend;
  var avgT = params.avgTimePerQ;

  // Accuracy insight
  if (params.totalAttempts === 0) {
    insights.push({ icon: '📚', text: 'No attempts yet for ' + (params.subject === 'maths' ? 'Maths' : 'Reasoning') + '. Start a quiz to generate insights!', color: 'neutral' });
  } else if (acc >= 85) {
    insights.push({ icon: '🏆', text: 'Outstanding! Your overall accuracy is ' + acc + '%. You are performing at an expert level.', color: 'green' });
  } else if (acc >= 70) {
    insights.push({ icon: '📈', text: 'Good performance! Overall accuracy stands at ' + acc + '%. Keep pushing for 85%+.', color: 'blue' });
  } else if (acc >= 50) {
    insights.push({ icon: '⚡', text: 'Your accuracy is ' + acc + '%. Focused practice on weak areas will boost your score significantly.', color: 'orange' });
  } else {
    insights.push({ icon: '', text: 'Accuracy at ' + acc + '%. Start with easier topics and gradually tackle harder ones.', color: 'red' });
  }

  // Strong/Weak topic insight
  if (strong.length > 0 && weak.length > 0) {
    insights.push({ icon: '💡', text: 'You are strong in "' + strong[0].topic + '" (' + strong[0].pct + '%) but need work in "' + weak[0].topic + '" (' + weak[0].pct + '%).', color: 'blue' });
  } else if (strong.length > 0) {
    insights.push({ icon: '⭐', text: 'Your strongest topic is "' + strong[0].topic + '" with ' + strong[0].pct + '% accuracy. Excellent work!', color: 'green' });
  } else if (weak.length > 0) {
    insights.push({ icon: '🔴', text: '"' + weak[0].topic + '" is your weakest area at ' + weak[0].pct + '%. Prioritize this topic in your study plan.', color: 'red' });
  }

  // Trend insight
  if (trend.length >= 3) {
    var recent = trend.slice(-3);
    var isImproving = recent[recent.length-1].pct > recent[0].pct;
    var isDeclining = recent[recent.length-1].pct < recent[0].pct - 10;
    if (isImproving) {
      insights.push({ icon: '📊', text: 'Great trend! Your accuracy has been improving over recent sessions. Keep up the momentum!', color: 'green' });
    } else if (isDeclining) {
      insights.push({ icon: '', text: 'Your recent sessions show a dip in accuracy. Consider reviewing weak topics before your next session.', color: 'orange' });
    } else {
      insights.push({ icon: '', text: 'Your performance has been consistent. Push yourself with harder topics to break through the plateau.', color: 'blue' });
    }
  }

  // Speed insight
  if (avgT > 0) {
    if (avgT < 30) {
      insights.push({ icon: '⏩', text: 'You answer in about ' + avgT + 's/question — very fast! Double-check your answers to avoid careless mistakes.', color: 'orange' });
    } else if (avgT > 90) {
      insights.push({ icon: '🐢', text: 'Average ' + avgT + 's per question. Try to improve your speed while maintaining accuracy for competitive exams.', color: 'blue' });
    } else {
      insights.push({ icon: '⏱', text: 'Solid pace at ' + avgT + 's per question — a good balance of speed and accuracy.', color: 'green' });
    }
  }

  return insights;
}

/* ── CHART GENERATION ── */

async function generateCharts(data) {
  // Create off-screen canvas elements
  var charts = {};

  // 1. Donut chart — accuracy
  charts.donut = await createDonutChart(data.totalCorrect, data.totalWrong);

  // 2. Line chart — session trend
  charts.trend = await createTrendChart(data.sessionTrend);

  // 3. Bar chart — topic performance
  charts.bar = await createBarChart(data.topicStats);

  return charts;
}

function createChartCanvas(w, h) {
  var canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.style.display = 'none';
  document.body.appendChild(canvas);
  return canvas;
}

var chartWhiteBgPlugin = {
  id: 'whiteBg',
  beforeDraw: function(chart) {
    var ctx = chart.canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, chart.canvas.width, chart.canvas.height);
    ctx.restore();
  }
};

function destroyCanvas(canvas) {
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
}

async function createDonutChart(correct, wrong) {
  var canvas = createChartCanvas(400, 400);
  var hasData = (correct + wrong) > 0;

  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  var chart = new Chart(canvas, {
    plugins: [chartWhiteBgPlugin],
    type: 'doughnut',
    data: {
      labels: ['Correct', 'Wrong'],
      datasets: [{
        data: hasData ? [correct, wrong] : [1, 0],
        backgroundColor: hasData ? ['#0f9b4b', '#d21e78'] : ['#c8cae1', '#c8cae1'],
        borderColor:     ['#ffffff'],
        borderWidth: 3,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      cutout: '65%',
      animation: { duration: 0 }
    }
  });

  await new Promise(function(r){ setTimeout(r, 200); });
  var img = canvas.toDataURL('image/jpeg', 0.92);
  chart.destroy();
  destroyCanvas(canvas);
  return img;
}

async function createTrendChart(sessionTrend) {
  var canvas = createChartCanvas(700, 280);
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  var hasData = sessionTrend.length > 0;

  var labels = hasData ? sessionTrend.map(function(s){ return s.label; }) : ['S1','S2','S3','S4','S5'];
  var values = hasData ? sessionTrend.map(function(s){ return s.pct; })   : [0,0,0,0,0];

  var chart = new Chart(canvas, {
    plugins: [chartWhiteBgPlugin],
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Accuracy %',
        data: values,
        borderColor: '#6e32d2',
        backgroundColor: 'rgba(110,50,210,0.12)',
        borderWidth: 3,
        pointBackgroundColor: '#d21e78',
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: false,
      animation: { duration: 0 },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { color: '#646991', font: { size: 11 }, stepSize: 20 },
          grid:  { color: 'rgba(0,0,0,0.07)' },
          border: { color: 'rgba(0,0,0,0.15)' }
        },
        x: {
          ticks: { color: '#646991', font: { size: 11 } },
          grid:  { color: 'rgba(0,0,0,0.07)' },
          border: { color: 'rgba(0,0,0,0.15)' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  await new Promise(function(r){ setTimeout(r, 200); });
  var img = canvas.toDataURL('image/jpeg', 0.92);
  chart.destroy();
  destroyCanvas(canvas);
  return img;
}

async function createBarChart(topicStats) {
  var canvas = createChartCanvas(700, 320);
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Show all topics; use placeholder if none
  var display = topicStats.length > 0
    ? topicStats.slice(0, 10)
    : [{ topic: 'No Data', pct: 0, hasData: false }];

  var labels = display.map(function(t){ return t.topic.length > 14 ? t.topic.slice(0,13)+'…' : t.topic; });
  var values = display.map(function(t){ return t.hasData ? t.pct : 0; });
  var colors = display.map(function(t){
    if (!t.hasData) return '#c8cae1';
    if (t.pct >= 80) return '#0f9b4b';
    if (t.pct >= 50) return '#d26414';
    return '#d21e78';
  });

  var chart = new Chart(canvas, {
    plugins: [chartWhiteBgPlugin],
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Accuracy %',
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: false,
      animation: { duration: 0 },
      indexAxis: 'y',
      scales: {
        x: {
          min: 0, max: 100,
          ticks: { color: '#646991', font: { size: 10 } },
          grid:  { color: 'rgba(0,0,0,0.07)' },
          border: { color: 'rgba(0,0,0,0.15)' }
        },
        y: {
          ticks: { color: '#191c37', font: { size: 10 } },
          grid:  { display: false },
          border: { color: 'rgba(0,0,0,0.15)' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  await new Promise(function(r){ setTimeout(r, 200); });
  var img = canvas.toDataURL('image/jpeg', 0.80);
  chart.destroy();
  destroyCanvas(canvas);
  return img;
}

/* ── PDF BUILDER ── */

async function buildPDF(data, subject) {
  var { jsPDF } = window.jspdf;
  var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Generate charts
  var charts = await generateCharts(data);

  // Palette — white paper theme for PDF
// Palette — white paper for print
  var C = getPalette();

  var pW = 210, pH = 297;
  var margin = 12;
  var contentW = pW - margin * 2;

  /* ═══════════════ PAGE 1 ═══════════════ */

  // Background
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, pW, pH, 'F');

  // Top gradient bar
  drawGradientBar(doc, 0, 0, pW, 28, C.violet, C.pink);

  // Header text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C.white);
  doc.text('Performance Report', margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 220);
  var subjectIcon = data.subject === 'maths' ? '∑' : '⬡';
  doc.text(data.subjectLabel + ' · ' + data.reportDate + ' · Quiz PWA', margin, 20);

  // Subject badge
  var subjColor = data.subject === 'maths' ? C.violet : C.cyan;
  drawRoundedRect(doc, pW - 60, 5, 50, 14, 4, subjColor, null);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.white);
  doc.text(data.subjectLabel.toUpperCase(), pW - 35, 13.5, { align: 'center' });

  var y = 34;

  /* ── Section: Overall Performance ── */
  y = drawSectionTitle(doc, 'Overall Performance', y, C, margin, contentW);
  y += 2;

  var statBoxes = [
    { label: 'Total Attempted', value: data.totalAttempts || '0', color: C.cyan },
    { label: 'Accuracy',        value: (data.overallAccuracy || 0) + '%', color: data.overallAccuracy >= 70 ? C.lime : data.overallAccuracy >= 50 ? C.orange : C.pink },
    { label: 'Correct',         value: data.totalCorrect || '0', color: C.lime },
    { label: 'Wrong',           value: data.totalWrong || '0', color: C.pink },
  ];

  var boxW = (contentW - 6) / 4;
  statBoxes.forEach(function(box, i) {
    var bx = margin + i * (boxW + 2);
    drawStatBox(doc, bx, y, boxW, 22, box, C);
  });
  y += 26;

  // Time row
  var timeBoxes = [
    { label: 'Time Spent',   value: formatTime(data.totalTimeSecs) || '—', color: C.yellow },
    { label: 'Avg per Q',    value: data.avgTimePerQ ? data.avgTimePerQ + 's' : '—', color: C.orange },
    { label: 'Active Days',  value: data.activeDays + '/30', color: C.cyan },
    { label: 'Consistency',  value: data.consistencyScore + '%', color: data.consistencyScore >= 60 ? C.lime : C.orange },
  ];
  var tboxW = (contentW - 6) / 4;
  timeBoxes.forEach(function(box, i) {
    var bx = margin + i * (tboxW + 2);
    drawStatBox(doc, bx, y, tboxW, 22, box, C);
  });
  y += 28;

  /* ── Donut + Trend Row ── */
  var donutW = 52, donutH = 52;
  var trendW  = contentW - donutW - 6, trendH = 52;

  // Donut chart panel
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, donutW, donutH + 6, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, donutW, donutH + 6, 3, 3, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text('ACCURACY', margin + donutW/2, y + 5, { align: 'center' });
  doc.addImage(charts.donut, 'JPEG', margin + 4, y + 6, donutW - 8, donutH - 8);

  // Accuracy overlay text
  var accPct = data.overallAccuracy || 0;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...(accPct >= 70 ? C.lime : accPct >= 50 ? C.orange : C.pink));
  doc.text(accPct + '%', margin + donutW/2, y + donutH/2 + 4, { align: 'center' });

  // Legend
  doc.setFontSize(6.5);
  doc.setTextColor(...C.lime);
  doc.text('[C] Correct', margin + 4, y + donutH + 2);
  doc.setTextColor(...C.pink);
  doc.text('[W] Wrong', margin + 20, y + donutH + 2);

  // Trend chart panel
  var tx = margin + donutW + 6;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(tx, y, trendW, trendH + 6, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.roundedRect(tx, y, trendW, trendH + 6, 3, 3, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text('LAST ' + Math.max(data.sessionTrend.length, 5) + ' SESSIONS — ACCURACY TREND', tx + 4, y + 5);
  doc.addImage(charts.trend, 'JPEG', tx + 2, y + 7, trendW - 4, trendH - 6);

  y += donutH + 14;

  /* ── Topic Performance Bar Chart ── */
  y = drawSectionTitle(doc, 'Topic-wise Performance', y, C, margin, contentW);
  y += 2;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, contentW, 58, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, 58, 3, 3, 'S');
  doc.addImage(charts.bar, 'JPEG', margin + 2, y + 2, contentW - 4, 54);
  y += 62;
  /* ── Quick Topic Legend ── */
  doc.setFontSize(7);
  var legendItems = [
    { label: '>=80% = Strong', color: C.lime },
    { label: '50-79% = Average', color: C.orange },
    { label: '<50% = Weak', color: C.pink },
    { label: 'No data = Not attempted', color: C.muted }
  ];
  legendItems.forEach(function(item, i) {
    doc.setTextColor(...item.color);
    doc.text('* ' + item.label, margin + i * 50, y);
  });

  // Footer p1
  drawFooter(doc, 1, 2, pH, pW, C);

  /* ═══════════════ PAGE 2 ═══════════════ */
  doc.addPage();

  doc.setFillColor(...C.bg);
  doc.rect(0, 0, pW, pH, 'F');

  // Page 2 header strip
  drawGradientBar(doc, 0, 0, pW, 20, C.cyan, C.violet);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.white);
  doc.text('Deep Analysis', margin, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 230);
  doc.text(data.subjectLabel + ' · ' + data.reportDate, pW - margin, 13, { align: 'right' });

  y = 26;

  /* ── Weak Areas + Speed Analysis Row ── */
  var colW = (contentW - 6) / 2;

  // Left: Weak Areas
  y = drawSectionTitle(doc, 'Top Weak Areas', y, C, margin, colW);
  drawPanel(doc, margin, y + 2, colW, 58, C);

  if (data.weakTopics.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text('No weak areas found — great job!', margin + 4, y + 18);
  } else {
    data.weakTopics.slice(0,5).forEach(function(t, i) {
      var ty = y + 8 + i * 10;
      var barMax = colW - 16;
      var barLen = Math.max(4, (t.pct / 100) * barMax);

      // Bar bg
      doc.setFillColor(...C.surface2);
      doc.roundedRect(margin + 4, ty + 3, barMax, 5, 1, 1, 'F');

      // Bar fill
      doc.setFillColor(...C.pink);
      doc.roundedRect(margin + 4, ty + 3, barLen, 5, 1, 1, 'F');

      // Topic name
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      var topicLabel = t.topic.length > 18 ? t.topic.slice(0,17)+'…' : t.topic;
      doc.text(topicLabel, margin + 4, ty + 1.5);

      // Pct
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.pink);
      doc.text(t.pct + '%', margin + colW - 4, ty + 1.5, { align: 'right' });
    });
  }

  // Right: Speed Analysis
  var rx = margin + colW + 6;
  var ry = y; // align with weak section title area
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.cyan);
  doc.text('Speed Analysis', rx, ry);
  drawPanel(doc, rx, ry + 2, colW, 58, C);

  var speedItems = [
    { label: 'Avg Time / Question', value: data.avgTimePerQ ? data.avgTimePerQ + 's' : '—' },
    { label: 'Fastest Session',     value: data.fastestSess ? formatTime(data.fastestSess.timeSecs) : '—' },
    { label: 'Slowest Session',     value: data.slowestSess ? formatTime(data.slowestSess.timeSecs) : '—' },
    { label: 'Total Sessions',      value: data.history.length + '' },
  ];
  speedItems.forEach(function(item, i) {
    var sy = ry + 11 + i * 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(item.label, rx + 4, sy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.cyan);
    doc.text(item.value, rx + colW - 4, sy + 4, { align: 'right' });
  });

  y += 68;

  /* ── Consistency + XP Row ── */
  var csW = (contentW - 6) / 2;

  // Consistency
y = drawSectionTitle(doc, 'Consistency Score', y, C, margin, csW);  drawPanel(doc, margin, y + 2, csW, 36, C);

  var cScore = data.consistencyScore;
  var cColor = cScore >= 70 ? C.lime : cScore >= 40 ? C.orange : C.pink;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...cColor);
  doc.text(cScore + '%', margin + csW / 2, y + 22, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text(data.activeDays + ' active days in last 30', margin + csW/2, y + 32, { align: 'center' });

  // Consistency bar
  drawProgressBar(doc, margin + 4, y + 34, csW - 8, 4, cScore / 100, cColor, C.surface2);

  // XP & Rank
  var xpX = margin + csW + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.yellow);
  doc.text('XP & Rank', xpX, y);
  drawPanel(doc, xpX, y + 2, csW, 36, C);

  var info = data.levelInfo;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...C.yellow);
doc.text('Lv.' + info.level, xpX + csW/2, y + 15, { align: 'center' });  doc.setFontSize(9);
  doc.setTextColor(...C.orange);
  doc.text(info.title, xpX + csW/2, y + 22, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text(info.xp + ' XP · ' + info.xpIntoLevel + '/' + (info.xpNeeded || '∞') + ' to next level', xpX + csW/2, y + 30, { align: 'center' });

  // XP progress bar
  drawProgressBar(doc, xpX + 4, y + 34, csW - 8, 4, info.pct / 100, C.yellow, C.surface2);

  y += 46;

  /* ── Smart Insights ── */
y = drawSectionTitle(doc, 'Smart Insights', y, C, margin, contentW);  y += 2;

  var insightColors = {
    green:   C.lime,
    blue:    C.cyan,
    orange:  C.orange,
    red:     C.pink,
    neutral: C.muted
  };

  var iPerRow = 1;
  data.insights.forEach(function(ins, i) {
    if (y > pH - 50) return; // safety
    var iColor = insightColors[ins.color] || C.cyan;

    drawPanel(doc, margin, y, contentW, 18, C);

    // Color accent bar
    doc.setFillColor(...iColor);
    doc.roundedRect(margin, y, 3, 18, 1, 1, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.text);
    var lines = doc.splitTextToSize(ins.text, contentW - 14);
    var textY = lines.length === 1 ? y + 11.5 : y + 8;
    doc.text(lines.slice(0,2), margin + 8, textY);

    y += 22;
  });

  // Footer p2
  drawFooter(doc, 2, 2, pH, pW, C);

  // Save
  var filename = 'Quiz_Report_' + data.subjectLabel + '_' + getTodayStr() + '.pdf';
  doc.save(filename);
  showToast('✅ Report saved: ' + filename);
}

/* ── COMBINED REPORT ── */

async function buildCombinedReport() {
  var mathsData    = getAnalyticsData('maths');
  var reasonData   = getAnalyticsData('reasoning');
  var { jsPDF }    = window.jspdf;
  var doc          = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  var chartsM = await generateCharts(mathsData);
  var chartsR = await generateCharts(reasonData);

  var C = getPalette();
  var pW = 210, pH = 297, margin = 12, contentW = pW - margin * 2;

  // ── Page 1: Maths ──
  await renderSubjectPage(doc, mathsData, chartsM, C, pW, pH, margin, contentW, 1, 4);

  // ── Page 2: Reasoning ──
  doc.addPage();
  await renderSubjectPage(doc, reasonData, chartsR, C, pW, pH, margin, contentW, 2, 4);

  // ── Page 3: Comparison ──
  doc.addPage();
  renderComparisonPage(doc, mathsData, reasonData, C, pW, pH, margin, contentW);

  var filename = 'Quiz_Report_Combined_' + getTodayStr() + '.pdf';
  doc.save(filename);
  showToast('✅ Combined report saved!');
}

function getPalette() {
  return {
    bg:       [255, 255, 255],
    surface:  [245, 246, 252],
    surface2: [235, 236, 248],
    border:   [200, 202, 225],
    violet:   [110, 50, 210],
    pink:     [210, 30, 120],
    cyan:     [0, 140, 200],
    lime:     [15, 155, 75],
    orange:   [210, 100, 20],
    yellow:   [170, 120, 0],
    muted:    [100, 105, 145],
    text:     [25, 28, 55],
    white:    [25, 28, 55],
    green:    [15, 155, 75],
    red:      [210, 30, 120],
  };
}

async function renderSubjectPage(doc, data, charts, C, pW, pH, margin, contentW, pageNum, totalPages) {
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, pW, pH, 'F');

  var gradA = data.subject === 'maths' ? C.violet : C.cyan;
  var gradB = data.subject === 'maths' ? C.pink   : C.violet;
  drawGradientBar(doc, 0, 0, pW, 24, gradA, gradB);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...C.white);
  doc.text(data.subjectLabel + ' — Performance Report', margin, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 220);
  doc.text(data.reportDate, pW - margin, 14, { align: 'right' });

  var y = 30;
  var statBoxes = [
    { label: 'Attempted', value: data.totalAttempts || '0', color: C.cyan },
    { label: 'Accuracy',  value: (data.overallAccuracy || 0) + '%', color: data.overallAccuracy >= 70 ? C.lime : data.overallAccuracy >= 50 ? C.orange : C.pink },
    { label: 'Correct',   value: data.totalCorrect || '0', color: C.lime },
    { label: 'Wrong',     value: data.totalWrong || '0', color: C.pink },
  ];
  var boxW = (contentW - 6) / 4;
  statBoxes.forEach(function(box, i) {
    drawStatBox(doc, margin + i*(boxW+2), y, boxW, 20, box, C);
  });
  y += 24;

  // Donut + Trend
  var donutW = 50;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, donutW, 52, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, donutW, 52, 3, 3, 'S');
  doc.addImage(charts.donut, 'JPEG', margin+3, y+4, donutW-6, 42);

  var tx = margin + donutW + 5;
  var tW = contentW - donutW - 5;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(tx, y, tW, 52, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
  doc.roundedRect(tx, y, tW, 52, 3, 3, 'S');
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  doc.text('SESSION TREND', tx+4, y+5);
  doc.addImage(charts.trend, 'JPEG', tx+2, y+7, tW-4, 42);
  y += 56;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, contentW, 52, 3, 3, 'F');
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, 52, 3, 3, 'S');
  doc.addImage(charts.bar, 'JPEG', margin+2, y+2, contentW-4, 48);
  y += 56;

  // Insights (compact)
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...C.violet);
  doc.text('Smart Insights', margin, y); y += 4;

  var insColors = { green: C.lime, blue: C.cyan, orange: C.orange, red: C.pink, neutral: C.muted };
  data.insights.slice(0,3).forEach(function(ins) {
    if (y > pH - 30) return;
    var iColor = insColors[ins.color] || C.cyan;
    drawPanel(doc, margin, y, contentW, 16, C);
    doc.setFillColor(...iColor);
    doc.roundedRect(margin, y, 3, 16, 1, 1, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...C.text);
    var lines = doc.splitTextToSize(ins.text, contentW-12);
    doc.text(lines.slice(0,1), margin+8, y+9);
    y += 19;
  });

  drawFooter(doc, pageNum, totalPages, pH, pW, C);
}

function renderComparisonPage(doc, mathsData, reasonData, C, pW, pH, margin, contentW) {
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, pW, pH, 'F');

  drawGradientBar(doc, 0, 0, pW, 24, C.lime, C.cyan);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...C.bg);
  doc.text('Maths vs Reasoning — Comparison', margin, 15);

  var y = 30;
  var colW = (contentW - 6) / 2;

  // Headers
  var headers = ['Metric', 'Maths', 'Reasoning', 'Winner'];
  var colWidths = [55, 35, 35, 30];
  var colX = [margin, margin+55, margin+90, margin+125];

  drawPanel(doc, margin, y, contentW, 10, C);
  headers.forEach(function(h, i) {
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(h, colX[i]+2, y+7);
  });
  y += 12;

  var rows = [
    { metric: 'Overall Accuracy', mVal: mathsData.overallAccuracy+'%', rVal: reasonData.overallAccuracy+'%', mN: mathsData.overallAccuracy, rN: reasonData.overallAccuracy },
    { metric: 'Total Attempted',  mVal: ''+mathsData.totalAttempts,    rVal: ''+reasonData.totalAttempts,    mN: mathsData.totalAttempts, rN: reasonData.totalAttempts },
    { metric: 'Correct Answers',  mVal: ''+mathsData.totalCorrect,     rVal: ''+reasonData.totalCorrect,     mN: mathsData.totalCorrect, rN: reasonData.totalCorrect },
    { metric: 'Consistency',      mVal: mathsData.consistencyScore+'%', rVal: reasonData.consistencyScore+'%', mN: mathsData.consistencyScore, rN: reasonData.consistencyScore },
    { metric: 'Active Days',      mVal: ''+mathsData.activeDays,       rVal: ''+reasonData.activeDays,       mN: mathsData.activeDays, rN: reasonData.activeDays },
    { metric: 'Avg Time/Q',       mVal: mathsData.avgTimePerQ ? mathsData.avgTimePerQ+'s' : '—', rVal: reasonData.avgTimePerQ ? reasonData.avgTimePerQ+'s' : '—', mN: mathsData.avgTimePerQ || 0, rN: reasonData.avgTimePerQ || 0, lowerBetter: true },
  ];

  rows.forEach(function(row, i) {
    var rowBg = i % 2 === 0 ? C.surface : C.surface2;
    doc.setFillColor(...rowBg);
    doc.rect(margin, y, contentW, 10, 'F');

    var mWins = row.lowerBetter ? (row.mN < row.rN && row.mN > 0) : row.mN > row.rN;
    var rWins = row.lowerBetter ? (row.rN < row.mN && row.rN > 0) : row.rN > row.mN;
    var winner = mWins ? 'Maths' : rWins ? 'Reasoning' : 'Tie';
    var winColor = mWins ? C.violet : rWins ? C.cyan : C.muted;

    doc.setFont('helvetica','normal');  doc.setFontSize(8); doc.setTextColor(...C.text);
    doc.text(row.metric, colX[0]+2, y+7);
    doc.setTextColor(...(mWins ? C.lime : C.text));
    doc.text(row.mVal, colX[1]+2, y+7);
    doc.setTextColor(...(rWins ? C.lime : C.text));
    doc.text(row.rVal, colX[2]+2, y+7);
    doc.setFont('helvetica','bold');
    doc.setTextColor(...winColor);
    doc.text(winner, colX[3]+2, y+7);

    y += 11;
  });

  y += 8;

  // Overall verdict
  var mTotal = mathsData.overallAccuracy + mathsData.consistencyScore;
  var rTotal = reasonData.overallAccuracy + reasonData.consistencyScore;
  var betterSubject = mTotal >= rTotal ? 'Maths' : 'Reasoning';
  var betterColor   = mTotal >= rTotal ? C.violet : C.cyan;

  drawPanel(doc, margin, y, contentW, 28, C);
  doc.setFillColor(...betterColor);
  doc.roundedRect(margin, y, 5, 28, 2, 2, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(11);
  doc.setTextColor(...betterColor);
  doc.text('Overall Stronger Subject: ' + betterSubject, margin + 12, y + 12);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.text);
  var summaryText = betterSubject === 'Maths'
    ? 'You perform better in Maths. Focus on Reasoning to improve overall.'
    : 'You perform better in Reasoning. More Maths practice can balance your performance.';
  doc.text(summaryText, margin + 12, y + 21);

  y += 34;

  // Combined insights
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...C.yellow);
  doc.text('Combined Recommendations', margin, y); y += 5;

  var combinedInsights = [
    mathsData.insights[0],
    reasonData.insights[0],
    mathsData.insights[1] || reasonData.insights[1]
  ].filter(Boolean);

  var insColors = { green: C.lime, blue: C.cyan, orange: C.orange, red: C.pink, neutral: C.muted };
  combinedInsights.forEach(function(ins) {
    if (!ins || y > pH - 30) return;
    var iColor = insColors[ins.color] || C.cyan;
    drawPanel(doc, margin, y, contentW, 18, C);
    doc.setFillColor(...iColor);
    doc.roundedRect(margin, y, 3, 18, 1, 1, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...C.text);
var lines = doc.splitTextToSize(ins.text, contentW-12);    doc.text(lines.slice(0,2), margin+8, y + (lines.length > 1 ? 8 : 11));
    y += 21;
  });

  drawFooter(doc, 3, 4, pH, pW, C);
}

/* ── PDF DRAWING HELPERS ── */

function drawGradientBar(doc, x, y, w, h, colorA, colorB) {
  var steps = 30;
  for (var i = 0; i < steps; i++) {
    var t = i / steps;
    var r = Math.round(colorA[0] + t * (colorB[0] - colorA[0]));
    var g = Math.round(colorA[1] + t * (colorB[1] - colorA[1]));
    var b = Math.round(colorA[2] + t * (colorB[2] - colorA[2]));
    doc.setFillColor(r, g, b);
    doc.rect(x + (i / steps) * w, y, w / steps + 0.5, h, 'F');
  }
}

function drawPanel(doc, x, y, w, h, C) {
  doc.setFillColor(...C.surface);
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 3, 3, 'S');
}

function drawRoundedRect(doc, x, y, w, h, r, fillColor, strokeColor) {
  if (fillColor) { doc.setFillColor(...fillColor); doc.roundedRect(x, y, w, h, r, r, strokeColor ? 'FD' : 'F'); }
  if (strokeColor) { doc.setDrawColor(...strokeColor); doc.roundedRect(x, y, w, h, r, r, 'S'); }
}

function drawStatBox(doc, x, y, w, h, box, C) {
  doc.setFillColor(...C.surface2);
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 3, 3, 'S');

  // Top accent line
  doc.setFillColor(...box.color);
  doc.roundedRect(x, y, w, 2, 1, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...box.color);
  doc.text(String(box.value), x + w/2, y + 12, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.muted);
  doc.text(box.label, x + w/2, y + 18, { align: 'center' });
}

function drawProgressBar(doc, x, y, w, h, pct, fillColor, bgColor) {
  doc.setFillColor(...bgColor);
  doc.roundedRect(x, y, w, h, h/2, h/2, 'F');
  if (pct > 0) {
    doc.setFillColor(...fillColor);
    doc.roundedRect(x, y, Math.max(h, pct * w), h, h/2, h/2, 'F');
  }
}

function drawSectionTitle(doc, title, y, C, margin, contentW) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.violet);
  doc.text(title, margin, y);

  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y + 2, margin + contentW, y + 2);

  return y + 5;
}

function drawFooter(doc, pageNum, totalPages, pH, pW, C) {
  var footerY = pH - 8;
  doc.setFillColor(...C.surface2);
  doc.rect(0, footerY - 3, pW, 11, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text('Generated by Quiz PWA · Adaptive Practice Engine', 12, footerY + 2);
  doc.text('Page ' + pageNum + ' of ' + totalPages, pW - 12, footerY + 2, { align: 'right' });
}
