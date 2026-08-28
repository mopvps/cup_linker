'use strict';

/* ── State ── */
const clState = {
  folderFiles:     [],
  fileIndex:       [],  // [{ name, headings:[{ level, id, text }] }]
  contentFileName: '',
  contentRaw:      '',
  results:         [],  // [{ tocText, resolved, status }]
  resolvedContent: '',
};
let clDupeHrefs = new Set();

/* ── DOM ── */
const clFolderPickBtn  = document.getElementById('clFolderPickBtn');
const clFolderInput    = document.getElementById('clFolderInput');
const clFolderPickText = document.getElementById('clFolderPickText');
const clFolderStatus   = document.getElementById('clFolderStatus');
const clFolderCheck    = document.getElementById('clFolderCheck');
const clStep1          = document.getElementById('clStep1');

const clFilePickBtn    = document.getElementById('clFilePickBtn');
const clFileInput      = document.getElementById('clFileInput');
const clFilePickText   = document.getElementById('clFilePickText');
const clFileStatus     = document.getElementById('clFileStatus');
const clFileCheck      = document.getElementById('clFileCheck');
const clStep2          = document.getElementById('clStep2');

const clProcessBtn     = document.getElementById('clProcessBtn');
const clEmptyState     = document.getElementById('clEmptyState');
const clWorkspace      = document.getElementById('clWorkspace');
const clContentArea    = document.getElementById('clContentArea');
const clResultsList    = document.getElementById('clResultsList');
const clStatMatched    = document.getElementById('clStatMatched');
const clStatUnresolved = document.getElementById('clStatUnresolved');
const clStatDupe       = document.getElementById('clStatDupe');
const clProgressBar     = document.getElementById('clProgressBar');
const clProgressBarWrap = document.getElementById('clProgressBarWrap');
const clProgressText    = document.getElementById('clProgressText');

function updateProgressBar() {
  const total   = clState.results.length;
  const matched = clState.results.filter(r => r.status === 'matched').length;
  const pct     = total ? (matched / total * 100).toFixed(1) : 0;
  clProgressBar.style.width = pct + '%';
  clProgressText.textContent = matched + ' / ' + total;
  clProgressBar.style.background = (matched === total)
    ? 'var(--success,#38a169)'
    : 'var(--accent,#2B3A9C)';
}
const clDownloadBtn    = document.getElementById('clDownloadBtn');
const clCopyReportBtn  = document.getElementById('clCopyReportBtn');
const clCopyXhtmlBtn   = document.getElementById('clCopyXhtmlBtn');
const clTooltip        = document.getElementById('clTooltip');

/* Find hrefs used by more than one matched result */
function findDuplicateHrefs(results) {
  const counts = new Map();
  results.forEach(r => {
    if (r.status === 'matched' && r.resolved) {
      counts.set(r.resolved, (counts.get(r.resolved) || 0) + 1);
    }
  });
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([href]) => href));
}

/* ══════════════════════════════════
   STEP 1 — Folder
══════════════════════════════════ */
clFolderPickBtn.addEventListener('click', () => clFolderInput.click());

