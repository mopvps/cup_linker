/* ── SUP TAGGER ── */
(function () {

  // State
  const st = {
    raw: null,       // original file string
    filename: '',
    tagged: 0,
    skipped: 0,
  };

  // Elements
  const pickBtn     = document.getElementById('supPickFile');
  const fileInput   = document.getElementById('supFileInput');
  const fileBtnText = document.getElementById('supFileBtnText');
  const fileStatus  = document.getElementById('supFileStatus');
  const fileCheck   = document.getElementById('supFileCheck');
  const processBtn  = document.getElementById('supProcessBtn');
  const downloadBtn = document.getElementById('supDownloadBtn');
  const emptyState  = document.getElementById('supEmptyState');
  const workspace   = document.getElementById('supWorkspace');
  const previewArea = document.getElementById('supPreviewArea');
  const statTagged  = document.getElementById('supStatTagged');
  const statSkipped = document.getElementById('supStatSkipped');
  const supFileName = document.getElementById('supFileName');

  // Exclusion: words before a number that mean it's NOT a footnote ref
  const EXCLUDE_BEFORE = /\b(chapter|table|figure|fig|vol|volume|no|number|p|pp|eq|equation|section|part|appendix|step|item|page|para|paragraph|line|note|type|stage|version|v|grade|level|tier|rank|class|group|phase|round|rule|clause|article|schedule)\s*\.?\s*$/i;

  // File pick
  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    st.filename = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      st.raw = e.target.result;
      fileBtnText.textContent = file.name;
      fileStatus.textContent = 'File loaded — ready to process';
      fileCheck.style.color = 'var(--success, #38a169)';
      processBtn.disabled = false;
    };
    reader.readAsText(file);
  });

  // Process
  processBtn.addEventListener('click', () => {
    if (!st.raw) return;
    const result = tagSuperscripts(st.raw);
    st.tagged  = result.tagged;
    st.skipped = result.skipped;
    statTagged.textContent  = result.tagged;
    statSkipped.textContent = result.skipped;
    supFileName.textContent = st.filename;

    // Render preview with highlights
    previewArea.innerHTML = buildPreview(result.output);

    emptyState.hidden = true;
    workspace.hidden  = false;
    downloadBtn.disabled = false;
    st.output = result.output;
  });

  // Download
  downloadBtn.addEventListener('click', () => {
    if (!st.output) return;
    const blob = new Blob([st.output], { type: 'application/xhtml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = st.filename.replace(/(\.[^.]+)$/, '_sup$1');
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /**
   * Core logic: tag standalone numbers in text nodes only (not inside tags/attrs).
   * Returns { output: string, tagged: number, skipped: number }
   */
  function tagSuperscripts(raw) {
    let tagged = 0;
    let skipped = 0;
    let output = '';
    let i = 0;

    while (i < raw.length) {
      // If we hit a tag, copy it verbatim
      if (raw[i] === '<') {
        const end = raw.indexOf('>', i);
        if (end === -1) { output += raw.slice(i); break; }
        output += raw.slice(i, end + 1);
        i = end + 1;
        continue;
      }

      // We're in a text node — find the next '<'
      const nextTag = raw.indexOf('<', i);
      const textEnd = nextTag === -1 ? raw.length : nextTag;
      const text    = raw.slice(i, textEnd);

      // Process text: find standalone numbers
      const processed = text.replace(/\b(\d{1,3})\b/g, (match, num, offset) => {
        // Check what's before this number in the full text slice
        const before = text.slice(0, offset);

        // Skip if preceded by excluded keyword
        if (EXCLUDE_BEFORE.test(before)) { skipped++; return match; }

        // Skip 4-digit (years handled by \d{1,3} limit above — max 3 digits)
        // (already limited to 1–3 digits in regex)

        // Skip if preceded by digit (part of larger number)
        if (/\d$/.test(before)) { skipped++; return match; }

        tagged++;
        return `<sup>${num}</sup>`;
      });

      output += processed;
      i = textEnd;
    }

    return { output, tagged, skipped };
  }

  /**
   * Build a sanitized preview — highlight <sup> tags added by us.
   * We render the raw output as text inside a div, but since it's XHTML
   * we use innerHTML carefully — just show the body content.
   */
  function buildPreview(output) {
    // Extract body content for preview
    const bodyMatch = output.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const content   = bodyMatch ? bodyMatch[1] : output;

    // Highlight our sup tags with a yellow background for visibility
    const highlighted = content.replace(
      /<sup>(\d+)<\/sup>/g,
      '<sup style="background:var(--warning,#d97706);color:#fff;border-radius:2px;padding:0 2px;">$1</sup>'
    );
    return highlighted;
  }

})();
