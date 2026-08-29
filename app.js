'use strict';

/* ── STATE ── */
let state = {
  rawContent: '',
  fileName: '',
  prefix: '',
  processedContent: '',
  bodyNums: [],
  fnNums: [],
  preLinkedBodyNums: new Set(), // nums that already had <a> before we processed
  preLinkedFnNums: new Set(),
  fnTextMap: {},                // num -> footnote text snippet
  changes: [],                  // [{line, before, after}] actual replacements made
  allBodyNums: new Set(),       // every body sup num rendered in Main preview (incl. already-linked)
  allFnNums: new Set(),
  undoStack: [],
  redoStack: [],
};

/* ── DOM REFS ── */
const fileInput1 = document.getElementById('fileInput1');
const pickFile = document.getElementById('pickFile');
const fileBtnText = document.getElementById('fileBtnText');
const fileStatus = document.getElementById('fileStatus');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const prefixInput = document.getElementById('prefixInput');
const btnProcess = document.getElementById('btnProcess');
const progressFill = document.getElementById('progressFill');
const progressWrap = document.getElementById('progressWrap');
const progressPct = document.getElementById('progressPct');
const summaryBar = document.getElementById('summaryBar');
const fileBar = document.getElementById('fileBar');
const btnDownload = document.getElementById('btnDownload');
const btnCopyFile = document.getElementById('btnCopyFile');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeLabel = document.getElementById('themeLabel');

const emptyState1 = document.getElementById('emptyState1');
const workspace1 = document.getElementById('workspace1');
const fileTitleDisplay = document.getElementById('fileTitleDisplay');

const statSupsFound = document.getElementById('statSupsFound');
const statFnFound = document.getElementById('statFnFound');
const statMatched = document.getElementById('statMatched');
const statUnmatched = document.getElementById('statUnmatched');

const bodySupsList = document.getElementById('bodySupsList');
const footnotesList = document.getElementById('footnotesList');

const docPreview = document.getElementById('docPreview');
const innerPaneMain = document.getElementById('innerPaneMain');
const innerPaneSummary = document.getElementById('innerPaneSummary');

const btnCopyChanges = document.getElementById('btnCopyChanges');
const btnDownloadReport = document.getElementById('btnDownloadReport');

const ctxMenu = document.getElementById('ctxMenu');
const ctxDelete = document.getElementById('ctxDelete');
const ctxChange = document.getElementById('ctxChange');

const badgeTooltip = document.getElementById('badgeTooltip');

const changeModal = document.getElementById('changeModal');
const changeModalClose = document.getElementById('changeModalClose');
const changeSearchInput = document.getElementById('changeSearchInput');
const changeFnList = document.getElementById('changeFnList');
const changeModalSel = document.getElementById('changeModalSel');

let contextTarget = null; // { role, num }
let changeTargetNum = null;

const toastStack = document.getElementById('toastStack');

/* ── LUCIDE ICONS ──
   Re-runs after any markup that adds <i data-lucide="..."> nodes. */
function drawIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

/* ── THEME ── */
const html = document.documentElement;
function applyTheme(theme) {
  html.setAttribute('data-theme', theme);
  themeIcon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
  themeLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  drawIcons();
}
applyTheme(localStorage.getItem('epub-theme') === 'dark' ? 'dark' : 'light');

themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('epub-theme', next);
});