clFolderInput.addEventListener('change', async () => {
  const files = [...clFolderInput.files]
    .filter(f => f.name.endsWith('.xhtml') || f.name.endsWith('.html') || f.name.endsWith('.xml'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!files.length) { toast('No XHTML files found.', 'error'); return; }

  clState.folderFiles = files;
  clFolderStatus.textContent = `Reading ${files.length} files...`;

  clState.fileIndex = await Promise.all(files.map(readAndIndexFile));

  const folderName = files[0].webkitRelativePath.split('/')[0];
  clFolderPickText.textContent = folderName;
  clFolderStatus.textContent = `${files.length} file(s) indexed`;
  clFolderStatus.classList.add('ok');
  clFolderCheck.style.opacity = '1';
  clStep1.classList.add('done');
  clFolderPickBtn.classList.add('selected');

  syncClProcessBtn();
  toast(`Folder loaded: ${files.length} files`, 'success');
});

/* Read one file and extract headings */
function readAndIndexFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const content = e.target.result;
      const parser  = new DOMParser();
      const doc     = parser.parseFromString(content, 'application/xhtml+xml');
      const headings = [];
      doc.querySelectorAll('h1,h2,h3,h4,h5').forEach(el => {
        const id   = el.getAttribute('id');
        const text = normalizeText(el.textContent);
        const level = parseInt(el.tagName[1]);
        headings.push({ level, id, text });
      });
      resolve({ name: file.name, headings });
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ══════════════════════════════════
   STEP 2 — Content File
══════════════════════════════════ */
clFilePickBtn.addEventListener('click', () => clFileInput.click());

clFileInput.addEventListener('change', () => {
  const file = clFileInput.files[0];
  if (!file) return;

  clState.contentFileName = file.name;
  clFilePickText.textContent = file.name;
  clFileStatus.textContent = 'Reading file...';

  const reader = new FileReader();
  reader.onload = e => {
    clState.contentRaw = e.target.result;
    clFileStatus.textContent = 'File loaded';
    clFileStatus.classList.add('ok');
    clFileCheck.style.opacity = '1';
    clStep2.classList.add('done');
    clFilePickBtn.classList.add('selected');
    syncClProcessBtn();
    toast(`Content file loaded: ${file.name}`, 'success');
  };
  reader.readAsText(file, 'utf-8');
});

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
function syncClProcessBtn() {
  clProcessBtn.disabled = !(clState.folderFiles.length && clState.contentRaw);
}

/* Look up the actual heading text a resolved href points to */
function getHeadingText(href) {
  if (!href || href === '{0}') return null;
  const [filename, id] = href.split('#');
  const file = clState.fileIndex.find(f => f.name === filename);
  if (!file) return filename;
  if (!id) {
    const h1 = file.headings.find(h => h.level === 1);
    return (h1 && h1.text) || filename;
  }
  const h = file.headings.find(h => h.id === id);
  return h ? h.text : filename;
}

/* Re-encode non-ASCII chars back to hex entities (undo DOMParser decoding) */
function reEncodeEntities(str) {
  return str.replace(/[^\x00-\x7F]/g, c =>
    '&#x' + c.codePointAt(0).toString(16).toUpperCase() + ';'
  );
}

/* Normalize: lowercase, collapse whitespace */
function normalizeText(str) {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

/* Strip leading number from TOC bold entries: "1 The issues" → "the issues" */
function stripLeadingNumber(str) {
  return str.replace(/^\d+[\s.]+/, '').trim().toLowerCase();
}

/* Extract plain text from an element's innerHTML (strips all tags) */
function innerPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return normalizeText(tmp.textContent);
}

/* Reformat <ul class="toc">...</ul> block — collapse <li> to single lines with proper indentation */
function reformatTocBlock(raw) {
  // Extract the toc ul block
  const tocStart = raw.indexOf('<ul class="toc">');
  const tocEnd   = raw.lastIndexOf('</ul>') + 5;
  if (tocStart === -1) return raw;

  const before = raw.slice(0, tocStart);
  const after  = raw.slice(tocEnd);
  const tocRaw = raw.slice(tocStart, tocEnd);

  // Parse and reformat using DOMParser
  const parser = new DOMParser();
  const doc    = parser.parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>${tocRaw}</body></html>`,
    'application/xhtml+xml'
  );
  const ul = doc.querySelector('ul');
  if (!ul) return raw;

  function formatUl(ulEl, depth) {
    const indent = '  '.repeat(depth);
    let out = `${indent}<ul${ulEl === doc.querySelector('ul') ? ' class="toc"' : ''}>\n`;
    for (const child of ulEl.children) {
      const tag = child.tagName.toLowerCase();

      // Handle <p> tags — preserve as-is with indentation
      if (tag === 'p') {
        const tmp = document.createElement('div');
        tmp.appendChild(child.cloneNode(true));
        let pHtml = tmp.innerHTML.replace(/\s+/g, ' ').trim();
        out += `${indent}  ${pHtml}\n`;
        continue;
      }

      // Handle standalone <ul> (not inside <li>) — recurse
      if (tag === 'ul') {
        out += formatUl(child, depth + 1) + '\n';
        continue;
      }

      // Handle <li> as before
      if (tag !== 'li') continue;

      const childUl = child.querySelector(':scope > ul');
      let inline = '';
      for (const node of child.childNodes) {
        if (node.nodeType === 1 && (node.tagName === 'ul' || node.tagName === 'UL')) continue;
        if (node.nodeType === 3) {
          inline += node.textContent.replace(/\s+/g, ' ').trim();
        } else if (node.nodeType === 1) {
          const tmp = document.createElement('div');
          tmp.appendChild(node.cloneNode(true));
          inline += tmp.innerHTML;
        }
      }
      inline = inline.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
      if (childUl) {
        out += `${indent}  <li>${inline}\n`;
        out += formatUl(childUl, depth + 2);
        out += `${indent}  </li>\n`;
      } else {
        out += `${indent}  <li>${inline}</li>\n`;
      }
    }
    out += `${indent}</ul>`;
    return out;
  }

  const formatted = formatUl(ul, 0);
  return reEncodeEntities(before + formatted + '\n' + after);
}

/* ══════════════════════════════════
   PROCESS
══════════════════════════════════ */
clProcessBtn.addEventListener('click', () => {
  try {
    runAutoLink();
  } catch(err) {
    toast('Error: ' + err.message, 'error');
    console.error(err);
  }
});

function runAutoLink() {
  // Normalize all hrefs to {0} before processing
  clState.contentRaw = clState.contentRaw.replace(/href="[^"]*"/g, 'href="{0}"');

  const index = clState.fileIndex;

  /* Build two pools (consumed in order to handle duplicates like "Summary"):
     - h1Pool: for top-level chapter/frontmatter entries
     - subPool: for h2-h5 entries                          */
  const h1Pool  = [];
  const subPool = [];

  index.forEach(file => {
    file.headings.forEach(h => {
      if (h.level === 1) {
        h1Pool.push({ file: file.name, id: h.id, text: h.text });
      } else {
        subPool.push({ file: file.name, id: h.id, text: h.text, level: h.level });
      }
    });
  });

  /* Parse the TOC content file */
  const parser  = new DOMParser();
  const doc     = parser.parseFromString(clState.contentRaw, 'application/xhtml+xml');

  const results = [];

  /* Find all <a href="{0}"> and resolve each */
  doc.querySelectorAll('a[href="{0}"]').forEach(anchor => {
    const rawText   = normalizeText(anchor.textContent);
    const strippedText = stripLeadingNumber(rawText);

    let resolved = null;

    /* Try h1 pool first (chapter title or frontmatter) */
    const h1Idx = h1Pool.findIndex(h =>
      h.text === rawText ||
      h.text === strippedText ||
      normalizeText(h.text).includes(strippedText) ||
      strippedText.includes(normalizeText(h.text))
    );

    if (h1Idx !== -1) {
      const match = h1Pool.splice(h1Idx, 1)[0];
      resolved = match.file;  // no #id for h1
      anchor.setAttribute('href', resolved);
      results.push({ tocText: anchor.textContent.trim(), resolved, status: 'matched' });
      return;
    }

    /* Try sub-heading pool (h2-h5) */
    const subIdx = subPool.findIndex(h =>
      h.text === rawText ||
      h.text === strippedText
    );

    if (subIdx !== -1) {
      const match = subPool.splice(subIdx, 1)[0];
      resolved = match.id ? `${match.file}#${match.id}` : match.file;
      anchor.setAttribute('href', resolved);
      results.push({ tocText: anchor.textContent.trim(), resolved, status: 'matched' });
      return;
    }

    /* Unresolved */
    anchor.setAttribute('href', '{0}');
    results.push({ tocText: anchor.textContent.trim(), resolved: null, status: 'unresolved' });
  });

  clState.results = results;

  /* Raw string replacement — replace ALL {0} in order using split/join approach */
  const resolvedHrefs = results.map(r => r.status === 'matched' ? r.resolved : '{0}');
  let idx = 0;
  let output = clState.contentRaw.replace(/href="\{0\}"/g, () => {
    const href = resolvedHrefs[idx] || '{0}';
    idx++;
    return `href="${href}"`;
  });

  /* Reformat the <ul class="toc"> block for readable output */
  output = reformatTocBlock(output);

  clState.resolvedContent = output;

  /* Render UI */
  renderResults(results, doc);
}

