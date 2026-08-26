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
const clDownloadBtn    = document.getElementById('clDownloadBtn');
const clCopyReportBtn  = document.getElementById('clCopyReportBtn');
const clCopyXhtmlBtn   = document.getElementById('clCopyXhtmlBtn');

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
    for (const li of ulEl.children) {
      if (li.tagName !== 'li' && li.tagName !== 'LI') continue;
      // Get direct children — split into non-ul and ul parts
      const childUl  = li.querySelector(':scope > ul');
      // Collect inline content (everything except nested ul)
      let inline = '';
      for (const node of li.childNodes) {
        if (node.nodeType === 1 && (node.tagName === 'ul' || node.tagName === 'UL')) continue;
        if (node.nodeType === 3) {
          inline += node.textContent.replace(/\s+/g, ' ').trim();
        } else if (node.nodeType === 1) {
          // serialize the inline element
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
  return before + formatted + '\n' + after;
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

  /* Stats */
  clStatMatched.textContent    = matched;
  clStatUnresolved.textContent = unresolved;
  clStatUnresolved.style.color = unresolved > 0 ? 'var(--fail)' : 'var(--pass)';

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
    const href = a.getAttribute('href');
    a.dataset.resultIdx = aIdx;
    if (!href || href === '{0}') {
      a.style.color          = 'var(--danger, #e53e3e)';
      a.style.textDecoration = 'line-through';
      a.style.pointerEvents  = 'auto';
      a.style.cursor         = 'pointer';
      a.addEventListener('click', e => {
        e.preventDefault();
        openResolvePopup(+a.dataset.resultIdx);
      });
    } else {
      a.style.color         = 'var(--success, #38a169)';
      a.style.pointerEvents = 'none';
    }
    aIdx++;
  });

  /* Right sidebar: results list */
  clResultsList.innerHTML = '';
  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.dataset.resultIdx = i;
    item.style.cssText = `padding:6px 8px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:2px;`;
    const icon  = r.status === 'matched' ? '✓' : '✗';
    const color = r.status === 'matched' ? 'var(--success,#38a169)' : 'var(--danger,#e53e3e)';
    if (r.status === 'unresolved') {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => openResolvePopup(i));
    }
    item.innerHTML = `
      <span style="color:${color};font-weight:600;font-size:0.75rem;">${icon} ${escapeHtml(r.tocText)}</span>
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
const clResolveFilePick   = document.getElementById('clResolveFilePick');
const clResolveFileInput  = document.getElementById('clResolveFileInput');
const clResolveFileText   = document.getElementById('clResolveFileText');
const clResolveHeadingList= document.getElementById('clResolveHeadingList');

let clResolveTarget = null; // { resultIdx, sidebarItem, previewAnchor }

clResolveModalClose.addEventListener('click', () => {
  clResolveModal.hidden = true;
  clResolveTarget = null;
});

clResolveFilePick.addEventListener('click', () => clResolveFileInput.click());

clResolveFileInput.addEventListener('change', () => {
  const file = clResolveFileInput.files[0];
  if (!file) return;
  clResolveFileText.textContent = file.name;
  clResolveHeadingList.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:0.8rem;">Reading file...</div>';

  const reader = new FileReader();
  reader.onload = e => {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(e.target.result, 'application/xhtml+xml');
    const headings = [];
    doc.querySelectorAll('h1,h2,h3,h4,h5').forEach(el => {
      headings.push({ id: el.getAttribute('id'), text: el.textContent.replace(/\s+/g,' ').trim(), level: parseInt(el.tagName[1]) });
    });

    clResolveHeadingList.innerHTML = '';
    if (!headings.length) {
      clResolveHeadingList.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:0.8rem;">No headings found.</div>';
      return;
    }

    headings.forEach(h => {
      const btn = document.createElement('button');
      btn.className = 'popup-item';
      btn.style.paddingLeft = `${8 + (h.level - 1) * 12}px`;
      btn.innerHTML = `<span style="font-size:0.7rem;color:var(--muted);margin-right:6px;">H${h.level}</span><span>${escapeHtml(h.text)}</span>`;
      btn.addEventListener('click', () => {
        const resolved = h.id ? `${file.name}#${h.id}` : file.name;
        applyResolvedLink(resolved);
        clResolveModal.hidden = true;
        clResolveTarget = null;
      });
      clResolveHeadingList.appendChild(btn);
    });
  };
  reader.readAsText(file, 'utf-8');
});

function openResolvePopup(resultIdx) {
  const r = clState.results[resultIdx];
  clResolveModalTitle.textContent = `Resolve: ${r.tocText.trim()}`;
  clResolveFileText.textContent   = 'Choose XHTML File';
  clResolveHeadingList.innerHTML  = '';
  clResolveFileInput.value        = '';

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
    previewAnchor.style.color          = 'var(--success, #38a169)';
    previewAnchor.style.textDecoration = 'none';
    previewAnchor.style.pointerEvents  = 'none';
  }

  // Update sidebar item
  if (sidebarItem) {
    const spans = sidebarItem.querySelectorAll('span');
    spans[0].style.color    = 'var(--success,#38a169)';
    spans[0].textContent    = `✓ ${clState.results[resultIdx].tocText}`;
    spans[1].textContent    = resolved;
  }

  // Update stats
  const matched    = clState.results.filter(r => r.status === 'matched').length;
  const unresolved = clState.results.filter(r => r.status === 'unresolved').length;
  clStatMatched.textContent    = matched;
  clStatUnresolved.textContent = unresolved;
  clStatUnresolved.style.color = unresolved > 0 ? 'var(--fail)' : 'var(--pass)';

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
   UTILS
══════════════════════════════════ */
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
