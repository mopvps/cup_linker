'use strict';

/* ── EXTERNAL STATE ── */
let extState = {
  extFileName: '',
  extRawContent: '',
  extPrefix: '',
  extSections: [],        // [{ label: 'CHAPTER 1', id: 'app1_sec1', items: [{ num: '1', text: '...' }] }]
  selectedSection: null,  // the chosen section object
  bodyFileName: '',
  bodyRawContent: '',
  bodyNums: [],           // sup numbers found in body file
  isFlatList: false,      // true if no sections detected
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

const extPrefixStep    = document.getElementById('extPrefixStep');
const extPrefixInput   = document.getElementById('extPrefixInput');
const extPrefixStatus  = document.getElementById('extPrefixStatus');
const extPrefixCheck   = document.getElementById('extPrefixCheck');
const btnConfirmPrefix = document.getElementById('btnConfirmPrefix');

const extStep2         = document.getElementById('extStep2');
const extSectionSelect = document.getElementById('extSectionSelect');
const extSectionStatus = document.getElementById('extSectionStatus');
const extSectionCheck  = document.getElementById('extSectionCheck');

const extStep3         = document.getElementById('extStep3');
const pickBodyFile     = document.getElementById('pickBodyFile');
const bodyFileInput    = document.getElementById('bodyFileInput');
const bodyFileBtnText  = document.getElementById('bodyFileBtnText');
const bodyFileStatus   = document.getElementById('bodyFileStatus');
const bodyFileCheck    = document.getElementById('extBodyCheck');

const btnProcessExt    = document.getElementById('btnProcessExt');

/* ══════════════════════════════════════
   STEP 1 — Upload External File
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

    // Auto-detect ID prefix
    const detectedPrefix = detectIdPrefix(extState.extRawContent);
    extState.extPrefix = detectedPrefix;
    extPrefixInput.value = detectedPrefix;

    if (detectedPrefix) {
      extPrefixStatus.textContent = `Detected: "${detectedPrefix}" — sections will be found by id starting with this prefix + number (1→n). Edit if wrong.`;
    } else {
      extPrefixStatus.textContent = 'Could not auto-detect — enter the prefix manually. Example: if ids are "bm1section1", "bm1section2" → prefix is "bm1section"';
    }

    extFileStatus.textContent = 'File loaded';
    extFileStatus.classList.add('ok');
    extFileCheck.style.opacity = '1';
    extStep1.classList.add('done');
    pickExtFile.classList.add('selected');

    // Show prefix verify step
    extPrefixStep.hidden = false;

    toast(`External file loaded: ${file.name}`, 'success');
  };
  reader.readAsText(file, 'utf-8');
});

/* ══════════════════════════════════════
   STEP 1b — Detect ID Prefix
══════════════════════════════════════ */

/* Scans all heading ids in the file and extracts the common prefix
   e.g. id="app1_sec1", id="app1_sec2" → "app1"
   e.g. id="bm1_sec1", id="bm1_sec2"  → "bm1"  */
function detectIdPrefix(content) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(content, 'application/xhtml+xml');
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];

  const ids = headings
    .map(h => h.getAttribute('id'))
    .filter(Boolean)
    .filter(id => /\d+$/.test(id)); // only ids that end with a number

  if (!ids.length) return '';

  // Strip trailing digits to get the prefix
  // e.g. "app1_sec3"  → "app1_sec"
  // e.g. "bm1section3" → "bm1section"
  // e.g. "bm1-section3" → "bm1-section"
  const candidate = ids[0].replace(/\d+$/, '');

  if (!candidate) return '';

  // Verify at least 2 headings share this prefix
  const matches = ids.filter(id => id.startsWith(candidate) && /\d+$/.test(id));
  if (matches.length < 2) return '';

  return candidate;
}

btnConfirmPrefix.addEventListener('click', () => {
  const prefix = extPrefixInput.value.trim();
  if (!prefix) {
    toast('Please enter an ID prefix.', 'error');
    return;
  }

  extState.extPrefix = prefix;
  extPrefixCheck.style.opacity = '1';
  extPrefixStep.classList.add('done');

  // Now scan sections using confirmed prefix
  const result = scanSections(extState.extRawContent, prefix);
  extState.extSections  = result.sections;
  extState.isFlatList   = result.isFlatList;

  // Populate section dropdown
  populateSectionDropdown(result);

  // Show step 2
  extStep2.hidden = false;

  toast(`Prefix confirmed: "${prefix}"`, 'success');
});

/* ══════════════════════════════════════
   SECTION SCANNER
══════════════════════════════════════ */

/* Scans the external file for sections using the confirmed prefix.
   Returns { sections, isFlatList } */