/* ══════════════════════════════════
   RENDER
══════════════════════════════════ */
function renderResults(results, doc) {
  const matched    = results.filter(r => r.status === 'matched').length;
  const unresolved = results.filter(r => r.status === 'unresolved').length;
  const dupeHrefs  = findDuplicateHrefs(results);
  clDupeHrefs = dupeHrefs;

  /* Stats */
  clStatMatched.textContent    = matched;
  clStatUnresolved.textContent = unresolved;
  clStatUnresolved.style.color = unresolved > 0 ? 'var(--fail)' : 'var(--pass)';
  clStatDupe.textContent       = dupeHrefs.size;
  updateProgressBar();

  /* Middle: render TOC preview */
  const tocUl = doc.querySelector('ul.toc');
  if (tocUl) {
    const serializer = new XMLSerializer();
    let tocHtml = serializer.serializeToString(tocUl);
    clContentArea.innerHTML = `<div class="cl-toc-preview">${tocHtml}</div>`;
  } else {
    clContentArea.innerHTML = `<pre style="font-size:0.8rem;white-space:pre-wrap;">${escapeHtml(clState.resolvedContent)}</pre>`;
  }

  /* Style matched/unresolved links in preview + attach result index */
  let aIdx = 0;
  clContentArea.querySelectorAll('a').forEach(a => {
    if (aIdx >= clState.results.length) {
      aIdx++;
      return;
    }
    const href = a.getAttribute('href');
    a.dataset.resultIdx = aIdx;
    if (!href || href === '{0}') {
      a.style.color          = 'var(--danger, #e53e3e)';
      a.style.textDecoration = 'line-through';
    } else if (dupeHrefs.has(href)) {
      a.style.color               = 'var(--warning, #d97706)';
      a.style.textDecoration      = 'underline';
      a.style.textDecorationColor = 'var(--warning, #d97706)';
      a.style.outline             = '1px solid var(--warning, #d97706)';
      a.style.borderRadius        = '3px';
      a.style.padding             = '0 2px';
    } else {
      a.style.color         = 'var(--success, #38a169)';
    }
    a.style.pointerEvents = 'auto';
    a.style.cursor        = 'pointer';
    a.addEventListener('click', e => {
      e.preventDefault();
      openResolvePopup(+a.dataset.resultIdx);
    });
    a.addEventListener('mouseenter', () => {
      const idx = +a.dataset.resultIdx;
      const sidebarItem = clResultsList.querySelector(`[data-result-idx="${idx}"]`);
      if (sidebarItem) {
        sidebarItem.style.background = 'var(--hover, rgba(43,58,156,0.08))';
        sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    a.addEventListener('mouseleave', () => {
      const idx = +a.dataset.resultIdx;
      const sidebarItem = clResultsList.querySelector(`[data-result-idx="${idx}"]`);
      if (sidebarItem) sidebarItem.style.background = '';
    });

    /* Inline file badge (DOM only, not part of exported content) */
    const badge = document.createElement('span');
    badge.className = 'cl-file-badge';
    if (!href || href === '{0}') {
      badge.classList.add('unresolved');
      badge.textContent = 'unresolved';
    } else if (dupeHrefs.has(href)) {
      badge.classList.add('duplicate');
      const headingText = getHeadingText(href);
      badge.textContent = headingText ? `→ ${headingText}` : href;
    } else {
      const headingText = getHeadingText(href);
      badge.textContent = headingText ? `→ ${headingText}` : href;
    }
    if (a.parentNode) {
      a.parentNode.insertBefore(badge, a.nextSibling);
    }

    /* Custom hover tooltip (DOM only) */
    a.addEventListener('mouseenter', e => {
      if (!href || href === '{0}') {
        clTooltip.textContent = 'Unresolved — click to fix';
        clTooltip.style.borderColor = 'var(--danger,#e53e3e)';
      } else if (dupeHrefs.has(href)) {
        clTooltip.textContent = '⚠ Duplicate ID: ' + href;
        clTooltip.style.borderColor = 'var(--warning,#d97706)';
      } else {
        clTooltip.textContent = '🔗 ' + href;
        clTooltip.style.borderColor = 'var(--accent,#2B3A9C)';
      }
      clTooltip.style.display = 'block';
      clTooltip.style.left = (e.clientX + 12) + 'px';
      clTooltip.style.top  = (e.clientY - 28) + 'px';
    });
    a.addEventListener('mousemove', e => {
      clTooltip.style.left = (e.clientX + 12) + 'px';
      clTooltip.style.top  = (e.clientY - 28) + 'px';
    });
    a.addEventListener('mouseleave', () => {
      clTooltip.style.display = 'none';
    });

    aIdx++;
  });

  /* Right sidebar: results list */
  clResultsList.innerHTML = '';
  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'cl-result-item';
    item.dataset.resultIdx = i;
    item.style.cssText = `padding:6px 8px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:2px;cursor:pointer;`;
    const icon  = r.status === 'matched' ? '✓' : '✗';
    const color = r.status === 'matched' ? 'var(--success,#38a169)' : 'var(--danger,#e53e3e)';
    item.addEventListener('click', () => {
      const anchor = clContentArea.querySelector(`a[data-result-idx="${i}"]`);
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        anchor.style.outline = '2px solid var(--accent, #2B3A9C)';
        anchor.style.borderRadius = '3px';
        setTimeout(() => {
          anchor.style.outline = '';
          anchor.style.borderRadius = '';
        }, 1200);
      }
      openResolvePopup(i);
    });
    item.addEventListener('mouseenter', () => {
      const anchor = clContentArea.querySelector(`a[data-result-idx="${i}"]`);
      if (anchor) anchor.style.outline = '2px solid var(--accent,#2B3A9C)';
    });
    item.addEventListener('mouseleave', () => {
      const anchor = clContentArea.querySelector(`a[data-result-idx="${i}"]`);
      if (anchor) anchor.style.outline = '';
    });
    const isDupe = r.resolved && dupeHrefs.has(r.resolved);
    const dupBadge = isDupe
      ? '<span style="background:var(--warning,#d97706);color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:6px;">DUP</span>'
      : '';
    if (isDupe) {
      item.style.borderLeft = '3px solid var(--warning, #d97706)';
      item.style.background = 'var(--warning-bg, #fffbeb)';
      item.title = 'This ID is linked to multiple TOC entries — verify manually';
    }
    item.innerHTML = `
      <span style="color:${color};font-weight:600;font-size:0.75rem;">${icon} ${escapeHtml(r.tocText)}${dupBadge}</span>
      <span style="color:var(--text-muted);font-size:0.72rem;word-break:break-all;">${r.resolved || 'unresolved'}</span>
    `;
    clResultsList.appendChild(item);
  });

  /* Enable buttons */
  clDownloadBtn.disabled    = false;
  clCopyReportBtn.disabled  = false;
  clCopyXhtmlBtn.disabled   = false;

  /* Show workspace */
clEmptyState.hidden = true;
clWorkspace.hidden  = false;
clWorkspace.style.display = 'flex';
clWorkspace.style.flexDirection = 'column';
clWorkspace.style.flex = '1';
clWorkspace.style.overflow = 'hidden';

  const msg = unresolved > 0
    ? `Done! ${matched} matched, ⚠️ ${unresolved} unresolved.`
    : `All ${matched} entries linked!`;
  toast(msg, unresolved > 0 ? 'warning' : 'success');
}

