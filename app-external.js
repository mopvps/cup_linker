'use strict';

/* ── STATE ── */
let extState = {
  extFileName: '',
  extRawContent: '',
  extPrefix: '',
  extSections: [],
  selectedSection: null,
  bodyFileName: '',
  bodyRawContent: '',
  bodyNums: [],
  isFlatList: false,
  processedBody: '',
  processedExt: '',
};

/* ── DOM REFS ── */
const pickExtFile      = document.getElementById('pickExtFile');
const extFileInput     = document.getElementById('extFileInput');
const extFileBtnText   = document.getElementById('extFileBtnText');
const extFileStatus    = document.getElementById('extFileStatus');
const extFileCheck     = document.getElementById('extFileCheck');
const extStep1         = document.getElementById('extStep1');

const extStep2         = document.getElementById('extStep2');
const extSectionSelect = document.getElementById('extSectionSelect');
const extSectionStatus = document.getElementById('extSectionStatus');
const extSectionCheck  = document.getElementById('extSectionCheck');

const extPrefixStep    = document.getElementById('extPrefixStep');
const extPrefixInput   = document.getElementById('extPrefixInput');
const extPrefixStatus  = document.getElementById('extPrefixStatus');
const extPrefixCheck   = document.getElementById('extPrefixCheck');
const btnConfirmPrefix = document.getElementById('btnConfirmPrefix');

const extStep3         = document.getElementById('extStep3');
const pickBodyFile     = document.getElementById('pickBodyFile');
const bodyFileInput    = document.getElementById('bodyFileInput');
const bodyFileBtnText  = document.getElementById('bodyFileBtnText');
const bodyFileStatus   = document.getElementById('bodyFileStatus');
const bodyFileCheck    = document.getElementById('extBodyCheck');

const btnProcessExt    = document.getElementById('btnProcessExt');

/* ══════════════════════════════════════
   STEP 1 — Upload Footnote File
══════════════════════════════════════ */
pickExtFile.addEventListener('click', () => extFileInput.click());

extFileInput.addEventListener('change', () => {
  const file = extFileInput.files[0];
  if (!file) return;

  extState.extFileName = file.name;
  extFileBtnText.textContent = file.name;
  extFileStatus.textContent  = 'Reading file...';

  const reader = new FileReader();
  reader.onload = (e) => {
    extState.extRawContent = e.target.result;

    // Scan sections from heading structure (no prefix needed yet)
    const result = scanSectionsFromHeadings(extState.extRawContent);
    extState.extSections = result.sections;
    extState.isFlatList  = result.isFlatList;

    extFileStatus.textContent = 'File loaded';
    extFileStatus.classList.add('ok');
    extFileCheck.style.opacity = '1';
    extStep1.classList.add('done');
    pickExtFile.classList.add('selected');

    // Populate section dropdown and show step 2
    populateSectionDropdown(result);
    extStep2.hidden = false;

    toast(`Footnote file loaded: ${file.name}`, 'success');
  };
  reader.readAsText(file, 'utf-8');
});

/* ══════════════════════════════════════
   SECTION SCANNER — no prefix required
   Detects sections by any heading with an id ending in a number
══════════════════════════════════════ */
function scanSectionsFromHeadings(content) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(content, 'application/xhtml+xml');

  const sectionHeadings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(el => {
      const id = el.getAttribute('id');
      return id && /\d+$/.test(id);
    })
    .sort((a, b) => {
      const nA = parseInt(a.getAttribute('id').match(/(\d+)$/)[1], 10);
      const nB = parseInt(b.getAttribute('id').match(/(\d+)$/)[1], 10);
      return nA - nB;
    });

  // FLAT LIST — no section headings found
  if (!sectionHeadings.length) {
    const items = extractListItems(doc.body);
    return {
      isFlatList: true,
      sections: [{ label: 'All Footnotes', id: 'flat', items }]
    };
  }

  // SECTIONED
  const sections = sectionHeadings.map((heading, idx) => {
    const label       = heading.textContent.trim();
    const id          = heading.getAttribute('id');
    const nextHeading = sectionHeadings[idx + 1] || null;
    const items       = [];
    let el = heading.nextElementSibling;

    while (el) {
      if (nextHeading && el === nextHeading) break;
      if (['H1','H2','H3','H4','H5','H6'].includes(el.tagName)) {
        const elId = el.getAttribute('id');
        if (elId && /\d+$/.test(elId)) break;
      }
      if (el.tagName === 'OL' || el.tagName === 'UL') {
        [...el.querySelectorAll('li')].forEach(li => {
          const parsed = parseListItem(li);
          if (parsed) items.push(parsed);
        });
      } else if (el.querySelectorAll) {
        [...el.querySelectorAll('li')].forEach(li => {
          const parsed = parseListItem(li);
          if (parsed) items.push(parsed);
        });
      }
      el = el.nextElementSibling;
    }

    return { label, id, items };
  });

  return { isFlatList: false, sections };
}

