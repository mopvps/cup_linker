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
  const raw  = li.textContent.trim();
  const match = raw.match(/^(\d+)[.\s]/);
  if (!match) return null;
  const num  = match[1];
  const text = raw.replace(/^\d+[.\s]+/, '').trim();
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

function syncExtProcessButton() {
  const ready = extState.bodyRawContent && extState.selectedSection;
  btnProcessExt.disabled = !ready;
}

/* ══════════════════════════════════════
   PROCESS
══════════════════════════════════════ */

btnProcessExt.addEventListener('click', () => {
  if (!extState.bodyRawContent)    { toast('No body file loaded.', 'error'); return; }
  if (!extState.selectedSection)   { toast('No section selected.', 'error'); return; }
  if (!extState.extRawContent)     { toast('No external file loaded.', 'error'); return; }

  try {
    processExternalLinks();
  } catch(err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  }
});

function processExternalLinks() {
  const prefix      = extState.extPrefix;
  const section     = extState.selectedSection;
  const bodyFile    = extState.bodyFileName;
  const extFile     = extState.extFileName;

  // Build a map: num -> footnote item
  const fnMap = {};
  section.items.forEach(item => { fnMap[item.num] = item; });

  let newBody = extState.bodyRawContent;
  let newExt  = extState.extRawContent;

  const changes = [];

  // ── STEP A: Replace body sups
  // <sup>30</sup> →
  // <sup><a class="xref" href="extFile#prefix-030" id="prefix-030-fn">30</a></sup>
  newBody = newBody.replace(/<sup>([\s\S]*?)<\/sup>/gi, (full, inner) => {
    const trimmed = inner.trim();
    if (!/^\d+$/.test(trimmed)) return full; // skip already linked
    const num    = trimmed;
    if (!fnMap[num]) return full; // no matching footnote

    const padded  = num.padStart(3, '0');
    const fnId    = `${prefix}-${padded}`;
    const bodyId  = `${fnId}-fn`;
    const replacement = `<sup><a class="xref" href="${extFile}#${fnId}" id="${bodyId}">${num}</a></sup>`;
    changes.push({ num, bodyId, fnId });
    return replacement;
  });

  // ── STEP B: Inject id into matching <li> in external file
  // and wrap number with backlink anchor
  changes.forEach(({ num, bodyId, fnId }) => {
    const padded = num.padStart(3, '0');
    const id     = `${prefix}-${padded}`;

    // Match <li> whose text starts with "num." or "num "
    // e.g. <li>30. Crittenden...</li>
    const liRegex = new RegExp(
      `(<li)([^>]*>)(\\s*${num}[.\\s])`,
      'i'
    );
    newExt = newExt.replace(liRegex, (full, tag, attrs, numText) => {
      // Add id to <li>, wrap number with backlink
      const cleanNum = numText.trim().replace(/[.\s]+$/, '');
      return `${tag} id="${id}"${attrs}<a href="${bodyFile}#${bodyId}">${cleanNum}.</a> `;
    });
  });

  // ── STEP C: Download both files
  const matched   = changes.length;
  const unmatched = extState.bodyNums.length - matched;

  downloadFile(newBody, bodyFile.replace(/(\.[^.]+)$/, '_linked$1'));
  downloadFile(newExt,  extFile.replace(/(\.[^.]+)$/, '_linked$1'));

  if (unmatched > 0) {
    toast(`Done! ${matched} linked, ⚠️ ${unmatched} unmatched sups.`, 'warning');
  } else {
    toast(`All ${matched} footnotes linked! Both files downloaded.`, 'success');
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
