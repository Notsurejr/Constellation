// Markdown export — the shared "one chat → one Obsidian-readable .md" builder.
// Used by BOTH the per-chat export (renderer supplies live messages) and the
// Markdown backup (main reads session files). Format mirrors the user's approved
// sample ("Test formatting.txt"): Obsidian callouts — [!QUESTION] User for the
// writer, [!NOTE] <model> for the model — with YAML frontmatter and thinking
// blocks as folded [!abstract]- callouts (collapsed until clicked).

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function localStamp(t) {
  const d = new Date(t || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// Filename-safe title, capped like the app's other exports.
function safeFileTitle(t) {
  return (String(t || '').replace(/[\\/:*?"<>|#^\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)) || 'chat';
}

// glm-5.3 -> GLM-5.3; custom ids pass through untouched.
function prettyModel(m) {
  const s = String(m || '').trim();
  if (!s) return 'GLM';
  return /^glm[-_]/i.test(s) ? 'GLM' + s.slice(3) : s;
}

function yamlQuote(s) {
  return '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"';
}

// Wrap message text as a callout body: every line blockquoted, blank lines become bare ">".
// folded=true emits the Obsidian collapsed form ([!type]- Title).
function callout(type, label, body, folded) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0].trim())) lines.length = 0;
  if (!lines.length) return '';
  const out = ['> [!' + type + ']' + (folded ? '-' : '') + ' ' + label];
  for (const ln of lines) out.push(ln.trim() === '' ? '>' : '> ' + ln);
  return out.join('\n');
}

// sess: { title, messages: [{role, content, reasoning?, edited?, orig?}], model?, system? }
// opts: { thinking: bool, system: bool }
function chatToMarkdown(sess, opts) {
  opts = opts || {};
  const msgs = Array.isArray(sess && sess.messages) ? sess.messages : [];
  const turns = msgs.filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  const model = prettyModel(sess && sess.model);
  const parts = [];

  // --- YAML frontmatter (Obsidian properties) ---
  const fm = [
    '---',
    'title: ' + yamlQuote((sess && sess.title) || 'Untitled'),
    'app: Constellation',
    'model: ' + String((sess && sess.model) || 'unknown'),
    'exported: ' + localStamp(),
    'messages: ' + turns.length,
    '---',
    '',
  ];
  parts.push(fm.join('\n'));

  // --- optional folded system prompt ---
  if (opts.system && sess && sess.system) {
    parts.push(callout('quote', '✦ System prompt', sess.system, true));
    parts.push('');
  }

  // --- the conversation ---
  for (const m of turns) {
    if (m.role === 'assistant' && opts.thinking && m.reasoning && String(m.reasoning).trim()) {
      parts.push(callout('abstract', '✦ Thinking', m.reasoning, true));   // folded until clicked
      parts.push('');
    }
    const body = String(m.content || '').trim() ? m.content : '';
    if (!body) continue;   // thinking-only turn already emitted above
    if (m.role === 'user') {
      parts.push(callout('QUESTION', 'User', body));
    } else {
      const edited = m.edited && m.orig && m.orig !== m.content ? ' · ✎ edited' : '';
      parts.push(callout('NOTE', prettyModel(sess && sess.model) + edited, body));
    }
    parts.push('');
  }

  // trim trailing blank lines to exactly one final newline
  let out = parts.join('\n');
  out = out.replace(/\s+$/, '');
  return out + '\n';
}

module.exports = { chatToMarkdown, safeFileTitle, prettyModel };