function scanSections(content, prefix) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(content, 'application/xhtml+xml');

  // Find all headings whose id:
  // 1. Starts with the confirmed prefix
  // 2. Ends with a number (1→n)
  // No separator assumed — works for any pattern
  const sectionHeadings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(el => {
      const id = el.getAttribute('id');
      return id &&
             id.startsWith(prefix) &&
             /\d+$/.test(id);
    })
    .sort((a, b) => {
      // Sort by trailing number ascending (1→n)
      const numA = parseInt(a.getAttribute('id').replace(prefix, ''), 10);
      const numB = parseInt(b.getAttribute('id').replace(prefix, ''), 10);
      return numA - numB;
    });

  // FLAT LIST — no matching section headings found
  if (!sectionHeadings.length) {
    const items = extractListItems(doc.body);
    return {
      isFlatList: true,
      sections: [{ label: 'All Footnotes', id: 'flat', items }]
    };
  }

  // SECTIONED — group <li> items between each heading and the next
  const sections = sectionHeadings.map((heading, idx) => {
    const label     = heading.textContent.trim();
    const id        = heading.getAttribute('id');
    const nextHeading = sectionHeadings[idx + 1] || null;

    const items = [];
    let el = heading.nextElementSibling;

    while (el) {
      // Stop when we reach the next section heading
      if (nextHeading && el === nextHeading) break;

      // Stop if we hit any heading that starts with prefix and ends with number
      if (['H1','H2','H3','H4','H5','H6'].includes(el.tagName)) {
        const elId = el.getAttribute('id');
        if (elId && elId.startsWith(prefix) && /\d+$/.test(elId)) break;
      }

      // Collect <li> from ol/ul children
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

/* Extract all <li> items from the entire body (flat list case) */
function extractListItems(body) {
  return [...body.querySelectorAll('li')]
    .map(parseListItem)
    .filter(Boolean);
}

/* Parse a single <li> — extract number and text
   "30. Crittenden, Unreality, 69." → { num: '30', text: 'Crittenden...' } */
function parseListItem(li) {
  // Strip pagebreak spans (epub:type="pagebreak") before reading text
  // Clone to avoid mutating the parsed DOM
  const clone = li.cloneNode(true);
  const pagebreaks = clone.querySelectorAll
    ? [...clone.querySelectorAll('[epub\\:type="pagebreak"],[role="doc-pagebreak"]')]
    : [];
  pagebreaks.forEach(el => el.parentNode.removeChild(el));

  const raw = clone.textContent.trim();
  // Match number at start, optionally followed by dot and/or space
  const match = raw.match(/^(\d+)[.\s]*/);
  if (!match) return null;
  const num  = match[1];
  const text = raw.replace(/^\d+[.\s]*/, '').trim();
  return { num, text, el: li };
}

/* ══════════════════════════════════════
   STEP 2 — Section Dropdown
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

  // Show step 3
  extStep3.hidden = false;

  toast(`Section selected: ${extState.selectedSection.label}`, 'success');
});

/* ══════════════════════════════════════
   STEP 3 — Upload Body Chapter File
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

    // Scan body sups
    const nums = scanBodySups(extState.bodyRawContent);
    extState.bodyNums = nums;

    bodyFileStatus.textContent = `${nums.length} superscript(s) found`;
    bodyFileStatus.classList.add('ok');
    bodyFileCheck.style.opacity = '1';
    extStep3.classList.add('done');
    pickBodyFile.classList.add('selected');

    renderChapterPreview(extState.bodyRawContent);

    // Enable process if section also selected
    syncExtProcessButton();

    toast(`Body file loaded: ${file.name} — ${nums.length} sups found`, 'success');
  };
  reader.readAsText(file, 'utf-8');
});

/* Scan all bare <sup>NUMBER</sup> in body (no existing <a> inside) */
function scanBodySups(content) {
  const nums = [];
  const supRegex = /<sup>([\s\S]*?)<\/sup>/gi;
  let m;
  while ((m = supRegex.exec(content)) !== null) {
    const inner = m[1].trim();
    if (/^\d+$/.test(inner)) nums.push(inner);
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

  // Badge all bare <sup>NUMBER</sup> in preview (pre-process, no status yet)
  preview.querySelectorAll('sup').forEach(sup => {
    const txt = sup.textContent.trim();
    if (!/^\d+$/.test(txt)) return;
    if (sup.querySelector('a')) return; // already linked
    sup.classList.add('sup-badge', 'status-pending');
    sup.setAttribute('data-sup', txt);
  });
}

function checkExistingIds(section) {
  const prefix = extState.extPrefix;
  const items  = section.items;
  if (!items || !items.length) return 0;
  let count = 0;
  items.forEach(item => {
    const padded = item.num.padStart(3, '0');
    // After processing, <li> gets id="prefix-033" — check for that pattern
    const checkRegex = new RegExp(`<li[^>]*\\sid="${prefix}-${padded}"`, 'i');
    if (checkRegex.test(extState.extRawContent)) count++;
  });
  return count;
}

function syncExtProcessButton() {
  const ready = extState.bodyRawContent && extState.selectedSection;
  btnProcessExt.disabled = !ready;
}

/* ══════════════════════════════════════
   PROCESS
══════════════════════════════════════ */

btnProcessExt.addEventListener('click', () => {
  if (!extState.bodyRawContent)  { toast('No body file loaded.', 'error'); return; }
  if (!extState.selectedSection) { toast('No section selected.', 'error'); return; }
  if (!extState.extRawContent)   { toast('No external file loaded.', 'error'); return; }

  const existingCount = checkExistingIds(extState.selectedSection);
  if (existingCount > 0) {
    const msg = document.getElementById('extIdWarnMsg');
    if (msg) msg.textContent = `${existingCount} footnote(s) in this section already have IDs.`;
    document.getElementById('extIdWarnModal').hidden = false;
    if (window.lucide) lucide.createIcons();
    return;
  }

  try {
    processExternalLinks();
  } catch(err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  }
});

// Warning modal — Replace
document.getElementById('extIdWarnReplace').addEventListener('click', () => {
  document.getElementById('extIdWarnModal').hidden = true;
  // Strip existing ids from <li> in ext file before re-processing
  extState.extRawContent = extState.extRawContent.replace(
    /(<li)\s+id="[^"]*"([^>]*>)/gi,
    '$1$2'
  );
  try {
    processExternalLinks();
  } catch(err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  }
});

// Warning modal — Cancel
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

  // STEP A: Replace body sups
  newBody = newBody.replace(/<sup>([\s\S]*?)<\/sup>/gi, (full, inner) => {
    const trimmed = inner.trim();
    if (!/^\d+$/.test(trimmed)) return full;
    const num = trimmed;
    if (!fnMap[num]) return full;
    const padded  = num.padStart(3, '0');
    const fnId    = `${prefix}-${padded}`;
    const bodyId  = `${fnId}-fn`;
    changes.push({ num, bodyId, fnId });
    return `<sup><a class="xref" href="${extFile}#${fnId}" id="${bodyId}">${num}</a></sup>`;
  });

  // STEP B: Inject id into matching <li> in external file
  changes.forEach(({ num, bodyId, fnId }) => {
    const padded = num.padStart(3, '0');
    const id     = `${prefix}-${padded}`;
    // Match <li> that contains the footnote number, even if a pagebreak <span> comes first
    // e.g. <li class="fn" ...><span id="page_261" role="doc-pagebreak" .../>34 Eagleton...
    // Negative lookahead (?![^>]*\sid=) skips <li> already injected with an id
    // This prevents a previously processed li from being matched again by the next num
    const liRegex = new RegExp(
      `(<li)(?![^>]*\\sid=)([^>]*>)` +
      `((?:<span[^/]*/\\s*>|<span[^>]*></span>)*)` +
      `(\\s*${num}[.\\s])`,
      'i'
    );
    newExt = newExt.replace(liRegex, (full, tag, attrs, spans, numText) => {
      const cleanNum = numText.trim().replace(/[.\s]+$/, '');
      return `${tag} id="${id}"${attrs}${spans}<a href="${bodyFile}#${bodyId}">${cleanNum}.</a> `;
    });
  });

  // Store processed content for copy buttons
  extState.processedBody = newBody;
  extState.processedExt  = newExt;

  // Show copy buttons
  const copyBtns = document.getElementById('extCopyBtns');
  if (copyBtns) copyBtns.hidden = false;
  if (window.lucide) lucide.createIcons();

  // Populate right sidebar
  const sidebarBody  = document.getElementById('extSidebarBody');
  const sidebarCount = document.getElementById('extSidebarCount');
  const sidebarEmpty = document.getElementById('extSidebarEmpty');
  if (sidebarEmpty) sidebarEmpty.hidden = true;
  if (sidebarCount) sidebarCount.textContent = extState.bodyNums.length;

  if (sidebarBody) {
    const linkedNums = new Set(changes.map(c => c.num));
    const preview    = document.getElementById('extDocPreview');

    // Update sup badges in preview to green/red based on link status
    if (preview) {
      preview.querySelectorAll('sup[data-sup]').forEach(sup => {
        const num = sup.getAttribute('data-sup');
        sup.classList.remove('status-pending');
        sup.classList.add(linkedNums.has(num) ? 'status-green' : 'status-red');
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

      // RIGHT → MIDDLE: click sidebar item → scroll to sup in preview
      item.addEventListener('click', () => {
        if (!preview) return;
        const target = preview.querySelector(`sup[data-sup="${num}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('ext-highlight');
          setTimeout(() => target.classList.remove('ext-highlight'), 1500);
        }
        // highlight active sidebar item
        sidebarBody.querySelectorAll('.link-item').forEach(el => el.classList.remove('ext-active'));
        item.classList.add('ext-active');
      });

      sidebarBody.appendChild(item);
    });

    // MIDDLE → RIGHT: click sup badge → scroll to sidebar item
    if (preview) {
      preview.querySelectorAll('sup[data-sup]').forEach(sup => {
        sup.style.cursor = 'pointer';
        sup.addEventListener('click', () => {
          const num      = sup.getAttribute('data-sup');
          const sideItem = sidebarBody.querySelector(`[data-sidebar-num="${num}"]`);
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
    .then(() => toast('Chapter XHTML copied to clipboard!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});

document.getElementById('btnCopyFootnote').addEventListener('click', () => {
  if (!extState.processedExt) { toast('No processed content yet.', 'error'); return; }
  navigator.clipboard.writeText(extState.processedExt)
    .then(() => toast('Footnote XHTML copied to clipboard!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});