/* ══════════════════════════════════
   RESOLVE POPUP
══════════════════════════════════ */
const clResolveModal      = document.getElementById('clResolveModal');
const clResolveModalTitle = document.getElementById('clResolveModalTitle');
const clResolveModalClose = document.getElementById('clResolveModalClose');
const clResolveFileSelect = document.getElementById('clResolveFileSelect');
const clResolveHeadingList= document.getElementById('clResolveHeadingList');
const clResolveSearch     = document.getElementById('clResolveSearch');

let clResolveTarget = null; // { resultIdx, sidebarItem, previewAnchor }
let clHeadingBtns = [];

clResolveModalClose.addEventListener('click', () => {
  clResolveModal.hidden = true;
  clResolveTarget = null;
});

function renderResolveHeadings(fileName) {
  const entry = clState.fileIndex.find(f => f.name === fileName);
  clResolveHeadingList.innerHTML = '';
  if (!entry || !entry.headings.length) {
    clResolveHeadingList.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:0.8rem;">No headings found.</div>';
    return;
  }

  entry.headings.forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'popup-item cl-heading-item';
    btn.innerHTML = `
      <span class="cl-heading-level">H${h.level}</span>
      <span class="cl-heading-text">${escapeHtml(h.text)}</span>
    `;
    btn.addEventListener('click', () => {
      const resolved = h.id ? `${fileName}#${h.id}` : fileName;
      applyResolvedLink(resolved);
      clResolveModal.hidden = true;
      clResolveTarget = null;
    });
    clResolveHeadingList.appendChild(btn);
  });
  clHeadingBtns = [...clResolveHeadingList.querySelectorAll('.cl-heading-item')];
}