/* ── TABS ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.hidden = true);
    document.querySelectorAll('.sidebar-steps').forEach(s => s.hidden = true);
    document.querySelectorAll('.sidebar-foot[data-foot-tab]').forEach(f => f.hidden = true);
    btn.classList.add('active');
    document.getElementById('tabPane' + tab).hidden = false;
    document.querySelector(`.sidebar-steps[data-for-tab="${tab}"]`).hidden = false;
    document.querySelector(`.sidebar-foot[data-foot-tab="${tab}"]`).hidden = false;
  });
});

/* ── INNER TABS (Main / Summary) ── */
function switchInnerTab(tab) {
  document.querySelectorAll('.inner-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.inner-tab-pane').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.inner-tab-btn[data-inner-tab="${tab}"]`);
  const pane = tab === 'main' ? innerPaneMain : innerPaneSummary;
  if (btn) btn.classList.add('active');
  if (pane) pane.classList.add('active');
}
document.querySelectorAll('.inner-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchInnerTab(btn.dataset.innerTab));
});

/* ── FILE UPLOAD (step 1 button — click or drag a file onto it) ── */
pickFile.addEventListener('click', () => fileInput1.click());

['dragenter', 'dragover'].forEach(evt => {
  pickFile.addEventListener(evt, (e) => { e.preventDefault(); pickFile.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(evt => {
  pickFile.addEventListener(evt, (e) => { e.preventDefault(); pickFile.classList.remove('dragover'); });
});
pickFile.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

fileInput1.addEventListener('change', () => {
  const file = fileInput1.files[0];
  if (file) loadFile(file);
});

/* Run stays disabled until step 1 (file) and step 2 (prefix) are both satisfied */
function syncRunButton() {
  const ready = Boolean(state.rawContent) && prefixInput.value.trim() !== '';
  btnProcess.disabled = !ready;
  step2.classList.toggle('done', prefixInput.value.trim() !== '');
}
prefixInput.addEventListener('input', syncRunButton);

function loadFile(file) {
  state.fileName = file.name;

  // Auto-detect prefix from filename
  // e.g. 09_318AR_ch3.xhtml -> ch3
  const base = file.name.replace(/\.[^.]+$/, ''); // strip extension
  const parts = base.split('_');
  const lastPart = parts[parts.length - 1]; // e.g. ch3
  state.prefix = lastPart;
  prefixInput.value = lastPart;

  // Step 1 UI
  pickFile.classList.add('selected');
  fileBtnText.textContent = file.name;
  fileStatus.textContent = 'File loaded';
  fileStatus.classList.add('ok');
  step1.classList.add('done');

  const reader = new FileReader();
  reader.onload = (e) => {
    state.rawContent = e.target.result;
    syncRunButton();

    // Reveal the workspace immediately so the preview is visible before processing
    emptyState1.hidden = true;
    workspace1.hidden = false;
    fileBar.hidden = false;
    fileTitleDisplay.textContent = file.name;

    // Pre-scan so the pre-process preview shows correct badge colours
    const pre = scanPreLinked(state.rawContent);
    state.preLinkedBodyNums = pre.preBody;
    state.preLinkedFnNums = pre.preFn;
    state.fnTextMap = scanFootnoteTexts(state.rawContent);
    state.processedContent = '';
    state.bodyNums = [];
    state.fnNums = [];
    summaryBar.hidden = true;

    renderDocPreview(state.rawContent);
    updateStats();
    switchInnerTab('main');

    toast(`File loaded: ${file.name}`, 'success');
  };
  reader.readAsText(file, 'utf-8');
}

/* ── PROCESS ── */
btnProcess.addEventListener('click', () => {
  const prefix = prefixInput.value.trim();
  if (!prefix) { toast('Please enter or confirm the ID prefix.', 'error'); return; }
  if (!state.rawContent) { toast('No file loaded.', 'error'); return; }

  state.prefix = prefix;
  animateProgress(() => {
    try {
      processFile();
    } catch (err) {
      toast('Error processing file: ' + err.message, 'error');
      console.error(err);
    }
  });
});

/* ── CORE PROCESSING ── */
function processFile() {
  const prefix = state.prefix;
  let content = state.rawContent;

  // Snapshot which sups were already linked BEFORE we touch anything (for badge status + report)
  const pre = scanPreLinked(content);
  state.preLinkedBodyNums = pre.preBody;
  state.preLinkedFnNums = pre.preFn;
  state.fnTextMap = scanFootnoteTexts(content);

  const changes = [];

  // ── STEP 1: Find all body sup numbers (outside footnotes section)
  // We split the doc into body part and footnotes part for safety
  const fnSectionMatch = content.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  const bodyPart = fnSectionMatch ? content.slice(0, content.indexOf(fnSectionMatch[0])) : content;
  const fnPart = fnSectionMatch ? fnSectionMatch[0] : '';
  const fnOffset = fnSectionMatch ? content.indexOf(fnSectionMatch[0]) : content.length;

  // Collect all sup numbers from body
  // Matches: <sup>\n  1  \n</sup>  OR  <sup>4</sup>
  const supRegex = /<sup>([\s\S]*?)<\/sup>/gi;
  const bodyNums = [];
  let m;
  const bodySupMatches = [];
  const tempBodyPart = bodyPart;

  // We need to find sups in body that contain just a number (no existing <a>)
  const supRawRegex = /<sup>([\s\S]*?)<\/sup>/gi;
  while ((m = supRawRegex.exec(tempBodyPart)) !== null) {
    const inner = m[1].trim();
    // Only process if inner is a plain number (no existing anchor)
    if (/^\d+$/.test(inner)) {
      bodyNums.push(inner);
      bodySupMatches.push({ num: inner, full: m[0], index: m.index });
    }
  }

  // Collect all footnote li sup numbers
  const fnNums = [];
  const fnLiRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const fnLiMatches = [];
  while ((m = fnLiRegex.exec(fnPart)) !== null) {
    // Find sup number inside this li
    const liContent = m[1];
    const supInFn = /<sup>([\s\S]*?)<\/sup>/i.exec(liContent);
    if (supInFn) {
      const num = supInFn[1].trim();
      if (/^\d+$/.test(num)) {
        fnNums.push(num);
        fnLiMatches.push({ num, fullLi: m[0], index: m.index });
      }
    }
  }

  state.bodyNums = bodyNums;
  state.fnNums = fnNums;

  // ── STEP 2: Build ID maps
  // Body sup:      id="ch3_xfn1"  href="#ch3_fn1"
  // Footnote sup:  id="ch3_fn1"   href="#ch3_xfn1"  role="doc-backlink"

  // ── STEP 3: Replace body sups
  let newBodyPart = bodyPart;
  // Process in reverse order to preserve indices
  const sortedBodyMatches = [...bodySupMatches].sort((a, b) => b.index - a.index);
  for (const item of sortedBodyMatches) {
    const num = item.num;
    const xfnId = `${prefix}_xfn${num}`;
    const fnId = `${prefix}_fn${num}`;
    const replacement = `<sup>\n<a id="${xfnId}" href="#${fnId}">${num}</a>\n</sup>`;
    newBodyPart = newBodyPart.slice(0, item.index) + replacement + newBodyPart.slice(item.index + item.full.length);
    changes.push({ line: lineNumberAt(content, item.index), before: item.full, after: replacement });
  }

  // ── STEP 4: Replace footnote li sups and add id to li
  let newFnPart = fnPart;
  // Process in reverse order
  const sortedFnMatches = [...fnLiMatches].sort((a, b) => b.index - a.index);
  for (const item of sortedFnMatches) {
    const num = item.num;
    const xfnId = `${prefix}_xfn${num}`;
    const fnId = `${prefix}_fn${num}`;

    let newLi = item.fullLi;

    // Replace inner sup (plain number) with linked sup
    const supMatch = /<sup>([\s\S]*?)<\/sup>/i.exec(item.fullLi);
    const oldSupFull = supMatch[0];
    const newSupFull = `<sup>\n<a role="doc-backlink" id="${fnId}" href="#${xfnId}">${num}</a>\n</sup>`;
    newLi = item.fullLi.replace(oldSupFull, newSupFull);

    newFnPart = newFnPart.slice(0, item.index) + newLi + newFnPart.slice(item.index + item.fullLi.length);
    changes.push({ line: lineNumberAt(content, fnOffset + item.index + supMatch.index), before: oldSupFull, after: newSupFull });
  }

  // ── STEP 5: Reassemble
  state.processedContent = newBodyPart + newFnPart;
  state.changes = changes.sort((a, b) => a.line - b.line);

  // Fresh file -> fresh undo/redo history
  state.undoStack = [];
  state.redoStack = [];

  // ── STEP 6: Update UI
  renderWorkspace();
}

/* ── LINE NUMBER HELPER ── */
function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

/* ── PRE-SCAN: which sups already had an <a> before we processed ── */
function scanPreLinked(content) {
  const fnSectionMatch = content.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  const bodyPart = fnSectionMatch ? content.slice(0, content.indexOf(fnSectionMatch[0])) : content;
  const fnPart = fnSectionMatch ? fnSectionMatch[0] : '';

  const preBody = new Set();
  const preFn = new Set();
  let mm;

  const supRe = /<sup>([\s\S]*?)<\/sup>/gi;
  while ((mm = supRe.exec(bodyPart)) !== null) {
    const inner = mm[1];
    const numMatch = inner.replace(/<[^>]*>/g, '').trim().match(/\d+/);
    if (numMatch && /<a[\s>]/i.test(inner)) preBody.add(numMatch[0]);
  }

  const liRe = /<li[^>]*class="[^"]*fn[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  while ((mm = liRe.exec(fnPart)) !== null) {
    const supIn = /<sup>([\s\S]*?)<\/sup>/i.exec(mm[1]);
    if (!supIn) continue;
    const inner = supIn[1];
    const numMatch = inner.replace(/<[^>]*>/g, '').trim().match(/\d+/);
    if (numMatch && /<a[\s>]/i.test(inner)) preFn.add(numMatch[0]);
  }

  return { preBody, preFn };
}

/* ── FOOTNOTE TEXT MAP (num -> plain text snippet) ── */
function scanFootnoteTexts(content) {
  const fnSectionMatch = content.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  const fnPart = fnSectionMatch ? fnSectionMatch[0] : '';
  const map = {};

  const liRe = /<li[^>]*class="[^"]*fn[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let mm;
  while ((mm = liRe.exec(fnPart)) !== null) {
    const liContent = mm[1];
    const supIn = /<sup>([\s\S]*?)<\/sup>/i.exec(liContent);
    if (!supIn) continue;
    const numMatch = supIn[1].replace(/<[^>]*>/g, '').trim().match(/\d+/);
    if (!numMatch) continue;
    const num = numMatch[0];
    const withoutSup = liContent.replace(/<sup>[\s\S]*?<\/sup>/i, '');
    const text = withoutSup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    map[num] = text;
  }
  return map;
}

/* ── RENDER WORKSPACE ── */
function renderWorkspace() {
  const { fileName } = state;

  // File title
  fileTitleDisplay.textContent = fileName;

  // Show workspace
  emptyState1.hidden = true;
  workspace1.hidden = false;
  fileBar.hidden = false;

  // Stats + summary lists
  renderStatsAndLists();

  // Show the summary bar (stats + Copy / Download)
  summaryBar.hidden = false;

  // Doc preview (Main inner tab)
  renderDocPreview(state.processedContent || state.rawContent);

  // Auto-switch to Main inner tab after processing
  switchInnerTab('main');

  // Toast
  const unmatched = Number(statUnmatched.textContent);
  const matched = Number(statMatched.textContent);
  if (unmatched > 0) {
    toast(`Done! ⚠️ ${unmatched} unmatched sup(s) found.`, 'warning');
  } else {
    toast(`All ${matched} footnotes linked successfully!`, 'success');
  }
}

/* ── STATS BAR ──
   Single source of truth for the 4 stat numbers. Recalculates from state.bodyNums /
   state.fnNums every time it's called, so it always reflects the current state —
   never trust stale counts left over from a previous render. */
function updateStats() {
  const { bodyNums, fnNums } = state;
  const fnSet = new Set(fnNums);
  const bodySet = new Set(bodyNums);

  const matched = bodyNums.filter(n => fnSet.has(n)).length;
  const unmatched = bodyNums.filter(n => !fnSet.has(n)).length + fnNums.filter(n => !bodySet.has(n)).length;

  console.log('bodyNums:', bodyNums);
  console.log('fnNums:', fnNums);
  console.log('matched:', matched);
  console.log('unmatched:', unmatched);

  statSupsFound.textContent = bodyNums.length;
  statFnFound.textContent = fnNums.length;
  statMatched.textContent = matched;
  statUnmatched.textContent = unmatched;

  return { matched, unmatched };
}

/* ── STATS BAR + SUMMARY LISTS ── */
function renderStatsAndLists() {
  const { bodyNums, fnNums, prefix } = state;
  const fnSet = new Set(fnNums);
  const bodySet = new Set(bodyNums);

  updateStats();

  bodySupsList.innerHTML = '';
  bodyNums.forEach(num => {
    const isMatched = fnSet.has(num);
    const xfnId = `${prefix}_xfn${num}`;
    const fnId = `${prefix}_fn${num}`;
    bodySupsList.appendChild(createLinkItem(num, xfnId, `#${fnId}`, isMatched, 'body'));
  });

  footnotesList.innerHTML = '';
  fnNums.forEach(num => {
    const isMatched = bodySet.has(num);
    const xfnId = `${prefix}_xfn${num}`;
    const fnId = `${prefix}_fn${num}`;
    footnotesList.appendChild(createLinkItem(num, fnId, `#${xfnId}`, isMatched, 'fn'));
  });

  renderFn1Sidebar();
}