function extractListItems(body) {
  return [...body.querySelectorAll('li')]
    .map(parseListItem)
    .filter(Boolean);
}

function parseListItem(li) {
  const clone = li.cloneNode(true);
  const pagebreaks = clone.querySelectorAll
    ? [...clone.querySelectorAll('[epub\\:type="pagebreak"],[role="doc-pagebreak"]')]
    : [];
  pagebreaks.forEach(el => el.parentNode.removeChild(el));
  const raw   = clone.textContent.trim();
  const match = raw.match(/^(\d+)[.\s]*/);
  if (!match) return null;
  const num  = match[1];
  const text = raw.replace(/^\d+[.\s]*/, '').trim();
  return { num, text, el: li };
}

/* ══════════════════════════════════════
   STEP 2 — Select Section
══════════════════════════════════════ */
function populateSectionDropdown(result) {
  extSectionSelect.innerHTML = '<option value="">-- Select section --</option>';
  if (result.isFlatList) {
    extSectionStatus.textContent = 'Flat list detected — no sections found';
    const opt = document.createElement('option');
    opt.value = 'flat';
    opt.textContent = `All Footnotes (${result.sections[0].items.length} items)`;
    extSectionSelect.appendChild(opt);
  } else {
    extSectionStatus.textContent = `${result.sections.length} section(s) detected`;
    result.sections.forEach((sec, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${sec.label} (${sec.items.length} footnotes)`;
      extSectionSelect.appendChild(opt);
    });
  }
}

extSectionSelect.addEventListener('change', () => {
  const val = extSectionSelect.value;
  if (val === '') return;

  const idx = val === 'flat' ? 0 : Number(val);
  extState.selectedSection = extState.extSections[idx];
  extSectionCheck.style.opacity = '1';
  extStep2.classList.add('done');

  // Auto-detect prefix from selected section heading id
  const sectionId   = extState.selectedSection.id;
  const detected    = sectionId !== 'flat' ? detectIdPrefix(extState.extRawContent) : '';
  extState.extPrefix    = detected;
  extPrefixInput.value  = detected;
  extPrefixStatus.textContent = detected
    ? `Detected: "${detected}" — edit if wrong.`
    : 'Could not auto-detect — enter prefix manually.';

  // Show step 3 (prefix)
  extPrefixStep.hidden = false;

  toast(`Section selected: ${extState.selectedSection.label}`, 'success');
});

/* ══════════════════════════════════════
   STEP 3 — Verify Prefix
══════════════════════════════════════ */
function detectIdPrefix(content) {
  const parser   = new DOMParser();
  const doc      = parser.parseFromString(content, 'application/xhtml+xml');
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const ids = headings
    .map(h => h.getAttribute('id'))
    .filter(Boolean)
    .filter(id => /\d+$/.test(id));
  if (!ids.length) return '';
  const candidate = ids[0].replace(/\d+$/, '');
  if (!candidate) return '';
  const matches = ids.filter(id => id.startsWith(candidate) && /\d+$/.test(id));
  if (matches.length < 2) return '';
  return candidate;
}

btnConfirmPrefix.addEventListener('click', () => {
  const prefix = extPrefixInput.value.trim();
  if (!prefix) { toast('Please enter an ID prefix.', 'error'); return; }

  extState.extPrefix = prefix;
  extPrefixCheck.style.opacity = '1';
  extPrefixStep.classList.add('done');

  // Show step 4 (chapter file)
  extStep3.hidden = false;

  toast(`Prefix confirmed: "${prefix}"`, 'success');
});

/* ══════════════════════════════════════
   STEP 4 — Upload Chapter File
══════════════════════════════════════ */
pickBodyFile.addEventListener('click', () => bodyFileInput.click());

bodyFileInput.addEventListener('change', () => {
  const file = bodyFileInput.files[0];
  if (!file) return;

  extState.bodyFileName = file.name;
  bodyFileBtnText.textContent = file.name;
  bodyFileStatus.textContent  = 'Reading file...';

  const reader = new FileReader();
  reader.onload = (e) => {
    extState.bodyRawContent = e.target.result;
    const nums = scanBodySups(extState.bodyRawContent);
    extState.bodyNums = nums;

    bodyFileStatus.textContent = `${nums.length} superscript(s) found`;
    bodyFileStatus.classList.add('ok');
    bodyFileCheck.style.opacity = '1';
    extStep3.classList.add('done');
    pickBodyFile.classList.add('selected');

    renderChapterPreview(extState.bodyRawContent);
    syncExtProcessButton();

    toast(`Chapter file loaded: ${file.name} — ${nums.length} sups found`, 'success');
  };
  reader.readAsText(file, 'utf-8');
});

function scanBodySups(content) {
  const nums = [];
  const re = /<sup>([\s\S]*?)<\/sup>/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const inner = m[1].trim();
    if (/^\d+\.?$/.test(inner)) {
      nums.push(inner.replace('.', ''));
    } else {
      // Already-linked: <a ...>NUMBER</a>
      const aMatch = inner.match(/^<a[^>]*>(\d+\.?)<\/a>$/i);
      if (aMatch) nums.push(aMatch[1].replace('.', ''));
    }
  }
  return nums;
}

function renderChapterPreview(content) {
  const empty     = document.getElementById('extEmptyState');
  const workspace = document.getElementById('extWorkspace');
  const preview   = document.getElementById('extDocPreview');
  if (empty) empty.hidden = true;
  if (workspace) workspace.hidden = false;
  const parser = new DOMParser();
  const doc  = parser.parseFromString(content, 'application/xhtml+xml');
  const body = doc.querySelector('body');
  if (preview && body) preview.innerHTML = body.innerHTML;

  // Badge bare and already-linked <sup>NUMBER</sup>
  preview.querySelectorAll('sup').forEach(sup => {
    const txt = sup.textContent.trim();
    if (!/^\d+\.?$/.test(txt)) return;
    sup.classList.add('sup-badge', 'status-pending');
    sup.setAttribute('data-sup', txt);
  });
}

function syncExtProcessButton() {
  btnProcessExt.disabled = !(extState.bodyRawContent && extState.selectedSection && extState.extPrefix);
}

/* ══════════════════════════════════════
   PROCESS
══════════════════════════════════════ */
function checkExistingIds(section) {
  const items = section.items;
  if (!items || !items.length) return 0;

  // Get section content
  let secContent;
  if (section.id === 'flat') {
    secContent = extState.extRawContent;
  } else {
    const secAnchor = `id="${section.id}"`;
    const secStart  = extState.extRawContent.indexOf(secAnchor);
    if (secStart === -1) return 0;
    const openTagEnd = extState.extRawContent.indexOf('>', secStart) + 1;
    const afterSec   = extState.extRawContent.indexOf('<section', openTagEnd);
    const secEnd     = afterSec !== -1 ? afterSec : extState.extRawContent.length;
    secContent = extState.extRawContent.substring(openTagEnd, secEnd);
  }

  // Detect already-linked lis: <li> contains an <a href="...#..."> backlink
  const linkedLiRegex = /<li[^>]*>[\s\S]*?<a\s[^>]*href="[^"]*#[^"]*"[^>]*>/gi;
  const matches = secContent.match(linkedLiRegex);
  return matches ? matches.length : 0;
}

btnProcessExt.addEventListener('click', () => {
  if (!extState.bodyRawContent)  { toast('No chapter file loaded.', 'error'); return; }
  if (!extState.selectedSection) { toast('No section selected.', 'error'); return; }
  if (!extState.extRawContent)   { toast('No footnote file loaded.', 'error'); return; }

  const existingCount = checkExistingIds(extState.selectedSection);
  if (existingCount > 0) {
    const msg = document.getElementById('extIdWarnMsg');
    if (msg) msg.textContent = `${existingCount} footnote(s) in this section already have IDs.`;
    document.getElementById('extIdWarnModal').hidden = false;
    if (window.lucide) lucide.createIcons();
    return;
  }

  try { processExternalLinks(); }
  catch(err) { toast('Error: ' + err.message, 'error'); console.error(err); }
});

document.getElementById('extIdWarnReplace').addEventListener('click', () => {
  document.getElementById('extIdWarnModal').hidden = true;

  // Strip ids only within the selected section bounds
  const sectionId = extState.selectedSection.id;
  if (sectionId === 'flat') {
    // Flat list — strip across entire file
    let raw = extState.extRawContent;
    raw = raw.replace(/(<li)\s+id="[^"]*"([^>]*>)/gi, '$1$2');
    raw = raw.replace(/(<li[^>]*>)\s*<a[^>]*>(\d+\.?)\s*<\/a>\s*/gi, '$1$2 ');
    extState.extRawContent = raw;
  } else {
    const secAnchor  = `id="${sectionId}"`;
    const secStart   = extState.extRawContent.indexOf(secAnchor);
    if (secStart !== -1) {
      const openTagEnd = extState.extRawContent.indexOf('>', secStart) + 1;
      const afterSec   = extState.extRawContent.indexOf('<section', openTagEnd);
      const secEnd     = afterSec !== -1 ? afterSec : extState.extRawContent.length;
      const before     = extState.extRawContent.substring(0, openTagEnd);
      let   secContent = extState.extRawContent.substring(openTagEnd, secEnd);
      const after      = extState.extRawContent.substring(secEnd);
      secContent = secContent.replace(/(<li)\s+id="[^"]*"([^>]*>)/gi, '$1$2');
      secContent = secContent.replace(/(<li[^>]*>)\s*<a[^>]*>(\d+\.?)\s*<\/a>\s*/gi, '$1$2 ');
      extState.extRawContent = before + secContent + after;
    }
  }

  try { processExternalLinks(); }
  catch(err) { toast('Error: ' + err.message, 'error'); console.error(err); }
});

document.getElementById('extIdWarnCancel').addEventListener('click', () => {
  document.getElementById('extIdWarnModal').hidden = true;
});
document.getElementById('extIdWarnClose').addEventListener('click', () => {
  document.getElementById('extIdWarnModal').hidden = true;
});

function processExternalLinks() {
  const prefix   = extState.extPrefix;
  const section  = extState.selectedSection;
  const bodyFile = extState.bodyFileName;
  const extFile  = extState.extFileName;

  const fnMap = {};
  section.items.forEach(item => { fnMap[item.num] = item; });

  let newBody = extState.bodyRawContent;
  let newExt  = extState.extRawContent;
  const changes = [];

  // STEP A: Replace body sups — handles bare <sup>1</sup> and already-linked <sup><a>1</a></sup>
  newBody = newBody.replace(/<sup>([\s\S]*?)<\/sup>/gi, (full, inner) => {
    const trimmed = inner.trim();
    // Bare number
    if (/^\d+\.?$/.test(trimmed)) {
      const num = trimmed.replace('.', '');
      if (!fnMap[num]) return full;
      const padded = num.padStart(3, '0');
      const fnId   = `${prefix}-${padded}`;
      const bodyId = `${fnId}-fn`;
      changes.push({ num, bodyId, fnId });
      return `<sup><a class="xref" href="${extFile}#${fnId}" id="${bodyId}">${trimmed}</a></sup>`;
    }
    // Already-linked: <a ...>NUMBER</a>
    const aMatch = trimmed.match(/^<a[^>]*>(\d+\.?)<\/a>$/i);
    if (aMatch) {
      const num = aMatch[1].replace('.', '');
      if (!fnMap[num]) return full;
      const padded = num.padStart(3, '0');
      const fnId   = `${prefix}-${padded}`;
      const bodyId = `${fnId}-fn`;
      changes.push({ num, bodyId, fnId });
      return `<sup><a class="xref" href="${extFile}#${fnId}" id="${bodyId}">${aMatch[1]}</a></sup>`;
    }
    return full;
  });

  // STEP B: Inject id into matching <li> — scoped to selected section only
  // Find section bounds in raw file to avoid matching lis in other sections
  const sectionId  = extState.selectedSection.id;
  const secAnchor  = `id="${sectionId}"`;
  const secStart   = newExt.indexOf(secAnchor);

  if (secStart === -1) {
    toast('Could not locate section in footnote file.', 'error');
    return;
  }

  // Find where next section starts (next <section or next heading with id= after secStart)
  const afterSec   = newExt.indexOf('<section', secStart + secAnchor.length);
  const secEnd     = afterSec !== -1 ? afterSec : newExt.length;

  // Split file into: before section, section content, after section
  let beforeSec  = newExt.substring(0, secStart);
  let secContent = newExt.substring(secStart, secEnd);
  let afterSecStr= newExt.substring(secEnd);

  // Run replacements only within secContent
  changes.forEach(({ num, bodyId, fnId }) => {
    const padded = num.padStart(3, '0');
    const id     = `${prefix}-${padded}`;
    // First try: match li WITHOUT existing id
    const liRegex = new RegExp(
      `(<li)(?![^>]*\\sid=)([^>]*>)` +
      `((?:<span[^/]*/\\s*>|<span[^>]*></span>)*)` +
      `(\\s*${num}[.\\s])`,
      'i'
    );
    // Second try: match li WITH existing id (replace it)
    const liRegexExisting = new RegExp(
      `(<li)([^>]*\\sid="[^"]*")([^>]*>)` +
      `((?:<span[^/]*/\\s*>|<span[^>]*></span>)*)` +
      `(<a[^>]*>\\s*${num}[^<]*<\\/a>\\s*)`,
      'i'
    );

    // Third try: li has no id but already has backlink anchor (already-linked structure)
    const liRegexLinked = new RegExp(
      `(<li)(?![^>]*\\sid=)([^>]*>)` +
      `(<a[^>]*>\\s*${num}[^<]*<\\/a>\\s*)`,
      'i'
    );

    if (liRegex.test(secContent)) {
      secContent = secContent.replace(liRegex, (full, tag, attrs, spans, numText) => {
        const origNum = numText.trim();
        return `${tag} id="${id}"${attrs}${spans}<a href="${bodyFile}#${bodyId}">${origNum}</a> `;
      });
    } else if (liRegexExisting.test(secContent)) {
      // li already has id — replace id and update backlink href
      secContent = secContent.replace(liRegexExisting, (full, tag, existingId, attrs, spans, oldAnchor) => {
        return `${tag} id="${id}"${attrs}${spans}<a href="${bodyFile}#${bodyId}">${num}</a> `;
      });
    } else if (liRegexLinked.test(secContent)) {
      // li has no id but already has anchor — inject id and update href
      secContent = secContent.replace(liRegexLinked, (full, tag, attrs, oldAnchor) => {
        return `${tag} id="${id}"${attrs}<a href="${bodyFile}#${bodyId}">${num}</a> `;
      });
    }
  });

  // Stitch back
  newExt = beforeSec + secContent + afterSecStr;

  extState.processedBody   = newBody;
  extState.processedExt    = newExt;
  extState.bodyRawContent  = newBody;
  extState.extRawContent   = newExt;

  // Show copy buttons
  const copyBtns = document.getElementById('extCopyBtns');
  if (copyBtns) copyBtns.hidden = false;

  // Populate right sidebar
  const sidebarBody  = document.getElementById('extSidebarBody');
  const sidebarCount = document.getElementById('extSidebarCount');
  const sidebarEmpty = document.getElementById('extSidebarEmpty');
  if (sidebarEmpty) sidebarEmpty.hidden = true;
  if (sidebarCount) sidebarCount.textContent = extState.bodyNums.length;

  if (sidebarBody) {
    sidebarBody.innerHTML = '';
    const linkedNums = new Set(changes.map(c => c.num));
    const preview    = document.getElementById('extDocPreview');

    // Update sup badges in preview
    if (preview) {
      preview.querySelectorAll('sup[data-sup]').forEach(sup => {
        const n = sup.getAttribute('data-sup');
        sup.classList.remove('status-pending');
        sup.classList.add(linkedNums.has(n) ? 'status-green' : 'status-red');
      });
    }

    // Build sidebar items
    extState.bodyNums.forEach(num => {
      const ok   = linkedNums.has(num);
      const item = document.createElement('div');
      item.className = `link-item ${ok ? 'matched' : 'unmatched'}`;
      item.setAttribute('data-sidebar-num', num);
      item.innerHTML = `
        <div class="link-num">${num}</div>
        <div class="link-info">
          <div class="link-id">Sup ${num}</div>
          <div class="link-href">${ok ? 'Linked ✓' : 'No match'}</div>
        </div>
        <span class="link-status ${ok ? 'status-ok' : 'status-fail'}">${ok ? 'OK' : 'Fail'}</span>
      `;

      // RIGHT → MIDDLE
      item.addEventListener('click', () => {
        if (!preview) return;
        const target = preview.querySelector(`sup[data-sup="${num}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('ext-highlight');
          setTimeout(() => target.classList.remove('ext-highlight'), 1500);
        }
        sidebarBody.querySelectorAll('.link-item').forEach(el => el.classList.remove('ext-active'));
        item.classList.add('ext-active');
      });

      sidebarBody.appendChild(item);
    });

    // MIDDLE → RIGHT
    if (preview) {
      preview.querySelectorAll('sup[data-sup]').forEach(sup => {
        sup.style.cursor = 'pointer';
        sup.addEventListener('click', () => {
          const n        = sup.getAttribute('data-sup');
          const sideItem = sidebarBody.querySelector(`[data-sidebar-num="${n}"]`);
          if (sideItem) {
            sideItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sidebarBody.querySelectorAll('.link-item').forEach(el => el.classList.remove('ext-active'));
            sideItem.classList.add('ext-active');
            sideItem.classList.add('ext-highlight');
            setTimeout(() => sideItem.classList.remove('ext-highlight'), 1500);
          }
        });
      });
    }
  }

  const matched   = changes.length;
  const unmatched = extState.bodyNums.length - matched;
  if (unmatched > 0) {
    toast(`Done! ${matched} linked, ⚠️ ${unmatched} unmatched sups.`, 'warning');
  } else {
    toast(`All ${matched} footnotes linked!`, 'success');
  }
}

/* ── DOWNLOAD HELPER ── */
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'application/xhtml+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── COPY BUTTONS ── */
document.getElementById('btnCopyChapter').addEventListener('click', () => {
  if (!extState.processedBody) { toast('No processed content yet.', 'error'); return; }
  navigator.clipboard.writeText(extState.processedBody)
    .then(() => toast('Chapter XHTML copied!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});

document.getElementById('btnCopyFootnote').addEventListener('click', () => {
  if (!extState.processedExt) { toast('No processed content yet.', 'error'); return; }
  navigator.clipboard.writeText(extState.processedExt)
    .then(() => toast('Footnote XHTML copied!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});