clResolveFileSelect.addEventListener('change', () => {
  const fileName = clResolveFileSelect.value;
  if (!fileName) {
    clResolveHeadingList.innerHTML = '<div class="cl-resolve-placeholder">Select a file to see headings</div>';
    return;
  }
  renderResolveHeadings(fileName);
});

clResolveSearch.addEventListener('input', () => {
  const q = clResolveSearch.value.trim().toLowerCase();
  clHeadingBtns.forEach(btn => {
    const text = btn.querySelector('.cl-heading-text').textContent.toLowerCase();
    btn.style.display = text.includes(q) ? '' : 'none';
  });
  // Show no results message if all hidden
  const anyVisible = clHeadingBtns.some(btn => btn.style.display !== 'none');
  let noMsg = clResolveHeadingList.querySelector('.cl-resolve-no-results');
  if (!anyVisible) {
    if (!noMsg) {
      noMsg = document.createElement('div');
      noMsg.className = 'cl-resolve-no-results cl-resolve-placeholder';
      noMsg.textContent = 'No headings match.';
      clResolveHeadingList.appendChild(noMsg);
    }
    noMsg.style.display = '';
  } else {
    if (noMsg) noMsg.style.display = 'none';
  }
});

function openResolvePopup(resultIdx) {
  const r = clState.results[resultIdx];
  if (!r) return;  //  ADD THIS GUARD
  const statusLabel = r.status === 'unresolved' ? 'Resolve' : 'Change Link';
  clResolveModalTitle.textContent = `${statusLabel}: ${r.tocText.trim()}`;
  const clResolveModalTitle2 = document.getElementById('clResolveModalTitle2');
  clResolveModalTitle2.textContent = r.tocText.trim();

  clResolveFileSelect.innerHTML = '<option value="">-- Select a file --</option>';
  clState.fileIndex.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name;
    clResolveFileSelect.appendChild(opt);
  });
  clResolveFileSelect.value = '';
  clResolveHeadingList.innerHTML = '<div class="cl-resolve-placeholder">Select a file to see headings</div>';
  clResolveSearch.value = '';
  clHeadingBtns = [];

  // Find matching sidebar item and preview anchor
  const sidebarItems   = clResultsList.querySelectorAll('[data-result-idx]');
  const previewAnchors = clContentArea.querySelectorAll('a[data-result-idx]');
  clResolveTarget = {
    resultIdx,
    sidebarItem:   [...sidebarItems].find(el => +el.dataset.resultIdx === resultIdx),
    previewAnchor: [...previewAnchors].find(el => +el.dataset.resultIdx === resultIdx),
  };
  clResolveModal.hidden = false;
}