/* ── TAB 1 RIGHT SIDEBAR: link status per body sup ── */
function renderFn1Sidebar() {
  const sidebarBody = document.getElementById('fn1SidebarBody');
  const sidebarCount = document.getElementById('fn1SidebarCount');
  const sidebarEmpty = document.getElementById('fn1SidebarEmpty');
  if (!sidebarBody || !sidebarCount) return;

  const { bodyNums, fnNums, prefix } = state;
  const fnSet = new Set(fnNums);

  sidebarCount.textContent = bodyNums.length;

  if (!bodyNums.length) {
    sidebarBody.innerHTML = '';
    if (sidebarEmpty) sidebarBody.appendChild(sidebarEmpty);
    else sidebarBody.innerHTML = '<div class="rle-sidebar-empty" id="fn1SidebarEmpty"><i data-lucide="link-2"></i><p>Process file to see link status</p></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const connected = bodyNums.filter(num => fnSet.has(num));
  const missing = bodyNums.filter(num => !fnSet.has(num));

  sidebarBody.innerHTML = '';

  [...connected, ...missing].forEach(num => {
    const isConnected = fnSet.has(num);
    const xfnId = `${prefix}_xfn${num}`;
    const fnId = `${prefix}_fn${num}`;

    const item = document.createElement('div');
    item.className = 'rle-citation-item';

    const badge = document.createElement('span');
    badge.className = 'rle-sidebar-num';
    badge.textContent = num;

    const body = document.createElement('div');
    body.className = 'rle-citation-item-body';

    const status = document.createElement('div');
    status.className = 'rle-citation-author';
    status.textContent = isConnected ? '✓ Connected' : '✗ Missing';
    status.style.color = isConnected ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';

    const idLine = document.createElement('div');
    idLine.className = 'rle-citation-href';
    idLine.textContent = `${xfnId} → #${fnId}`;

    body.appendChild(status);
    body.appendChild(idLine);
    item.appendChild(badge);
    item.appendChild(body);
    sidebarBody.appendChild(item);
  });

  if (window.lucide) lucide.createIcons();
}

/* ── DOC PREVIEW (Main inner tab) ── */
function renderDocPreview(content) {
  if (!content) { docPreview.innerHTML = ''; return; }

  // Extract <body>...</body>, fallback to full content
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let bodyHTML = bodyMatch ? bodyMatch[1] : content;

  // Split into body part / footnotes part, same rule as processFile()
  const fnSectionMatch = bodyHTML.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  let bodyOnly = fnSectionMatch ? bodyHTML.slice(0, bodyHTML.indexOf(fnSectionMatch[0])) : bodyHTML;
  let fnOnly = fnSectionMatch ? fnSectionMatch[0] : '';

  bodyOnly = replaceSupsWithBadges(bodyOnly, 'body');
  fnOnly = replaceSupsWithBadges(fnOnly, 'fn');

  docPreview.innerHTML = bodyOnly + fnOnly;

  // Collect full num sets actually rendered (covers already-linked sups too)
  const bodyBadges = [...docPreview.querySelectorAll('.sup-badge[data-role="body"]')];
  const fnBadges = [...docPreview.querySelectorAll('.sup-badge[data-role="fn"]')];
  const bodyNumSet = new Set(bodyBadges.map(b => b.dataset.num));
  const fnNumSet = new Set(fnBadges.map(b => b.dataset.num));
  state.allBodyNums = bodyNumSet;
  state.allFnNums = fnNumSet;

  function applyStatus(badge, isBody) {
    const num = badge.dataset.num;
    const matched = isBody ? fnNumSet.has(num) : bodyNumSet.has(num);
    const preLinked = isBody ? state.preLinkedBodyNums : state.preLinkedFnNums;
    let status = 'red';
    if (matched) status = preLinked.has(num) ? 'yellow' : 'green';
    badge.classList.add('status-' + status);
  }
  bodyBadges.forEach(b => applyStatus(b, true));
  fnBadges.forEach(b => applyStatus(b, false));

  // Wire up badge interactions
  [...bodyBadges, ...fnBadges].forEach(badge => {
    badge.addEventListener('click', () => {
      const num = badge.dataset.num;
      const role = badge.dataset.role;
      const targetRole = role === 'body' ? 'fn' : 'body';
      const target = docPreview.querySelector(`.sup-badge[data-num="${num}"][data-role="${targetRole}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      blinkBadge(target);
    });
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e, badge);
    });
    badge.addEventListener('mouseenter', (e) => showTooltip(e, badge));
    badge.addEventListener('mouseleave', hideTooltip);
  });
}

let blinkTimer = null;
let blinkingBadge = null;

/* Blue blink on the matching target badge for 2s, then settle back to its own status color.
   A new click cancels whatever badge was still blinking. */
function blinkBadge(el) {
  if (blinkingBadge && blinkingBadge !== el) blinkingBadge.classList.remove('blinking');
  if (blinkTimer) clearTimeout(blinkTimer);

  el.style.setProperty('--original-color', getComputedStyle(el).backgroundColor);
  el.classList.remove('blinking');
  void el.offsetWidth; // restart animation
  el.classList.add('blinking');

  blinkingBadge = el;
  blinkTimer = setTimeout(() => {
    el.classList.remove('blinking');
    blinkingBadge = null;
    blinkTimer = null;
  }, 2000);
}

function flashBadge(el) {
  el.classList.remove('flash');
  void el.offsetWidth; // restart animation
  el.classList.add('flash');
  el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
}

/* Replace <sup>...</sup> occurrences with clickable badge spans.
   A sup with no <a> anchor (e.g. after a Delete) renders as plain text — no badge at all. */
function replaceSupsWithBadges(html, role) {
  return html.replace(/<sup>([\s\S]*?)<\/sup>/gi, (full, inner) => {
    // Strip any tags (e.g. <a id="..." href="...">) to get the visible text only,
    // so digits inside attributes (like a "ch0" prefix) are never mistaken for the number.
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const numMatch = text.match(/\d+/);
    if (!numMatch) return full;
    const num = numMatch[0];

    if (!/<a[\s>]/i.test(inner)) return `<sup>${num}</sup>`; // unlinked -> plain, no badge

    const idMatch = inner.match(/id="([^"]*)"/);
    const hrefMatch = inner.match(/href="([^"]*)"/);
    const idAttr = idMatch ? idMatch[1] : '';
    const hrefAttr = hrefMatch ? hrefMatch[1] : '';
    return `<span class="sup-badge sup-${role}" data-num="${num}" data-role="${role}" data-id="${escapeHtml(idAttr)}" data-href="${escapeHtml(hrefAttr)}">${num}</span>`;
  });
}

/* ── ESCAPE HTML ── */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── CONTEXT MENU ── */
function openContextMenu(e, badge) {
  contextTarget = { role: badge.dataset.role, num: badge.dataset.num };
  ctxChange.hidden = contextTarget.role !== 'body';

  ctxMenu.hidden = false;
  const menuW = ctxMenu.offsetWidth || 150;
  const menuH = ctxMenu.offsetHeight || 80;
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
  ctxMenu.style.left = x + window.scrollX + 'px';
  ctxMenu.style.top = y + window.scrollY + 'px';
}
function closeContextMenu() {
  ctxMenu.hidden = true;
  contextTarget = null;
}
document.addEventListener('click', (e) => {
  if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeContextMenu();
});
/* Esc closes the menu; Delete triggers the delete action while it is open */
document.addEventListener('keydown', (e) => {
  if (ctxMenu.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
  else if (e.key === 'Delete') {
    e.preventDefault();
    if (contextTarget) deleteLink(contextTarget.role, contextTarget.num);
    closeContextMenu();
  }
});
ctxDelete.addEventListener('click', () => {
  if (!contextTarget) return;
  deleteLink(contextTarget.role, contextTarget.num);
  closeContextMenu();
});
ctxChange.addEventListener('click', () => {
  if (!contextTarget) return;
  openChangeModal(contextTarget.num);
  closeContextMenu();
});

/* ── HOVER TOOLTIP ── */
function showTooltip(e, badge) {
  const num = badge.dataset.num;
  const id = badge.dataset.id;
  const href = badge.dataset.href;
  const fnText = (state.fnTextMap[num] || '').slice(0, 80);

  badgeTooltip.innerHTML = `
    <div class="tt-row"><span class="tt-label">id=</span>"${escapeHtml(id)}"</div>
    <div class="tt-row"><span class="tt-label">href=</span>"${escapeHtml(href)}"</div>
    ${fnText ? `<div class="tt-row">${escapeHtml(fnText)}${fnText.length >= 80 ? '…' : ''}</div>` : ''}
  `;
  badgeTooltip.hidden = false;

  // .tip is position:fixed, so these are viewport coordinates — no scroll offset
  const rect = badge.getBoundingClientRect();
  const ttW = badgeTooltip.offsetWidth;
  const ttH = badgeTooltip.offsetHeight;

  let left = rect.left;
  let top = rect.bottom + 6;

  if (left + ttW > window.innerWidth) left = window.innerWidth - ttW - 8;
  if (left < 8) left = 8;
  if (top + ttH > window.innerHeight) top = rect.top - ttH - 6; // flip above

  badgeTooltip.style.left = left + 'px';
  badgeTooltip.style.top = top + 'px';
}
function hideTooltip() {
  badgeTooltip.hidden = true;
}

/* ── DELETE LINK ──
   Severs the two-way link entirely: strips the <a> from BOTH the body sup
   and its matching footnote sup, so both badges disappear (plain text),
   the processed content downloads without that anchor, and stats/summary
   drop the entry from both panels. */
function deleteLink(role, num, recordHistory = true) {
  const beforeSnap = recordHistory ? snapshotState() : null;
  const beforeInfo = recordHistory ? getBadgeInfo(role, num) : null;

  const fnSectionMatch = state.processedContent.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  const fnIdx = fnSectionMatch ? state.processedContent.indexOf(fnSectionMatch[0]) : state.processedContent.length;
  let bodyPart = state.processedContent.slice(0, fnIdx);
  let fnPart = state.processedContent.slice(fnIdx);

  const stripAnchor = (full, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const m = text.match(/\d+/);
    if (m && m[0] === num && /<a[\s>]/i.test(inner)) return `<sup>\n${num}\n</sup>`;
    return full;
  };

  // Strip on both sides — deleting a link removes it for the sup AND its counterpart
  bodyPart = bodyPart.replace(/<sup>([\s\S]*?)<\/sup>/gi, stripAnchor);
  fnPart = fnPart.replace(/<sup>([\s\S]*?)<\/sup>/gi, stripAnchor);

  state.processedContent = bodyPart + fnPart;

  // Drop the entry from both summary panels / stats entirely
  state.bodyNums = state.bodyNums.filter(n => n !== num);
  state.fnNums = state.fnNums.filter(n => n !== num);
  state.preLinkedBodyNums.delete(num);
  state.preLinkedFnNums.delete(num);

  renderDocPreview(state.processedContent);
  renderStatsAndLists();

  if (recordHistory) {
    const afterInfo = { id: '', href: '', color: 'none', footnoteNum: null };
    pushUndoEntry(num, 'delete', beforeSnap, snapshotState(), beforeInfo, afterInfo);
  }
  toast(`Deleted link for sup ${num}.`, 'warning');
}

/* ── CHANGE LINK (reassign which footnote a body sup points to) ── */
function changeLink(num, newFnNum, recordHistory = true) {
  const beforeSnap = recordHistory ? snapshotState() : null;
  const beforeInfo = recordHistory ? getBadgeInfo('body', num) : null;

  const prefix = state.prefix;
  const fnSectionMatch = state.processedContent.match(/<section[^>]*>\s*\r?\n\s*<h[1-6][^>]*>\s*\r?\n\s*<sc>notes<\/sc>[\s\S]*/i);
  const fnIdx = fnSectionMatch ? state.processedContent.indexOf(fnSectionMatch[0]) : state.processedContent.length;
  let bodyPart = state.processedContent.slice(0, fnIdx);
  const fnPart = state.processedContent.slice(fnIdx);

  bodyPart = bodyPart.replace(/<sup>([\s\S]*?)<\/sup>/gi, (full, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const m = text.match(/\d+/);
    if (m && m[0] === num) {
      const xfnId = `${prefix}_xfn${num}`;
      const fnId = `${prefix}_fn${newFnNum}`;
      return `<sup>\n<a id="${xfnId}" href="#${fnId}">${num}</a>\n</sup>`;
    }
    return full;
  });

  state.processedContent = bodyPart + fnPart;
  renderDocPreview(state.processedContent);

  if (recordHistory) {
    const afterInfo = getBadgeInfo('body', num);
    pushUndoEntry(num, 'change', beforeSnap, snapshotState(), beforeInfo, afterInfo);
  }
  toast(`Sup ${num} now links to footnote ${newFnNum}.`, 'success');
}

/* ── UNDO / REDO ── */

function snapshotState() {
  return {
    processedContent: state.processedContent,
    bodyNums: [...state.bodyNums],
    fnNums: [...state.fnNums],
    preLinkedBodyNums: [...state.preLinkedBodyNums],
    preLinkedFnNums: [...state.preLinkedFnNums],
  };
}

function applySnapshot(snap) {
  state.processedContent = snap.processedContent;
  state.bodyNums = [...snap.bodyNums];
  state.fnNums = [...snap.fnNums];
  state.preLinkedBodyNums = new Set(snap.preLinkedBodyNums);
  state.preLinkedFnNums = new Set(snap.preLinkedFnNums);
  renderDocPreview(state.processedContent);
  renderStatsAndLists();
}

/* Read a badge's current id/href/status color/footnote number straight from the DOM */
function getBadgeInfo(role, num) {
  const badge = docPreview.querySelector(`.sup-badge[data-num="${num}"][data-role="${role}"]`);
  if (!badge) return { id: '', href: '', color: 'none', footnoteNum: null };
  const color = ['green', 'yellow', 'red'].find(c => badge.classList.contains('status-' + c)) || 'none';
  const hrefMatch = (badge.dataset.href || '').match(/\d+/);
  return {
    id: badge.dataset.id || '',
    href: badge.dataset.href || '',
    color,
    footnoteNum: hrefMatch ? hrefMatch[0] : null,
  };
}

function pushUndoEntry(supNum, action, beforeSnap, afterSnap, beforeState, afterState) {
  state.undoStack.push({ supNum, action, beforeState, afterState, _before: beforeSnap, _after: afterSnap });
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = []; // any new action invalidates the redo history
}

function undoLastAction() {
  if (!state.undoStack.length) { toast('Nothing to undo', 'warning'); return; }
  const entry = state.undoStack.pop();
  applySnapshot(entry._before);
  state.redoStack.push(entry);
  if (state.redoStack.length > 50) state.redoStack.shift();
  toast(`Undone — Sup ${entry.supNum} restored`, 'success');
}

function redoLastAction() {
  if (!state.redoStack.length) { toast('Nothing to redo', 'warning'); return; }
  const entry = state.redoStack.pop();
  applySnapshot(entry._after);
  state.undoStack.push(entry);
  toast(`Redone — Sup ${entry.supNum} re-linked`, 'success');
}

/* ── KEYBOARD SHORTCUTS (Ctrl+Z undo, Ctrl+Y redo) ── */
document.addEventListener('keydown', (e) => {
  const tab1Active = document.getElementById('tabPane1').classList.contains('active');
  if (!tab1Active) return;
  if (!e.ctrlKey) return;

  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    undoLastAction();
  } else if (key === 'y') {
    e.preventDefault();
    redoLastAction();
  }
});

/* ── CHANGE MODAL ── */
function openChangeModal(num) {
  changeTargetNum = num;
  changeSearchInput.value = '';
  renderChangeList('');
  changeModalSel.textContent = `Sup ${num} → pick a footnote`;
  changeModal.hidden = false;
  changeSearchInput.focus();
}
function closeChangeModal() {
  changeModal.hidden = true;
  changeTargetNum = null;
}
function renderChangeList(filter) {
  changeFnList.innerHTML = '';
  const f = filter.trim().toLowerCase();
  const nums = Object.keys(state.fnTextMap).sort((a, b) => Number(a) - Number(b));
  nums
    .filter(n => !f || n.includes(f) || (state.fnTextMap[n] || '').toLowerCase().includes(f))
    .forEach(n => {
      const item = document.createElement('div');
      item.className = 'fn-option';
      const snippet = (state.fnTextMap[n] || '').slice(0, 60);
      item.innerHTML = `<span class="fn-option-num">${escapeHtml(n)}</span><span class="fn-option-text">${escapeHtml(snippet)}</span>`;
      item.addEventListener('click', () => {
        changeLink(changeTargetNum, n);
        closeChangeModal();
      });
      changeFnList.appendChild(item);
    });
  const first = changeFnList.firstElementChild;
  if (first) first.classList.add('active');
}
changeSearchInput.addEventListener('input', () => renderChangeList(changeSearchInput.value));
changeModalClose.addEventListener('click', closeChangeModal);
changeModal.addEventListener('click', (e) => {
  if (e.target === changeModal) closeChangeModal();
});

/* Arrow keys move the highlighted option, Enter picks it, Esc closes */
changeModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeChangeModal(); return; }

  const options = [...changeFnList.querySelectorAll('.fn-option')];
  if (!options.length) return;
  let idx = options.findIndex(o => o.classList.contains('active'));

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    idx = e.key === 'ArrowDown'
      ? (idx + 1 + options.length) % options.length
      : (idx - 1 + options.length) % options.length;
    options.forEach(o => o.classList.remove('active'));
    options[idx].classList.add('active');
    options[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    (options[idx] || options[0]).click();
  }
});

/* ── COPY CHANGES ── */
btnCopyChanges.addEventListener('click', () => {
  if (!state.changes.length) { toast('No changes to copy.', 'warning'); return; }
  const text = state.changes
    .map(c => `LINE ${c.line} (BEFORE): ${c.before.replace(/\n/g, '\\n')}\nLINE ${c.line} (AFTER):  ${c.after.replace(/\n/g, '\\n')}`)
    .join('\n\n---\n\n');
  navigator.clipboard.writeText(text)
    .then(() => toast('Changes copied to clipboard!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});

/* ── DOWNLOAD REPORT (CSV) ── */
btnDownloadReport.addEventListener('click', () => {
  if (!state.processedContent) { toast('Nothing to report yet.', 'error'); return; }
  const prefix = state.prefix;
  const allNums = Array.from(new Set([...state.allBodyNums, ...state.allFnNums])).sort((a, b) => Number(a) - Number(b));

  const rows = [['Sup Number', 'Body ID', 'Body Href', 'Footnote ID', 'Footnote Href', 'Status', 'Already Linked']];
  allNums.forEach(num => {
    const bodyPresent = state.allBodyNums.has(num);
    const fnPresent = state.allFnNums.has(num);
    const bodyId = bodyPresent ? `${prefix}_xfn${num}` : '';
    const bodyHref = bodyPresent ? `#${prefix}_fn${num}` : '';
    const fnId = fnPresent ? `${prefix}_fn${num}` : '';
    const fnHref = fnPresent ? `#${prefix}_xfn${num}` : '';
    const status = (bodyPresent && fnPresent) ? 'Matched' : 'Unmatched';
    const alreadyLinked = (state.preLinkedBodyNums.has(num) || state.preLinkedFnNums.has(num)) ? 'Yes' : 'No';
    rows.push([num, bodyId, bodyHref, fnId, fnHref, status, alreadyLinked]);
  });

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const base = state.fileName.replace(/\.[^.]+$/, '') || 'report';
  a.download = `${base}_report.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Report downloaded!', 'success');
});

/* ── CREATE LINK ITEM ── */
function createLinkItem(num, id, href, isMatched, type) {
  const div = document.createElement('div');
  div.className = `link-item ${isMatched ? 'matched' : 'unmatched'}`;

  const numEl = document.createElement('div');
  numEl.className = 'link-num';
  numEl.textContent = num;

  const info = document.createElement('div');
  info.className = 'link-info';

  const idEl = document.createElement('div');
  idEl.className = 'link-id';
  idEl.textContent = `id="${id}"`;

  const hrefEl = document.createElement('div');
  hrefEl.className = 'link-href';
  if (type === 'fn') {
    hrefEl.textContent = `role="doc-backlink" → ${href}`;
  } else {
    hrefEl.textContent = `href="${href}"`;
  }

  info.appendChild(idEl);
  info.appendChild(hrefEl);

  const status = document.createElement('div');
  status.className = `link-status ${isMatched ? 'status-ok' : 'status-fail'}`;
  status.textContent = isMatched ? '✓ OK' : '✗ Missing';

  div.appendChild(numEl);
  div.appendChild(info);
  div.appendChild(status);

  div.title = 'Jump to this anchor in the preview';
  div.addEventListener('click', () => jumpToBadge(type, num));

  return div;
}

/* ── SUMMARY ROW -> PREVIEW JUMP ── */
function jumpToBadge(role, num) {
  switchInnerTab('main');
  const badge = docPreview.querySelector(`.sup-badge[data-num="${num}"][data-role="${role}"]`);
  if (!badge) { toast(`No anchor rendered for sup ${num}.`, 'warning'); return; }
  badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
  anchorFlash(badge);
}

/* Brief yellow flash that fades back to the badge's own status colour */
function anchorFlash(el) {
  el.style.setProperty('--original-color', getComputedStyle(el).backgroundColor);
  el.classList.remove('anchor-flash');
  void el.offsetWidth; // restart animation
  el.classList.add('anchor-flash');
  el.addEventListener('animationend', () => el.classList.remove('anchor-flash'), { once: true });
}

/* ── DOWNLOAD ── */
btnDownload.addEventListener('click', () => {
  if (!state.processedContent) { toast('Nothing to download yet.', 'error'); return; }

  const blob = new Blob([state.processedContent], { type: 'application/xhtml+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.fileName.replace(/(\.[^.]+)$/, '_linked$1');
  a.click();
  URL.revokeObjectURL(url);
  toast('File downloaded!', 'success');
});

/* ── COPY FILE CONTENT ── */
btnCopyFile.addEventListener('click', () => {
  if (!state.processedContent) { toast('Nothing to copy yet.', 'error'); return; }

  // Only swap the label span — the lucide icon node must survive
  const label = btnCopyFile.querySelector('span');
  const originalLabel = label.textContent;
  label.textContent = 'Copying…';
  btnCopyFile.disabled = true;

  navigator.clipboard.writeText(state.processedContent)
    .then(() => toast('File content copied to clipboard!', 'success'))
    .catch(() => toast('Copy failed. Try downloading instead.', 'error'))
    .finally(() => {
      setTimeout(() => {
        label.textContent = originalLabel;
        btnCopyFile.disabled = false;
      }, 1000);
    });
});

/* ── PROGRESS ANIMATION ── */
function animateProgress(callback) {
  const setPct = (p) => {
    progressFill.style.width = p + '%';
    progressPct.textContent = Math.round(p) + '%';
  };

  setPct(0);
  progressWrap.hidden = false;
  btnProcess.disabled = true;

  let pct = 0;
  const iv = setInterval(() => {
    pct += Math.random() * 25;
    if (pct >= 90) { clearInterval(iv); pct = 90; }
    setPct(pct);
  }, 80);

  setTimeout(() => {
    clearInterval(iv);
    setPct(100);
    callback();
    setTimeout(() => {
      progressWrap.hidden = true;
      setPct(0);
      btnProcess.disabled = false;
    }, 600);
  }, 500);
}

/* ── TOAST ── */
const TOAST_ICONS = { success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle' };

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="t-icon" data-lucide="${TOAST_ICONS[type] || 'info'}"></i>` +
    `<span class="t-msg"></span>`;
  el.querySelector('.t-msg').textContent = msg;
  toastStack.appendChild(el);
  drawIcons();

  // Keep at most 3 stacked — drop the oldest
  while (toastStack.children.length > 3) toastStack.firstElementChild.remove();

  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, 4000);
}

/* ── BOOT ── */
drawIcons();
