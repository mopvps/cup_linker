// Reference Linker Ext — Tab 3 logic (self-contained; does not touch app.js / app-external.js / script.js / format.js)
(function () {

  // Inject auto-link styles
  (function injectAutoLinkStyles() {
    const style = document.createElement('style');
    style.textContent = `
      a.rle-auto-linked {
        background: #ede9fe;
        color: #5b21b6;
        border-bottom: 2px solid #7c3aed;
        border-radius: 2px;
        padding: 0 1px;
        cursor: pointer;
      }
      .rle-citation-item.auto-linked .rle-sidebar-num {
        background: #7c3aed;
      }
      .rle-citation-item.auto-linked {
        border-left: 3px solid #7c3aed;
      }
      .rle-auto-tag {
        font-size: 9px;
        background: #7c3aed;
        color: #fff;
        border-radius: 3px;
        padding: 1px 4px;
        margin-left: 4px;
        vertical-align: middle;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    `;
    document.head.appendChild(style);
  })();

  /* ── DOM refs ── */
  const refBtn = document.getElementById('rleRefPickBtn');
  const refInput = document.getElementById('rleRefInput');
  const refText = document.getElementById('rleRefPickText');
  const refStatus = document.getElementById('rleRefStatus');

  const chapterBtn = document.getElementById('rleChapterPickBtn');
  const chapterInput = document.getElementById('rleChapterInput');
  const chapterText = document.getElementById('rleChapterPickText');
  const chapterStatus = document.getElementById('rleChapterStatus');

  const emptyState = document.getElementById('refExtEmptyState');
  const workspace = document.getElementById('refExtWorkspace');
  const contentArea = document.getElementById('refExtContentArea');
  const copyBtn = document.getElementById('refExtCopyBtn');
  const autoLinkBtn = document.getElementById('rleAutoLinkBtn');

  const popup = document.getElementById('refExtPopup');
  const popupSel = document.getElementById('refExtPopupSel');
  const popupList = document.getElementById('refExtPopupList');
  const popupClose = document.getElementById('refExtPopupClose');

  const sidebarCount = document.getElementById('rleSidebarCount');
  const sidebarBody = document.getElementById('rleSidebarBody');

  const folderPickBtn  = document.getElementById('rleFolderPickBtn');
  const folderInput    = document.getElementById('rleFolderInput');
  const folderPickText = document.getElementById('rleFolderPickText');
  const folderStatus   = document.getElementById('rleFolderStatus');
  const folderCheck    = document.getElementById('rleFolderCheck');

  const extractBtn      = document.getElementById('rleExtractBtn');
  const extractCopyBtn  = document.getElementById('rleExtractCopyBtn');
  const extractEmpty    = document.getElementById('rleExtractEmpty');
  const extractResults  = document.getElementById('rleExtractResults');
  const extractTbody    = document.getElementById('rleExtractTbody');

  if (!refBtn || !chapterBtn || !contentArea) return;

  /* ── state ── */
  const state = {
    refFileName: '',
    refs: [],           // [{ id, author, fullText }]
    fuse: null,
    chapterFileName: '',
    chapterDoc: null,   // parsed XML document of the chapter file (preview only)
    rawChapterText: '', // original file text, untouched
    rawStrippedText: '', // rawChapterText with existing citation <a> tags unwrapped — export baseline
    rawMap: null,        // { text, map } — maps rawStrippedText's plain-text offsets to raw char offsets
    linkEdits: [],   // [{ start, end, openTag, closeTag, id, domAnchor }] — offsets are into rawStrippedText
    savedRange: null,
    undoStack: [],
    popupMode: 'link',      // 'link' | 'change'
    changingAnchor: null,   // <a> being changed, or null
    justOpened: false,
    folderFiles: []   // array of File objects from the picked folder
  };

  function saveUndoSnapshot() {
    state.undoStack.push({
      html: contentArea.innerHTML,
      edits: state.linkEdits.map(({ domAnchor, ...rest }) => rest)
    });
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  /* ── dropzone wiring (mirrors existing sidebar step-btn drag/drop) ── */
  function wireDropzone(btn, input) {
    btn.addEventListener('click', () => input.click());
    ['dragenter', 'dragover'].forEach(evt => {
      btn.addEventListener(evt, (e) => { e.preventDefault(); btn.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      btn.addEventListener(evt, (e) => { e.preventDefault(); btn.classList.remove('dragover'); });
    });
    btn.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  }
  wireDropzone(refBtn, refInput);
  wireDropzone(chapterBtn, chapterInput);

  folderPickBtn.addEventListener('click', () => folderInput.click());

  folderInput.addEventListener('change', () => {
    const files = [...folderInput.files].filter(f =>
      f.name.endsWith('.xhtml') || f.name.endsWith('.html') || f.name.endsWith('.xml')
    );
    if (!files.length) {
      toast('No XHTML files found in folder', 'error');
      return;
    }

    state.folderFiles = files;
    folderPickText.textContent = files[0].webkitRelativePath.split('/')[0]; // folder name
    folderStatus.textContent = `${files.length} XHTML file(s) found`;
    folderStatus.classList.add('ok');
    folderCheck.style.opacity = '1';
    rleFolderStep.classList.add('done');
    folderPickBtn.classList.add('selected');

    toast(`Folder loaded: ${files.length} XHTML files`, 'success');
  });

  /* ── reference file parsing ── */
  refInput.addEventListener('change', () => {
    const file = refInput.files && refInput.files[0];
    if (!file) return;
    state.refFileName = file.name;
    refText.textContent = file.name;

    const reader = new FileReader();
    reader.onload = () => {
      parseReferenceFile(reader.result);
      refStatus.textContent = `${file.name} — ${state.refs.length} reference${state.refs.length === 1 ? '' : 's'} found`;
      refStatus.classList.add('ok');
      checkAutoLinkReady();
    };
    reader.readAsText(file);
  });

  function parseReferenceFile(rawText) {
    const doc = parseXhtml(rawText);
    const entries = doc ? Array.from(doc.querySelectorAll('li.biblioentry')) : [];

    state.refs = entries.map((li) => {
      const labelEl = li.querySelector('span.reflabel[id]');
      const id = labelEl ? labelEl.getAttribute('id') : '';
      const fullText = (li.textContent || '').trim().replace(/\s+/g, ' ');

      // Extract year from (YYYY) or (YYYYa) pattern
      const yearMatch = fullText.match(/\(((19|20)\d{2}[a-z]?)\)/);
      const year = yearMatch ? yearMatch[1] : '';

      // Extract first surname — word before first comma
      // Handles particles like "de Vries" by allowing lowercase after capital
      // fullText starts with empty reflabel span text + possible whitespace
      // so strip leading non-alpha chars before matching first surname
      const trimmedFullText = fullText.replace(/^\W+/, '');
      const firstSurnameMatch = trimmedFullText.match(/^([A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?)/);
      const firstSurname = firstSurnameMatch ? firstSurnameMatch[1].trim() : '';

      // Extract second surname (for 2-author refs) — after & or and, before next comma
      const secondSurnameMatch = fullText.match(/(?:&|and)\s+([A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?)\s*(?:,|\()/);
      const secondSurname = secondSurnameMatch ? secondSurnameMatch[1].trim() : '';

      // Count authors by counting ", X." initial patterns
      const initialMatches = fullText.match(/,\s*[A-Z]\./g) || [];
      const authorCount = initialMatches.length + 1;

      // Legacy author field for fuse search (keep compatible)
      const authorMatch = fullText.match(/^([^.,]+)[.,]/);
      const author = authorMatch ? authorMatch[1].trim() : fullText.trim();

      return { id, author, firstSurname, secondSurname, authorCount, year, fullText };
    }).filter(r => r.id);

    state.fuse = (typeof Fuse !== 'undefined')
      ? new Fuse(state.refs, { keys: ['author'], threshold: 0.4 })
      : null;

    markValidExistingLinks();
    linkDomAnchorsToEdits();
  }

  function markValidExistingLinks() {
    if (!contentArea) return;
    contentArea.querySelectorAll('a[href]').forEach(a => {
      a.classList.remove('rle-citation', 'already-linked');
      const href = a.getAttribute('href') || '';
      const hashIdx = href.indexOf('#');
      if (hashIdx === -1) return;
      const targetId = href.slice(hashIdx + 1);
      const isValidRef = state.refs.some(r => r.id === targetId);
      if (isValidRef) {
        a.classList.add('rle-citation', 'already-linked');
      }
    });
  }

  /* ── raw-text baseline: rawStrippedText is the export source of truth,
     never the DOM. Existing citation <a> tags are unwrapped out of it at
     load time; linkEdits re-wraps text ranges back in at copy time. ── */
  function buildRawBaseline(raw) {
    state.rawChapterText = raw;
    state.linkEdits = [];

    let stripped = '';
    let lastIndex = 0;
    const tagRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = tagRe.exec(raw))) {
      const attrs = m[1];
      const inner = m[2];
      const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      const hashIdx = href.indexOf('#');
      const targetId = hashIdx !== -1 ? href.slice(hashIdx + 1) : '';
      const isValidRef = targetId && state.refs.some(r => r.id === targetId);

      stripped += raw.slice(lastIndex, m.index);

      if (isValidRef) {
        const idMatch = attrs.match(/\bid\s*=\s*"([^"]*)"/i);
        const start = stripped.length;
        stripped += inner;
        const end = stripped.length;
        state.linkEdits.push({
          start, end,
          openTag: `<a${attrs}>`,
          closeTag: '</a>',
          id: idMatch ? idMatch[1] : targetId,
          domAnchor: null
        });
      } else {
        stripped += m[0];
      }
      lastIndex = tagRe.lastIndex;
    }
    stripped += raw.slice(lastIndex);

    state.rawStrippedText = stripped;
    state.rawMap = buildRawTextMap(stripped);
  }

  function buildRawTextMap(raw) {
    let text = '';
    const map = [];
    const len = raw.length;
    let i = 0;
    while (i < len) {
      const ch = raw[i];
      if (ch === '<') {
        const close = raw.indexOf('>', i);
        if (close === -1) { i = len; break; }
        i = close + 1;
        continue;
      }
      if (ch === '&') {
        const semi = raw.indexOf(';', i);
        if (semi !== -1 && semi - i <= 10) {
          const decoded = decodeEntity(raw.slice(i, semi + 1));
          if (decoded !== null) {
            text += decoded;
            map.push(i);
            i = semi + 1;
            continue;
          }
        }
      }
      text += ch;
      map.push(i);
      i++;
    }
    return { text, map };
  }

  function decodeEntity(entity) {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
    if (named[entity]) return named[entity];
    let m = entity.match(/^&#(\d+);$/);
    if (m) return String.fromCharCode(parseInt(m[1], 10));
    m = entity.match(/^&#x([0-9a-fA-F]+);$/);
    if (m) return String.fromCharCode(parseInt(m[1], 16));
    return null;
  }

  function renderedTextLength(root, stopNode, stopOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip text inside injected UI elements — they have no counterpart
        // in the raw source text and must not count toward offsets
        if (node.parentElement && node.parentElement.closest('.rle-cite-badge, .rle-year-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let length = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node === stopNode) {
        length += stopOffset;
        break;
      }
      length += node.nodeValue.length;
    }
    return length;
  }

  // Char offset of a Range's boundaries within contentArea's rendered text
  function renderedOffsetOfRange(range) {
    const start = renderedTextLength(contentArea, range.startContainer, range.startOffset);
    const end = renderedTextLength(contentArea, range.endContainer, range.endOffset);
    return { start, end };
  }

  // Context-matching lookup: searches rawStrippedText directly for the
  // selected text plus surrounding context, instead of counting DOM chars
  // (avoids drift from badges, year-highlights, or other injected UI).
  function findRawOffsets(selectedText, range) {
    const CONTEXT_LEN = 40;

    // Strip existing <a> citation text and injected UI spans from context
    // so it matches rawStrippedText (which has citations unwrapped to plain text)
    function domRangeText(r) {
      const frag = r.cloneContents();
      frag.querySelectorAll('.rle-cite-badge').forEach(el => el.remove());
      frag.querySelectorAll('.rle-year-highlight').forEach(el => {
        el.replaceWith(document.createTextNode(el.textContent));
      });
      return frag.textContent;
    }

    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(contentArea);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const contextBefore = domRangeText(beforeRange).slice(-CONTEXT_LEN);

    const afterRange = document.createRange();
    afterRange.selectNodeContents(contentArea);
    afterRange.setStart(range.endContainer, range.endOffset);
    const contextAfter = domRangeText(afterRange).slice(0, CONTEXT_LEN);

    // Build a regex from plain text that tolerates any inline tags between
    // characters AND matches HTML entities as their decoded equivalents.
    // e.g. "Palmer & Synnott" matches "Palmer &#x0026; Synnott" in raw text.
    function toTagTolerantRegex(str) {
      const TAG_OR_ENTITY = '(?:<[^>]*>|&[^;]{1,10};)*';
      return str.split('').map(ch => {
        if (/\s/.test(ch)) return TAG_OR_ENTITY + '\\s+' + TAG_OR_ENTITY;
        const esc = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Allow the char to appear either literally or as a decimal/hex entity
        const code = ch.charCodeAt(0);
        const hex = code.toString(16);
        const entityAlt = `(?:${esc}|&#${code};|&#[xX]0*${hex};|&amp;)`;
        return TAG_OR_ENTITY + entityAlt + TAG_OR_ENTITY;
      }).join('');
    }

    const BLOCK_CLOSE_RE = /<\/(p|li|h[1-6]|div|td|th|blockquote|section)[^>]*>/i;

    function tryFind(before, sel, after) {
      const pattern = toTagTolerantRegex(before) +
                      '(' + toTagTolerantRegex(sel) + ')' +
                      toTagTolerantRegex(after);
      let re;
      try { re = new RegExp(pattern); } catch(e) { return null; }
      const m = re.exec(state.rawStrippedText);
      if (!m || !m[1]) return null;
      const rawStart = m.index + m[0].indexOf(m[1]);
      const rawEnd = rawStart + m[1].length;
      // Reject if a block-closing tag falls inside the matched raw range
      // Only reject if a block-close tag is strictly INSIDE the selection
      // (not at the very end boundary where the regex may have consumed </p>)
      const innerSlice = state.rawStrippedText.slice(rawStart, rawEnd);
      const trimmedSlice = innerSlice.replace(/<\/(p|li|h[1-6]|div|td|th|blockquote|section)[^>]*>\s*$/i, '');
      const trimmedEnd = rawStart + trimmedSlice.length;
      if (BLOCK_CLOSE_RE.test(trimmedSlice)) return null;
      return { rawStart, rawEnd: trimmedEnd };
    }

    let result = tryFind(contextBefore, selectedText, contextAfter);
    if (result) return result;

    for (const len of [20, 10, 5, 0]) {
      result = tryFind(
        contextBefore.slice(-len),
        selectedText,
        contextAfter.slice(0, len)
      );
      if (result) return result;
    }

    return null;
  }

  function rawOffsetsForRendered(startRendered, endRendered) {
    const map = state.rawMap.map;
    const rawStart = map[startRendered] !== undefined ? map[startRendered] : state.rawStrippedText.length;
    const rawEnd = endRendered < map.length ? map[endRendered] : state.rawStrippedText.length;
    return { rawStart, rawEnd };
  }

  function setHrefInOpenTag(openTag, newHref) {
    if (/href\s*=\s*"[^"]*"/i.test(openTag)) {
      return openTag.replace(/href\s*=\s*"[^"]*"/i, `href="${newHref}"`);
    }
    return openTag.replace(/^<a/i, `<a href="${newHref}"`);
  }

  // Associate rendered <a> elements in contentArea with their linkEdits entry by id
  function linkDomAnchorsToEdits() {
    contentArea.querySelectorAll('a.rle-citation[id]').forEach(a => {
      const id = a.getAttribute('id');
      const edit = state.linkEdits.find(e => e.id === id);
      if (edit) edit.domAnchor = a;
    });
  }

  function highlightYears(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip inside year-highlight spans (no double-wrap)
        if (node.parentElement && node.parentElement.closest('.rle-year-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip inside <a> tags — years there are citation years, not prose dates
        if (node.parentElement && node.parentElement.closest('a')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Only accept if a standalone year exists (word boundaries both sides)
        // Must NOT be preceded or followed by a letter (avoids splitting "1991a" mid-token)
        return /(?<![A-Za-z])\b(1[6-9]\d{2}|20\d{2})\b(?![A-Za-z0-9])/.test(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    textNodes.forEach(node => {
      const frag = document.createDocumentFragment();
      // Split only on standalone years — not "1991a" (year+letter suffix)
      const parts = node.nodeValue.split(/((?<![A-Za-z])\b(?:1[6-9]\d{2}|20\d{2})\b(?![A-Za-z0-9]))/);
      parts.forEach((part, i) => {
        if (i % 2 === 1) {
          const span = document.createElement('span');
          span.className = 'rle-year-highlight';
          span.textContent = part;
          frag.appendChild(span);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ── chapter file rendering ── */
  chapterInput.addEventListener('change', () => {
    const file = chapterInput.files && chapterInput.files[0];
    if (!file) return;
    state.chapterFileName = file.name;
    chapterText.textContent = file.name;

    const reader = new FileReader();
    reader.onload = () => {
      buildRawBaseline(reader.result); // export source of truth — never re-derived from the DOM

      const doc = parseXhtml(reader.result);
      state.chapterDoc = doc;
      const body = doc ? doc.querySelector('body') : null;

      contentArea.innerHTML = '';
      if (body) {
        Array.from(body.childNodes).forEach(node => {
          // document.importNode into the main HTML document handles the
          // XML self-closing-tag serialization mismatch correctly
          const imported = document.importNode(node, true);
          contentArea.appendChild(imported);
        });
      } else {
        contentArea.innerHTML = reader.result;
      }

      markValidExistingLinks();
      linkDomAnchorsToEdits();
      highlightYears(contentArea);

      chapterStatus.textContent = `${file.name} loaded`;
      chapterStatus.classList.add('ok');

      emptyState.hidden = true;
      workspace.hidden = false;

      checkAutoLinkReady();
      renderCitationList();
    };
    reader.readAsText(file);
  });

  function parseXhtml(rawText) {
    try {
      const doc = new DOMParser().parseFromString(rawText, 'application/xhtml+xml');
      if (doc.querySelector('parsererror')) throw new Error('parse error');
      return doc;
    } catch (e) {
      return new DOMParser().parseFromString(rawText, 'text/html');
    }
  }

  /* ── click existing citation: open Change popup for it ── */
  contentArea.addEventListener('click', (e) => {
    const a = e.target.closest('a.rle-citation');
    if (!a) return;
    e.preventDefault();

    const allCitations = [...contentArea.querySelectorAll('a.rle-citation')];
    const idx = allCitations.indexOf(a);
    if (idx !== -1) highlightSidebarItem(idx);

    state.popupMode = 'change';
    state.changingAnchor = a;
    const selectedText = a.textContent.trim();
    popupSel.textContent = `Change citation for "${selectedText}"`;

    const { searchInput, fuzzyLabel, fuzzyList, allLabel, allList } = buildPopupShell();
    populateMatches(selectedText, fuzzyLabel, fuzzyList, allLabel, allList, searchInput);

    popup.style.top = Math.min(e.clientY + 10, window.innerHeight - 420) + 'px';
    popup.style.left = Math.min(e.clientX + 10, window.innerWidth - 360) + 'px';
    state.justOpened = true;
    popup.hidden = false;
  });

  /* ── select text: open Link popup ── */
  contentArea.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    const selText = selection ? selection.toString().trim() : '';
    // Only bail if clicking an existing citation AND nothing is selected
    if (e.target.closest('a.rle-citation') && !selText) return;

    const text = selection ? selection.toString().trim() : '';
    if (!text || selection.rangeCount === 0 || selection.isCollapsed) return;

    // Save range and text IMMEDIATELY before anything clears it
    const savedText = text;
    state.savedRange = selection.getRangeAt(0).cloneRange();

    const x = Math.min(e.clientX + 10, window.innerWidth - 360);
    const y = Math.min(e.clientY + 10, window.innerHeight - 420);
    popup.style.top = y + 'px';
    popup.style.left = x + 'px';

    state.popupMode = 'link';
    state.changingAnchor = null;
    setTimeout(() => showMatches(savedText), 10);
  });

  function buildPopupShell() {
    popupList.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'popup-search';
    searchWrap.innerHTML = `<i data-lucide="search"></i>`;
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter references';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchWrap.appendChild(searchInput);

    const fuzzyLabel = document.createElement('div');
    fuzzyLabel.className = 'rle-section-label';
    fuzzyLabel.textContent = 'Fuzzy Matches';

    const fuzzyList = document.createElement('div');
    fuzzyList.className = 'popup-section fuzzy-section';

    const allLabel = document.createElement('div');
    allLabel.className = 'rle-section-label';
    allLabel.textContent = 'All References';

    const allList = document.createElement('div');
    allList.className = 'popup-section all-section';

    popupList.appendChild(searchWrap);
    popupList.appendChild(fuzzyLabel);
    popupList.appendChild(fuzzyList);
    popupList.appendChild(allLabel);
    popupList.appendChild(allList);

    if (window.lucide) lucide.createIcons();

    return { searchInput, fuzzyLabel, fuzzyList, allLabel, allList };
  }

  function populateMatches(selectedText, fuzzyLabel, fuzzyList, allLabel, allList, searchInput) {
    const fuzzyResults = state.fuse ? state.fuse.search(selectedText).slice(0, 5) : [];
    if (!fuzzyResults.length) {
      fuzzyList.appendChild(makeNoMatches('No fuzzy matches found'));
    } else {
      fuzzyResults.forEach(({ item, score }) => fuzzyList.appendChild(makeMatchRow(item, score)));
    }

    const firstChar = selectedText.trim().charAt(0).toLowerCase();
    const sortedAll = [...state.refs].sort((a, b) => {
      const aMatch = a.author.charAt(0).toLowerCase() === firstChar;
      const bMatch = b.author.charAt(0).toLowerCase() === firstChar;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      return a.author.localeCompare(b.author);
    });
    sortedAll.forEach(item => allList.appendChild(makeMatchRow(item, null)));

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();

      let fuzzyVisible = 0;
      fuzzyList.querySelectorAll('.rle-match-row').forEach(row => {
        const show = !q || row.dataset.author.includes(q) || row.dataset.text.includes(q);
        row.hidden = !show;
        if (show) fuzzyVisible++;
      });
      fuzzyLabel.hidden = fuzzyVisible === 0;

      let allVisible = 0;
      allList.querySelectorAll('.rle-match-row').forEach(row => {
        const show = !q || row.dataset.author.includes(q) || row.dataset.text.includes(q);
        row.hidden = !show;
        if (show) allVisible++;
      });
      allLabel.hidden = allVisible === 0;
    });
  }

  function makeMatchRow(item, score) {
    const row = document.createElement('div');
    row.className = 'rle-match-row';
    row.dataset.author = item.author.toLowerCase();
    row.dataset.text = item.fullText.toLowerCase();

    const top = document.createElement('div');
    top.className = 'rle-match-top';

    if (score != null) {
      const scoreEl = document.createElement('span');
      scoreEl.className = 'rle-match-score';
      scoreEl.textContent = `${Math.round((1 - score) * 100)}%`;
      top.appendChild(scoreEl);
    }

    const authorEl = document.createElement('span');
    authorEl.className = 'rle-match-author';
    authorEl.textContent = item.author;
    top.appendChild(authorEl);

    const previewEl = document.createElement('div');
    previewEl.className = 'rle-match-preview';
    previewEl.textContent = truncate(item.fullText, 120);

    const linkBtn = document.createElement('button');
    linkBtn.className = 'rle-match-btn';
    linkBtn.textContent = 'Link It';
    linkBtn.addEventListener('click', () => {
      if (state.popupMode === 'change' && state.changingAnchor) {
        saveUndoSnapshot();
        const newHref = `${state.refFileName}#${item.id}`;
        state.changingAnchor.setAttribute('href', newHref);
        state.changingAnchor.classList.remove('linked', 'already-linked');
        state.changingAnchor.classList.add('rle-citation', 'linked');

        const edit = state.linkEdits.find(e => e.domAnchor === state.changingAnchor);
        if (edit) edit.openTag = setHrefInOpenTag(edit.openTag, newHref);

        toast(`Citation changed to ${item.author}`, 'success');
        closePopup();
        renderCitationList();
      } else {
        linkSelection(item);
      }
    });

    row.appendChild(top);
    row.appendChild(previewEl);
    row.appendChild(linkBtn);

    return row;
  }

  function makeNoMatches(text) {
    const el = document.createElement('div');
    el.className = 'rle-no-matches';
    el.textContent = text;
    return el;
  }

  function showMatches(selectedText) {
    if (!state.refs.length) {
      toast('Upload a reference file first', 'error');
      return;
    }

    popupSel.textContent = `Matches for "${selectedText}"`;
    const { searchInput, fuzzyLabel, fuzzyList, allLabel, allList } = buildPopupShell();
    populateMatches(selectedText, fuzzyLabel, fuzzyList, allLabel, allList, searchInput);

    state.justOpened = true;
    popup.hidden = false;
  }

  function linkSelection(refItem) {
    if (!state.savedRange) return;
    try {
      // Compute raw-text offsets BEFORE the DOM is mutated below — the
      // rendered text itself is unaffected by wrapping it in an <a>, so
      // offsets taken now stay valid after insertion.
      const selectedText = state.savedRange.toString();
      const offsets = findRawOffsets(selectedText, state.savedRange);
      if (!offsets) {
        toast('Could not locate exact position — try re-selecting', 'error');
        return;
      }
      const { rawStart, rawEnd } = offsets;

      const href = `${state.refFileName}#${refItem.id}`;

      const a = document.createElement('a');
      a.setAttribute('href', href);
      a.classList.add('rle-citation', 'linked');
      saveUndoSnapshot();

      const range = state.savedRange;
      const fragment = range.extractContents();

      // extractContents() splits inline elements like <b> and <i> at the
      // selection boundary — the fragment gets a partial <b> wrapper that
      // produces invalid nesting like <a><b>text</b></a></p></a>.
      // Fix: unwrap all inline elements inside the fragment so the <a>
      // tag itself is the only wrapper. The visual styling is preserved
      // because the parent DOM still has the outer <b>/<i> around the <a>.
      // Detect inline tags that were split by extractContents() —
      // these appear in the fragment as elements whose counterpart closing
      // tag still exists in the DOM immediately after the insertion point.
      // Strategy: collect any split inline tags from the fragment, keep them
      // intact inside <a>, then reopen them after </a> in the DOM.
      const INLINE_TAGS = ['B', 'I', 'EM', 'STRONG', 'U', 'SPAN', 'SUP', 'SUB'];

      // Find inline elements at the END of the fragment that were split
      // (i.e. their tag also exists as an ancestor of range.endContainer
      //  in the original DOM before extraction).
      function getTrailingSplitInlines(frag, range) {
        const split = [];
        // Walk the last child chain of the fragment
        let node = frag.lastChild;
        while (node && node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.includes(node.tagName)) {
          split.unshift(node); // outermost first
          node = node.lastChild;
        }
        return split;
      }

      const splitInlines = getTrailingSplitInlines(fragment, range);

      a.appendChild(fragment);
      range.insertNode(a);

      // Reopen split inline tags after the <a> so structure is valid:
      // Before: <i>text <a href="...">et</i></a> al.</i>  (broken)
      // After:  <i>text <a href="...">et</a></i><i> al.</i>  (valid)
      if (splitInlines.length) {
        let insertAfter = a;
        splitInlines.forEach(inlineEl => {
          // The DOM already has the remainder of the split inline after <a>
          // (the part that stayed in the original DOM after extractContents).
          // We need to close our <a> before it and wrap the remainder.
          // Find the next sibling inline that matches this tag
          let sibling = a.nextSibling;
          while (sibling && !(sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === inlineEl.tagName)) {
            sibling = sibling.nextSibling;
          }
          if (sibling) {
            // Move sibling contents into a new inline wrapper after <a>
            const reopened = document.createElement(inlineEl.tagName.toLowerCase());
            // Copy attributes (e.g. class, style) from the split element
            [...inlineEl.attributes].forEach(attr => reopened.setAttribute(attr.name, attr.value));
            // Move all children of the leftover sibling into reopened
            while (sibling.firstChild) reopened.appendChild(sibling.firstChild);
            sibling.parentNode.replaceChild(reopened, sibling);
            insertAfter = reopened;
          }
        });
      }

      // Rescue any pagebreak spans swallowed inside the <a> and move them after it
      const swallowed = [...a.querySelectorAll(
        'span[epub\\:type="pagebreak"], span[role="doc-pagebreak"], span[id^="page_"]'
      )];
      swallowed.forEach(span => {
        a.parentNode.insertBefore(span, a.nextSibling);
      });

      state.linkEdits.push({
        start: rawStart,
        end: rawEnd,
        openTag: `<a href="${href}">`,
        closeTag: '</a>',
        id: refItem.id,
        domAnchor: a
      });

      toast(`Linked to ${refItem.author}`, 'success');
      renderCitationList();
    } catch (e) {
      toast('Could not link selection: ' + e.message, 'error');
    } finally {
      closePopup();
    }
  }

  function closePopup() {
    popup.hidden = true;
    state.savedRange = null;
    state.changingAnchor = null;
  }
  popupClose.addEventListener('click', closePopup);

  document.addEventListener('click', (e) => {
    if (state.justOpened) {
      state.justOpened = false;
      return;
    }
    if (!popup.hidden
        && !popup.contains(e.target)
        && !contentArea.contains(e.target)
        && !e.target.closest('a.rle-citation')) {
      closePopup();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.hidden) closePopup();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (document.querySelector('.tab-btn[data-tab="3"]')
          ?.classList.contains('active')) {
        e.preventDefault();
        if (!state.undoStack.length) {
          toast('Nothing to undo', '');
          return;
        }
        const snap = state.undoStack.pop();
        contentArea.innerHTML = snap.html;
        state.linkEdits = snap.edits.map(e => ({ ...e, domAnchor: null }));
        linkDomAnchorsToEdits();
        renderCitationList();
        toast('Undo successful', 'success');
      }
    }
  });

  /* ── sidebar: citation list ── */
  function renderCitationList() {
    const citations = [...contentArea.querySelectorAll('a.rle-citation')];
    sidebarCount.textContent = citations.length;

    // Remove all existing badges first
    contentArea.querySelectorAll('.rle-cite-badge').forEach(b => b.remove());

    // Inject number badge after each citation anchor
    citations.forEach((a, i) => {
      const badge = document.createElement('span');
      badge.className = 'rle-cite-badge';
      badge.textContent = i + 1;
      badge.dataset.citationIndex = i;
      badge.title = `Citation ${i + 1}`;
      // Insert badge immediately after the anchor
      a.insertAdjacentElement('afterend', badge);

      // Click badge → highlight sidebar item
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        highlightSidebarItem(i);
      });
    });

    if (!citations.length) {
      sidebarBody.innerHTML = '<div class="rle-sidebar-empty">No citations linked yet.<br>Select text in the document to link it.</div>';
      return;
    }

    sidebarBody.innerHTML = '';

    citations.forEach((a, i) => {
      const item = document.createElement('div');
      const isAuto = state.linkEdits.find(e => e.domAnchor === a && e.auto);
      item.className = 'rle-citation-item' + (isAuto ? ' auto-linked' : '');
      item.dataset.citationIndex = i;

      // Number badge
      const num = document.createElement('span');
      num.className = 'rle-sidebar-num';
      num.textContent = i + 1;

      // Body wrapper
      const body = document.createElement('div');
      body.className = 'rle-citation-item-body';

      const author = document.createElement('div');
      author.className = 'rle-citation-author';
      const isAutoItem = state.linkEdits.find(e => e.domAnchor === a && e.auto);
      author.textContent = a.textContent.trim();
      if (isAutoItem) {
        const tag = document.createElement('span');
        tag.className = 'rle-auto-tag';
        tag.textContent = 'auto';
        author.appendChild(tag);
      }

      const href = document.createElement('div');
      href.className = 'rle-citation-href';
      href.textContent = a.getAttribute('href');

      const actions = document.createElement('div');
      actions.className = 'rle-citation-actions';

      const changeBtn = document.createElement('button');
      changeBtn.className = 'rle-citation-btn';
      changeBtn.textContent = 'Change';
      changeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.popupMode = 'change';
        state.changingAnchor = a;
        const selectedText = a.textContent.trim();
        popupSel.textContent = `Change citation for "${selectedText}"`;
        const { searchInput, fuzzyLabel, fuzzyList, allLabel, allList } = buildPopupShell();
        populateMatches(selectedText, fuzzyLabel, fuzzyList, allLabel, allList, searchInput);

        // Position popup near the Change button
        const rect = changeBtn.getBoundingClientRect();
        popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - 420) + 'px';
        popup.style.left = Math.max(rect.left - 340, 8) + 'px';
        state.justOpened = true;
        popup.hidden = false;
      });

      const unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'rle-citation-btn danger';
      unlinkBtn.textContent = 'Unlink';
      unlinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveUndoSnapshot();
        // Remove badge next to this anchor before unlinking
        const nextEl = a.nextElementSibling;
        if (nextEl && nextEl.classList.contains('rle-cite-badge')) nextEl.remove();

        const editIdx = state.linkEdits.findIndex(edit => edit.domAnchor === a);
        if (editIdx !== -1) state.linkEdits.splice(editIdx, 1);

        const text = document.createTextNode(a.textContent);
        a.replaceWith(text);
        toast('Citation unlinked', 'success');
        renderCitationList();
      });

      // Click item body → scroll anchor into view in content
      item.addEventListener('click', () => {
        highlightSidebarItem(i);
        a.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      actions.appendChild(changeBtn);
      actions.appendChild(unlinkBtn);
      body.appendChild(author);
      body.appendChild(href);
      body.appendChild(actions);
      item.appendChild(num);
      item.appendChild(body);
      sidebarBody.appendChild(item);
    });
  }

  function highlightSidebarItem(index) {
    // Clear all highlights
    sidebarBody.querySelectorAll('.rle-citation-item').forEach(el => {
      el.classList.remove('highlighted', 'active');
    });
    contentArea.querySelectorAll('.rle-cite-badge').forEach(b => {
      b.classList.remove('active');
    });

    // Highlight matching sidebar item
    const targetItem = sidebarBody.querySelector(`.rle-citation-item[data-citation-index="${index}"]`);
    if (targetItem) {
      targetItem.classList.add('highlighted', 'active');
      targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Highlight matching badge in content
    const targetBadge = contentArea.querySelector(`.rle-cite-badge[data-citation-index="${index}"]`);
    if (targetBadge) {
      targetBadge.classList.add('active');
      setTimeout(() => targetBadge.classList.remove('active'), 1500);
    }
  }

  /* ── copy ──
     Export is built by re-wrapping rawStrippedText with linkEdits at their
     raw offsets — the original file text otherwise untouched. No DOM
     round-trip (DOMParser/XMLSerializer) — the DOM/contentArea is preview
     and interaction only, never the export source. */
  function checkAutoLinkReady() {
    if (state.refs.length && state.rawStrippedText) {
      autoLinkBtn.hidden = false;
    }
  }

  /* ── Auto Linker ── */
  autoLinkBtn.addEventListener('click', runAutoLink);

  function runAutoLink() {
    if (!state.refs.length || !state.rawStrippedText) return;

    saveUndoSnapshot();
    autoLinkBtn.disabled = true;
    autoLinkBtn.querySelector('span').textContent = 'Linking...';

    // Build lookup: firstSurname (lowercase) → [ref, ...]
    const refMap = {};
    state.refs.forEach(ref => {
      const key = (ref.firstSurname || '').toLowerCase();
      if (!key) return;
      if (!refMap[key]) refMap[key] = [];
      refMap[key].push(ref);
    });

    function findRef(firstSurname, year) {
      const candidates = refMap[firstSurname.toLowerCase()] || [];
      return candidates.find(r => r.year === year)
          || candidates.find(r => r.fullText.includes(`(${year})`))
          || null;
    }

    // Decode HTML entities for matching
    function decodeForMatch(str) {
      return str
        .replace(/&#x0026;/gi, '&').replace(/&amp;/gi, '&')
        .replace(/&#38;/gi, '&').replace(/&#x26;/gi, '&');
    }

    // We scan rawStrippedText directly (not decoded) so positions are exact.
    // The TOKEN_RE handles & written as literal & (after XML parsing into DOM
    // the chapter content has real & not entities — rawStrippedText is the
    // serialized original so entities like &#x0026; appear as-is in tags but
    // the TEXT content between tags is plain after DOMParser import).
    // BRACKET_RE finds (...) blocks; positions are into rawStrippedText.
    const rawDecoded = state.rawStrippedText; // use raw directly — no decode needed

    // ── TWO LINKING RULES ──
    // Rule 1: full citation inside brackets → (Author Year) / (Author et al. Year)
    // Rule 2: year in brackets, author before → Author (Year) / Author et al. (Year)
    // Strategy:
    // Scan A — BRACKET_RE finds (...) blocks → TOKEN_RE inside each block [Rule 1]
    // Scan B — AUTHOR_YEAR_RE finds Author (Year) patterns directly [Rule 2]

    // Known two-word institutions that appear as "Word1 Word2 Year"
    // These must be matched as a unit, not split at Word2
    const TWO_WORD_INSTITUTIONS = [
      'World Bank', 'World Resources', 'World Wildlife',
      'United Nations', 'Royal Society'
    ];

    // Slash-separated acronym institutions: IUCN/UNEP/WWF → last segment used for lookup
    // Matches: IUCN/UNEP/WWF, FAO/UNEP, etc.
    const SLASH_ACRONYM_RE = /([A-Z]{2,}(?:\/[A-Z]{2,})+)\s*,?\s*((?:19|20)\d{2}[a-z]?)/g;

    // Two-word institution regex: "World Bank Year", "Royal Society Year"
    // Built dynamically from the list above
    const twoWordPattern = TWO_WORD_INSTITUTIONS
      .map(inst => inst.replace(/\s+/, '\\s+'))
      .join('|');
    const TWO_WORD_RE = new RegExp(
      `(${twoWordPattern})(?:\\s*,)?\\s*((?:19|20)\\d{2}[a-z]?)`,
      'g'
    );

    // Main citation TOKEN_RE — matches one citation token inside a bracket block.
    // Handles:
    //   Single: "FAO 1991" / "Branch 1983"
    //   Two-author: "Whitmore & Sayer 1992" / "Palmer & Synnott 1992"
    //   et al.: "Burghouts et al. 1992" / "Cannon et al 1994"
    //   Initial prefix: "A. Johns 1992" → skip leading "X. " initials
    // NOTE: two-word institutions handled separately by TWO_WORD_RE
    const TOKEN_RE = /(?:[A-Z]\.\s+)?([A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?(?:(?:\s*(?:&|and)\s*[A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?)|(?:\s+et\.?\s*al\.?))?|[A-Z]{2,})(?:\s*,)?\s*((?:19|20)\d{2}[a-z]?)/g;

    const alreadyLinked = new Set(
      [...contentArea.querySelectorAll('a.rle-citation')].map(a => a.getAttribute('href'))
    );

    const finalMatches = [];

    // Helper: check overlap with existing linkEdits
    function isOverlapping(rawStart, rawEnd) {
      return state.linkEdits.some(e =>
        (rawStart >= e.start && rawStart < e.end) ||
        (rawEnd > e.start && rawEnd <= e.end)
      );
    }

    // Helper: push a match if ref found and not already linked/overlapping
    function tryPushMatch(rawStart, rawEnd, authorToken, year, blockMatches) {
      const firstSurnameMatch = authorToken.match(
        /^([A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?|[A-Z]{2,})/
      );
      if (!firstSurnameMatch) return;
      const firstSurname = firstSurnameMatch[1];

      const ref = findRef(firstSurname, year);
      if (!ref) return;

      const href = `${state.refFileName}#${ref.id}`;
      if (alreadyLinked.has(href)) return;
      if (isOverlapping(rawStart, rawEnd)) return;

      blockMatches.push({ rawStart, rawEnd, ref, href });
    }

    // Build a tag-stripped, entity-decoded version of a block string for regex matching.
    // Returns { clean, cleanToRaw } where cleanToRaw[i] = position in original blockContent.
    function buildCleanBlock(blockContent) {
      let clean = '';
      const cleanToRaw = []; // cleanToRaw[cleanIndex] = rawIndex in blockContent
      let i = 0;
      while (i < blockContent.length) {
        if (blockContent[i] === '<') {
          // Skip entire tag
          const close = blockContent.indexOf('>', i);
          if (close === -1) break;
          i = close + 1;
        } else if (blockContent[i] === '&') {
          const semi = blockContent.indexOf(';', i);
          if (semi !== -1 && semi - i <= 10) {
            const entity = blockContent.slice(i, semi + 1);
            const decoded = decodeEntity(entity);
            if (decoded !== null) {
              cleanToRaw.push(i); // map the decoded char to the entity start
              clean += decoded;
              i = semi + 1;
              continue;
            }
          }
          cleanToRaw.push(i);
          clean += blockContent[i];
          i++;
        } else {
          cleanToRaw.push(i);
          clean += blockContent[i];
          i++;
        }
      }
      return { clean, cleanToRaw };
    }

    // Regex to find parenthesised blocks — non-greedy, no nested parens
    const BRACKET_RE = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

    let bm;
    BRACKET_RE.lastIndex = 0;

    while ((bm = BRACKET_RE.exec(state.rawStrippedText)) !== null) {
      const blockContent = bm[1];
      const blockStart = bm.index + 1;
      const blockMatches = [];

      // Build tag-stripped, entity-decoded block for regex matching
      const { clean: cleanBlock, cleanToRaw } = buildCleanBlock(blockContent);

      // Helper: translate a [cleanStart, cleanEnd) match in cleanBlock
      // back to rawStart/rawEnd in rawStrippedText.
      function cleanToRawRange(cleanStart, cleanEnd) {
        const rawRel0 = cleanToRaw[cleanStart] !== undefined ? cleanToRaw[cleanStart] : blockContent.length;
        // rawEnd: position AFTER the last matched clean char
        const lastCleanIdx = cleanEnd - 1;
        let rawRel1;
        if (lastCleanIdx >= 0 && cleanToRaw[lastCleanIdx] !== undefined) {
          // Advance past this raw char (or entity)
          let ri = cleanToRaw[lastCleanIdx];
          if (blockContent[ri] === '&') {
            const semi = blockContent.indexOf(';', ri);
            rawRel1 = semi !== -1 ? semi + 1 : ri + 1;
          } else {
            rawRel1 = ri + 1;
          }
        } else {
          rawRel1 = blockContent.length;
        }
        return { rawStart: blockStart + rawRel0, rawEnd: blockStart + rawRel1 };
      }

      // Pass 1: two-word institutions — "World Bank 1991"
      TWO_WORD_RE.lastIndex = 0;
      let tw;
      while ((tw = TWO_WORD_RE.exec(cleanBlock)) !== null) {
        const institution = tw[1].trim();
        const year = tw[2];
        // Use last word of institution as lookup key (e.g. "Bank" for "World Bank")
        // But also try full institution and first word
        const words = institution.split(/\s+/);
        let ref = findRef(words[words.length - 1], year)  // last word
               || findRef(words[0], year)                  // first word
               || findRef(institution.replace(/\s+/g, ''), year); // no space
        if (!ref) continue;
        const href = `${state.refFileName}#${ref.id}`;
        if (alreadyLinked.has(href)) continue;
        const { rawStart, rawEnd } = cleanToRawRange(tw.index, tw.index + tw[0].length);
        if (isOverlapping(rawStart, rawEnd)) continue;
        blockMatches.push({ rawStart, rawEnd, ref, href });
      }

      // Pass 2: slash-separated acronyms — "IUCN/UNEP/WWF 1991"
      SLASH_ACRONYM_RE.lastIndex = 0;
      let sa;
      while ((sa = SLASH_ACRONYM_RE.exec(cleanBlock)) !== null) {
        const acronymGroup = sa[1]; // e.g. "IUCN/UNEP/WWF"
        const year = sa[2];
        // Try each segment as lookup key, last one first
        const segments = acronymGroup.split('/').reverse();
        let ref = null;
        for (const seg of segments) {
          ref = findRef(seg, year);
          if (ref) break;
        }
        if (!ref) continue;
        const href = `${state.refFileName}#${ref.id}`;
        if (alreadyLinked.has(href)) continue;
        const { rawStart, rawEnd } = cleanToRawRange(sa.index, sa.index + sa[0].length);
        if (isOverlapping(rawStart, rawEnd)) continue;
        blockMatches.push({ rawStart, rawEnd, ref, href });
      }

      // Pass 3: standard TOKEN_RE — single, two-author, et al.
      TOKEN_RE.lastIndex = 0;
      let tm;
      while ((tm = TOKEN_RE.exec(cleanBlock)) !== null) {
        const authorPart = tm[1].trim();
        const year = tm[2];

        // Skip if this position already covered by Pass 1 or 2
        const { rawStart: tmRawStart, rawEnd: tmRawEnd } = cleanToRawRange(tm.index, tm.index + tm[0].length);
        const alreadyCovered = blockMatches.some(m =>
          tmRawStart >= m.rawStart && tmRawEnd <= m.rawEnd
        );
        if (alreadyCovered) continue;

        tryPushMatch(tmRawStart, tmRawEnd, authorPart, year, blockMatches);
      }

      // Pass 4: chained years — "FAO 1981, 1988, 1991a"
      // Run after all base matches collected
      const baseMatches = [...blockMatches];
      baseMatches.forEach(base => {
        const CHAIN_RE = /,\s*((?:19|20)\d{2}[a-z]?)/g;
        // Find the clean position corresponding to raw relative end
        const rawRelEnd = base.rawEnd - blockStart;
        let cleanRelEnd = cleanToRaw.findIndex(r => r >= rawRelEnd);
        if (cleanRelEnd === -1) cleanRelEnd = cleanBlock.length;
        CHAIN_RE.lastIndex = cleanRelEnd;
        let lastRelEnd = cleanRelEnd;
        let c;

        while ((c = CHAIN_RE.exec(cleanBlock)) !== null) {
          if (c.index !== lastRelEnd) break;
          const chainYear = c[1];
          const chainRef = findRef(base.ref.firstSurname, chainYear);
          if (!chainRef) break;

          const href = `${state.refFileName}#${chainRef.id}`;
          if (alreadyLinked.has(href)) break;

          const commaLen = c[0].indexOf(chainYear);
          const { rawStart, rawEnd } = cleanToRawRange(c.index + commaLen, c.index + c[0].length);
          if (isOverlapping(rawStart, rawEnd)) break;

          blockMatches.push({ rawStart, rawEnd, ref: chainRef, href });
          lastRelEnd = c.index + c[0].length;
          CHAIN_RE.lastIndex = lastRelEnd;
        }
      });

      finalMatches.push(...blockMatches);
    }

    // ── Scan B: Author (Year) pattern — Rule 2 ──
    // Matches: "Sayer et al. (1992)" / "WRI (1994)" / "Collins et al. (1991)"
    // Also handles: "Mergen & Vincent (1987)" / "Branch (1983)"
    // Does NOT re-link positions already covered by Scan A
    const AUTHOR_YEAR_RE = new RegExp(
      // Optional leading initial: "A. Johns"
      '(?:[A-Z]\\.\\s+)?' +
      // Author part — same as TOKEN_RE author section
      '(' +
        '(?:[A-Z][A-Za-záéíóúñ\\-]+' +
        '(?:\\s+(?:de|van|von|le|la|du|der|den)\\s+[A-Z][A-Za-z\\-]+)?' +
        '(?:(?:\\s*(?:&|and)\\s*[A-Z][A-Za-z\\-]+(?:\\s+(?:de|van|von|le|la|du|der|den)\\s+[A-Z][A-Za-z\\-]+)?)|(?:\\s+et\\.?\\s*al\\.?))?' +
        '|[A-Z]{2,})' +
      ')' +
      // Year MUST be in brackets: (1992) or (1992a)
      '\\s*\\(((?:19|20)\\d{2}[a-z]?)\\)',
      'g'
    );

    // Build tag-stripped + entity-decoded version of rawStrippedText for Scan B.
    // Strips inline tags (<i>, <b>, <em>, etc.) and decodes HTML entities.
    // decodedBMap[decodedIdx] = rawIdx in rawStrippedText.
    let decodedB = '';
    const decodedBMap = [];
    (function buildDecodedB() {
      const raw = state.rawStrippedText;
      const INLINE_TAG_RE = /^<\/?(i|b|em|strong|u|sup|sub|span|sc|small)(\s[^>]*)?\s*\/?>/i;
      let i = 0;
      while (i < raw.length) {
        if (raw[i] === '<') {
          // Check if it's an inline tag — strip it (don't add to decodedB)
          const rest = raw.slice(i);
          const tagMatch = INLINE_TAG_RE.exec(rest);
          if (tagMatch) {
            i += tagMatch[0].length;
            continue;
          }
          // Non-inline tag — keep as-is (so block boundaries still exist)
          const close = raw.indexOf('>', i);
          if (close === -1) break;
          // Don't map these — they're not text chars
          i = close + 1;
          continue;
        }
        if (raw[i] === '&') {
          const semi = raw.indexOf(';', i);
          if (semi !== -1 && semi - i <= 10) {
            const entity = raw.slice(i, semi + 1);
            const decoded = decodeEntity(entity);
            if (decoded !== null) {
              decodedBMap.push(i);
              decodedB += decoded;
              i = semi + 1;
              continue;
            }
          }
        }
        decodedBMap.push(i);
        decodedB += raw[i];
        i++;
      }
    })();

    // Translate [dStart, dEnd) in decodedB back to rawStrippedText offsets.
    function decodedBToRaw(dStart, dEnd) {
      const rawStart = decodedBMap[dStart] !== undefined
        ? decodedBMap[dStart]
        : state.rawStrippedText.length;
      const lastD = dEnd - 1;
      let rawEnd;
      if (lastD >= 0 && decodedBMap[lastD] !== undefined) {
        let ri = decodedBMap[lastD];
        if (state.rawStrippedText[ri] === '&') {
          const semi = state.rawStrippedText.indexOf(';', ri);
          rawEnd = semi !== -1 ? semi + 1 : ri + 1;
        } else {
          rawEnd = ri + 1;
        }
      } else {
        rawEnd = state.rawStrippedText.length;
      }
      return { rawStart, rawEnd };
    }

    AUTHOR_YEAR_RE.lastIndex = 0;
    let ay;
    while ((ay = AUTHOR_YEAR_RE.exec(decodedB)) !== null) {
      const authorPart = ay[1].trim();
      const year = ay[2];

      // Full match includes "Author (Year)" — we link just "Author" part
      // rawStart = start of author, rawEnd = end of closing bracket
      const { rawStart, rawEnd } = decodedBToRaw(ay.index, ay.index + ay[0].length);

      // Skip if already covered by Scan A
      const alreadyCovered = finalMatches.some(m =>
        rawStart >= m.rawStart && rawEnd <= m.rawEnd
      );
      if (alreadyCovered) continue;

      // Skip if overlaps existing linkEdits
      if (isOverlapping(rawStart, rawEnd)) continue;

      // Extract first surname
      const firstSurnameMatch = authorPart.match(
        /^([A-Z][A-Za-záéíóúñ\-]+(?:\s+(?:de|van|von|le|la|du|der|den)\s+[A-Z][A-Za-záéíóúñ\-]+)?|[A-Z]{2,})/
      );
      if (!firstSurnameMatch) continue;
      const firstSurname = firstSurnameMatch[1];

      const ref = findRef(firstSurname, year);
      if (!ref) continue;

      const href = `${state.refFileName}#${ref.id}`;
      if (alreadyLinked.has(href)) continue;

      finalMatches.push({ rawStart, rawEnd, ref, href });
    }

    // Sort by position, remove overlaps
    finalMatches.sort((a, b) => a.rawStart - b.rawStart);
    const deduped = [];
    let lastEnd = -1;
    finalMatches.forEach(match => {
      if (match.rawStart >= lastEnd) {
        deduped.push(match);
        lastEnd = match.rawEnd;
      }
    });

    if (!deduped.length) {
      toast('No new citations found to auto-link', 'warning');
      autoLinkBtn.disabled = false;
      autoLinkBtn.querySelector('span').textContent = 'Auto Link';
      return;
    }

    // Push to linkEdits in reverse order
    [...deduped].reverse().forEach(match => {
      state.linkEdits.push({
        start: match.rawStart,
        end: match.rawEnd,
        openTag: `<a href="${match.href}">`,
        closeTag: '</a>',
        id: match.ref.id,
        domAnchor: null,
        auto: true
      });
    });

    applyLinkEditsToDom();

    autoLinkBtn.disabled = false;
    autoLinkBtn.querySelector('span').textContent = 'Auto Link';
    toast(`Auto-linked ${deduped.length} citation${deduped.length === 1 ? '' : 's'}`, 'success');
    renderCitationList();
  }

  function applyLinkEditsToDom() {
    // Reset all domAnchors — old DOM nodes are about to be destroyed
    state.linkEdits.forEach(e => { e.domAnchor = null; });

    // Rebuild rawStrippedText with all linkEdits applied
    let text = state.rawStrippedText;
    const sortedDesc = [...state.linkEdits].sort((a, b) => b.start - a.start);
    sortedDesc.forEach(edit => {
      text = text.slice(0, edit.start) + edit.openTag
           + text.slice(edit.start, edit.end) + edit.closeTag
           + text.slice(edit.end);
    });

    // Parse and render into contentArea
    const doc = parseXhtml(text);
    const body = doc ? doc.querySelector('body') : null;
    contentArea.innerHTML = '';
    if (body) {
      Array.from(body.childNodes).forEach(node => {
        contentArea.appendChild(document.importNode(node, true));
      });
    } else {
      contentArea.innerHTML = text;
    }

    // Re-classify anchors by matching edit start position via data attribute
    // Sort edits by start ascending to match DOM order
    const editsByOrder = [...state.linkEdits].sort((a, b) => a.start - b.start);
    const anchors = [...contentArea.querySelectorAll('a[href]')];

    // Match each anchor to its edit by order (DOM order == edit insertion order)
    let editIdx = 0;
    anchors.forEach(a => {
      const href = a.getAttribute('href');
      // Find next unmatched edit whose href matches
      let found = null;
      for (let i = editIdx; i < editsByOrder.length; i++) {
        const e = editsByOrder[i];
        if (`${state.refFileName}#${e.id}` === href && e.domAnchor === null) {
          found = e;
          editIdx = i + 1;
          break;
        }
      }
      if (!found) {
        // fallback — find any matching unmatched edit
        found = state.linkEdits.find(e =>
          `${state.refFileName}#${e.id}` === href && e.domAnchor === null
        );
      }
      if (!found) return;
      found.domAnchor = a;
      a.classList.add('rle-citation');
      if (found.auto) {
        a.classList.add('rle-auto-linked');
      } else {
        a.classList.add('already-linked');
      }
    });

    highlightYears(contentArea);
  }

  copyBtn.addEventListener('click', () => {
    if (!state.rawStrippedText) return;

    const edits = [...state.linkEdits].sort((a, b) => b.start - a.start);
    let text = state.rawStrippedText;
    edits.forEach(edit => {
      text = text.slice(0, edit.start) + edit.openTag
           + text.slice(edit.start, edit.end) + edit.closeTag
           + text.slice(edit.end);
    });

    // Fix crossed inline/<a> tag nesting at copy time.
    // Pattern 1: <b><a href="...">text</b></a>  →  <b><a href="...">text</a></b>
    // Pattern 2: <a href="...">Poore <i>et</a> al.</i>  →  <a href="...">Poore <i>et</i></a><i> al.</i>
    const INLINE = 'i|b|em|strong|u|sup|sub';

    // Pattern 1: inline wraps the opening of <a>, closes before </a>
    // Match is kept tight: [^<]* instead of [\s\S]*? to avoid crossing tags
    let prev = '';
    while (prev !== text) {
      prev = text;
      const p1 = new RegExp(
        `(<(${INLINE})(?:\\s[^>]*)?>)(<a\\b[^>]*>)([^<]*(?:<(?!\\/?(?:${INLINE})\\b)[^>]*>[^<]*)*)</(${INLINE})>(</a>)`,
        'gi'
      );
      text = text.replace(p1, (m, openInline, tag1, openA, inner, tag2, closeA) => {
        if (tag1.toLowerCase() !== tag2.toLowerCase()) return m;
        return `${openInline}${openA}${inner}</a></${tag2}>`;
      });
    }

    // Pattern 2: <a> opens, inline opens inside, <a> closes mid-inline, inline closes after
    prev = '';
    while (prev !== text) {
      prev = text;
      const p2 = new RegExp(
        `(<a\\b[^>]*>)([^<]*(?:<(?!\\/?(${INLINE})\\b)[^>]*>[^<]*)*)(<(${INLINE})(?:\\s[^>]*)?>)([^<]*)</a>([^<]*)</(${INLINE})>`,
        'gi'
      );
      text = text.replace(p2, (m, openA, before, _t, openInline, tag1, inside, after, tag2) => {
        if (tag1.toLowerCase() !== tag2.toLowerCase()) return m;
        return `${openA}${before}${openInline}${inside}</${tag1}></a><${tag1}>${after}</${tag2}>`;
      });
    }

    navigator.clipboard.writeText(text)
      .then(() => toast('XHTML copied to clipboard!', 'success'))
      .catch(() => toast('Copy failed — try again', 'error'));
  });

  /* ── helpers ── */
  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  /* ── ID extract ── */
  async function runIdExtract() {
    // Validate prerequisites
    if (!state.refs.length) {
      toast('Load a Reference file first (Step 1)', 'error');
      return;
    }
    if (!state.folderFiles.length) {
      toast('Select a folder first (Step 3)', 'error');
      return;
    }

    extractBtn.disabled = true;
    extractBtn.querySelector('span').textContent = 'Extracting...';

    // Read all folder files content
    const fileContents = await Promise.all(
      state.folderFiles.map(file =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve({ name: file.name, content: e.target.result });
          reader.readAsText(file, 'utf-8');
        })
      )
    );

    // For each ref id → add extra r → search folder files
    const rows = state.refs.map(ref => {
      const refId  = ref.id;                              // e.g. bm2_ref2
      const rrefId = refId.replace('_ref', '_rref');      // e.g. bm2_rref2

      const foundIn = fileContents.filter(f =>
        f.content.includes(`id="${rrefId}"`)
      ).map(f => f.name);

      return { refId, rrefId, author: ref.author, foundIn };
    });

    // Render table
    extractTbody.innerHTML = '';

    rows.forEach(row => {
      const tr = document.createElement('tr');

      // Ref ID
      const tdRef = document.createElement('td');
      tdRef.innerHTML = `<span class="rle-ref-id">${row.refId}</span>`;

      // Body rref ID
      const tdRref = document.createElement('td');
      tdRref.innerHTML = `<span class="rle-rref-id">${row.rrefId}</span>`;

      // Found In
      const tdFiles = document.createElement('td');
      const filesWrap = document.createElement('div');
      filesWrap.className = 'rle-found-files';

      if (!row.foundIn.length) {
        const tag = document.createElement('span');
        tag.className = 'rle-extract-file-tag not-found';
        tag.innerHTML = '<i data-lucide="x-circle" style="width:11px;height:11px"></i> Not found';
        filesWrap.appendChild(tag);
      } else {
        row.foundIn.forEach(fname => {
          const tag = document.createElement('span');
          tag.className = 'rle-extract-file-tag found';
          tag.innerHTML = `<i data-lucide="file-text" style="width:11px;height:11px"></i> ${fname}`;
          filesWrap.appendChild(tag);
        });
      }
      tdFiles.appendChild(filesWrap);

      // Count
      const tdCount = document.createElement('td');
      const count = row.foundIn.length;
      tdCount.innerHTML = `<span class="rle-extract-count ${count === 0 ? 'zero' : ''}">${count}</span>`;

      tr.appendChild(tdRef);
      tr.appendChild(tdRref);
      tr.appendChild(tdFiles);
      tr.appendChild(tdCount);
      extractTbody.appendChild(tr);
    });

    // Summary bar
    const existing = document.querySelector('.rle-extract-summary');
    if (existing) existing.remove();
    const total   = rows.length;
    const found   = rows.filter(r => r.foundIn.length > 0).length;
    const missing = total - found;
    const summary = document.createElement('div');
    summary.className = 'rle-extract-summary';
    summary.innerHTML = `
      <span>Total: <strong>${total}</strong></span>
      <span style="color:var(--pass,#22c55e)">Found: <strong>${found}</strong></span>
      <span style="color:var(--fail,#ef4444)">Missing: <strong>${missing}</strong></span>
    `;
    extractResults.insertBefore(summary, extractResults.firstChild);

    extractEmpty.hidden = true;
    extractResults.hidden = false;
    extractCopyBtn.disabled = false;

    extractBtn.disabled = false;
    extractBtn.querySelector('span').textContent = 'Extract IDs';

    if (window.lucide) lucide.createIcons();
    toast(`Extracted ${total} IDs — ${found} found, ${missing} missing`, found === total ? 'success' : 'warning');
  }

  extractCopyBtn.addEventListener('click', () => {
    const rows = [...extractTbody.querySelectorAll('tr')];
    const lines = ['Ref ID\tBody ID\tFound In\tCount'];
    rows.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      const refId  = cells[0].textContent.trim();
      const rrefId = cells[1].textContent.trim();
      const files  = [...cells[2].querySelectorAll('.rle-extract-file-tag')]
                       .map(t => t.textContent.trim()).join(', ');
      const count  = cells[3].textContent.trim();
      lines.push(`${refId}\t${rrefId}\t${files}\t${count}`);
    });
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => toast('Report copied to clipboard!', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  });

  extractBtn.addEventListener('click', runIdExtract);

  // RLE inner tab switching
  document.querySelectorAll('.rle-inner-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rle-inner-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.rle-inner-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(`rlePane-${btn.dataset.rleTab}`);
      if (pane) pane.classList.add('active');
      if (window.lucide) lucide.createIcons();
    });
  });

})();