function applyResolvedLink(resolved) {
  if (!clResolveTarget) return;
  const { resultIdx, sidebarItem, previewAnchor } = clResolveTarget;

  // Update state
  clState.results[resultIdx].resolved = resolved;
  clState.results[resultIdx].status   = 'matched';

  // Update raw output — replace the specific {0} at correct position by rebuilding
  const resolvedHrefs = clState.results.map(r => r.resolved || '{0}');
  let idx2 = 0;
  clState.resolvedContent = clState.contentRaw.replace(/href="\{0\}"/g, () => {
    const href = resolvedHrefs[idx2] || '{0}';
    idx2++;
    return `href="${href}"`;
  });
  clState.resolvedContent = reformatTocBlock(clState.resolvedContent);

  // Update preview anchor color
  if (previewAnchor) {
    previewAnchor.setAttribute('href', resolved);
  }

  // Update sidebar item
  if (sidebarItem) {
    const spans = sidebarItem.querySelectorAll('span');
    spans[0].style.color    = 'var(--success,#38a169)';
    spans[0].textContent    = `✓ ${clState.results[resultIdx].tocText}`;
    spans[1].textContent    = resolved;
  }

  // Re-check duplicate hrefs across all results and re-apply/remove DUP styling
  const dupeHrefs = findDuplicateHrefs(clState.results);
  clDupeHrefs = dupeHrefs;

  // Re-apply preview anchor styling based on updated duplicate set
  clContentArea.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    a.style.outline = '';
    a.style.borderRadius = '';
    a.style.padding = '';
    a.style.textDecorationColor = '';
    if (!href || href === '{0}') {
      a.style.color          = 'var(--danger, #e53e3e)';
      a.style.textDecoration = 'line-through';
      a.style.pointerEvents  = 'auto';
      a.style.cursor         = 'pointer';
    } else if (dupeHrefs.has(href)) {
      a.style.color               = 'var(--warning, #d97706)';
      a.style.textDecoration      = 'underline';
      a.style.textDecorationColor = 'var(--warning, #d97706)';
      a.style.outline             = '1px solid var(--warning, #d97706)';
      a.style.borderRadius        = '3px';
      a.style.padding             = '0 2px';
      a.style.pointerEvents       = 'auto';
      a.style.cursor              = 'pointer';
      if (!a.dataset.clickBound) {
        a.dataset.clickBound = '1';
        a.addEventListener('click', e => {
          e.preventDefault();
          openResolvePopup(+a.dataset.resultIdx);
        });
      }
    } else {
      a.style.color          = 'var(--success, #38a169)';
      a.style.textDecoration = 'none';
      a.style.pointerEvents  = 'auto';
      a.style.cursor         = 'pointer';
    }

    // Update inline file badge to reflect the (possibly new) href
    const nextEl = a.nextSibling;
    if (nextEl && nextEl.nodeType === 1 && nextEl.classList.contains('cl-file-badge')) {
      nextEl.className = 'cl-file-badge';
      if (!href || href === '{0}') {
        nextEl.classList.add('unresolved');
        nextEl.textContent = 'unresolved';
      } else if (dupeHrefs.has(href)) {
        nextEl.classList.add('duplicate');
        const headingText = getHeadingText(href);
        nextEl.textContent = headingText ? `→ ${headingText}` : href;
      } else {
        const headingText = getHeadingText(href);
        nextEl.textContent = headingText ? `→ ${headingText}` : href;
      }
    }
  });

  // Refresh previewAnchor's event listeners (old ones reference stale href/resolved)
  if (previewAnchor && previewAnchor.parentNode) {
    const newAnchor = previewAnchor.cloneNode(true);
    previewAnchor.parentNode.replaceChild(newAnchor, previewAnchor);

    newAnchor.addEventListener('click', e => {
      e.preventDefault();
      openResolvePopup(clResolveTarget.resultIdx);
    });

    newAnchor.addEventListener('mouseenter', e => {
      if (!resolved || resolved === '{0}') {
        clTooltip.textContent = 'Unresolved — click to fix';
        clTooltip.style.borderColor = 'var(--danger,#e53e3e)';
      } else if (clDupeHrefs.has(resolved)) {
        clTooltip.textContent = '⚠ Duplicate ID: ' + resolved;
        clTooltip.style.borderColor = 'var(--warning,#d97706)';
      } else {
        clTooltip.textContent = '🔗 ' + resolved;
        clTooltip.style.borderColor = 'var(--accent,#2B3A9C)';
      }
      clTooltip.style.display = 'block';
      clTooltip.style.left = (e.clientX + 12) + 'px';
      clTooltip.style.top  = (e.clientY - 28) + 'px';
    });

    newAnchor.addEventListener('mousemove', e => {
      clTooltip.style.left = (e.clientX + 12) + 'px';
      clTooltip.style.top  = (e.clientY - 28) + 'px';
    });

    newAnchor.addEventListener('mouseleave', () => {
      clTooltip.style.display = 'none';
    });

    newAnchor.addEventListener('mouseenter', e => {
      const idx = +newAnchor.dataset.resultIdx;
      const sidebarItem = clResultsList.querySelector(`[data-result-idx="${idx}"]`);
      if (sidebarItem) {
        sidebarItem.style.background = 'var(--hover, rgba(43,58,156,0.08))';
        sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    newAnchor.addEventListener('mouseleave', () => {
      const idx = +newAnchor.dataset.resultIdx;
      const sidebarItem = clResultsList.querySelector(`[data-result-idx="${idx}"]`);
      if (sidebarItem) sidebarItem.style.background = '';
    });

    clResolveTarget.previewAnchor = newAnchor;
  }

  clResultsList.querySelectorAll('[data-result-idx]').forEach(el => {
    const r = clState.results[+el.dataset.resultIdx];
    const isDupe = r.resolved && dupeHrefs.has(r.resolved);
    const firstSpan = el.querySelector('span');
    const existingBadge = firstSpan ? firstSpan.querySelector('span') : null;
    if (isDupe) {
      el.style.borderLeft = '3px solid var(--warning, #d97706)';
      el.style.background = 'var(--warning-bg, #fffbeb)';
      el.title = 'This ID is linked to multiple TOC entries — verify manually';
      if (firstSpan && !existingBadge) {
        firstSpan.insertAdjacentHTML('beforeend', '<span style="background:var(--warning,#d97706);color:#fff;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:6px;">DUP</span>');
      }
    } else {
      el.style.borderLeft = '';
      el.style.background = '';
      el.title = '';
      if (existingBadge) existingBadge.remove();
    }
  });

  // Update stats
  const matched    = clState.results.filter(r => r.status === 'matched').length;
  const unresolved = clState.results.filter(r => r.status === 'unresolved').length;
  clStatMatched.textContent    = matched;
  clStatUnresolved.textContent = unresolved;
  clStatUnresolved.style.color = unresolved > 0 ? 'var(--fail)' : 'var(--pass)';
  clStatDupe.textContent       = dupeHrefs.size;
  updateProgressBar();

  toast(`Linked to ${resolved}`, 'success');
}

/* ══════════════════════════════════
   COPY XHTML
══════════════════════════════════ */
clCopyXhtmlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(clState.resolvedContent)
    .then(() => toast('XHTML copied!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});

/* ══════════════════════════════════
   DOWNLOAD
══════════════════════════════════ */
clDownloadBtn.addEventListener('click', () => {
  const filename = clState.contentFileName.replace(/(\.[^.]+)$/, '_linked$1');
  const blob = new Blob([clState.resolvedContent], { type: 'application/xhtml+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded: ${filename}`, 'success');
});

/* ══════════════════════════════════
   COPY REPORT
══════════════════════════════════ */
clCopyReportBtn.addEventListener('click', () => {
  const lines = clState.results.map(r =>
    `[${r.status.toUpperCase()}] ${r.tocText} → ${r.resolved || 'unresolved'}`
  );
  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => toast('Report copied!', 'success'))
    .catch(() => toast('Copy failed.', 'error'));
});

/* ══════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════ */
let clCurrentUnresolvedIdx = 0;

document.addEventListener('keydown', e => {
  if (clWorkspace.hidden !== false) return;

  if (e.key === 'Escape') {
    if (!clResolveModal.hidden) {
      clResolveModal.hidden = true;
      clResolveTarget = null;
    }
    return;
  }

  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === 'r' || e.key === 'R') {
    clCurrentUnresolvedIdx = 0;
    return;
  }

  if (e.key === 'n' || e.key === 'N') {
    const unresolvedIdxs = clState.results
      .map((r, i) => ({ r, i }))
      .filter(o => o.r.status === 'unresolved' || clDupeHrefs.has(o.r.resolved))
      .map(o => o.i);

    if (!unresolvedIdxs.length) {
      toast('No unresolved links', 'info');
      return;
    }

    if (clCurrentUnresolvedIdx >= unresolvedIdxs.length) clCurrentUnresolvedIdx = 0;
    const resultIdx = unresolvedIdxs[clCurrentUnresolvedIdx];
    clCurrentUnresolvedIdx = (clCurrentUnresolvedIdx + 1) % unresolvedIdxs.length;

    const isDupe = clState.results[resultIdx].status !== 'unresolved' && clDupeHrefs.has(clState.results[resultIdx].resolved);
    const flashColor = isDupe ? 'var(--warning, #d97706)' : 'var(--accent, #2B3A9C)';

    const anchor = clContentArea.querySelector(`a[data-result-idx="${resultIdx}"]`);
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      anchor.style.outline = `2px solid ${flashColor}`;
      anchor.style.borderRadius = '3px';
      setTimeout(() => {
        anchor.style.outline = '';
        anchor.style.borderRadius = '';
      }, 1200);
    }
    const sidebarItem = clResultsList.querySelector(`[data-result-idx="${resultIdx}"]`);
    if (sidebarItem) sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

/* ══════════════════════════════════
   UTILS
══════════════════════════════════ */
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
