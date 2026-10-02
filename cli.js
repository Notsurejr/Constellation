#!/usr/bin/env node
// Constellation CLI — read-only inspection + retrieval/phrase-ban testing against your real app data.
// NON-DESTRUCTIVE: nothing here writes, deletes, or sends anything to the model. It only reads your
// data and runs the shared engines (the same code the app uses) to show what WOULD happen.
const fs = require('fs'), path = require('path');
const engines = require('./src/js/engines.js');
const lore = engines.lore, bans = engines.bans;

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const ROOT = path.join(HOME, 'AppData', 'Roaming', 'constellation');
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(ROOT, 'config');
const LB_FILE = path.join(DATA, 'lorebooks.json');
const SESS_DIR = path.join(DATA, 'sessions');
const BANS_FILE = path.join(CONFIG, 'phrase_bans.txt');

const readJSON = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const loadLorebooks = () => { const m = readJSON(LB_FILE, {}); return (m && typeof m === 'object') ? m : {}; };
const loadSessions = () => {
  if (!fs.existsSync(SESS_DIR)) return [];
  return fs.readdirSync(SESS_DIR).filter((f) => f.endsWith('.json')).map((f) => Object.assign({ id: f.replace(/\.json$/, '') }, readJSON(path.join(SESS_DIR, f), {})));
};
function findLorebook(map, key) {
  if (!key) return null;
  if (map[key]) return map[key];
  const k = String(key).toLowerCase();
  for (const id of Object.keys(map)) if ((map[id].name || '').toLowerCase() === k) return map[id];
  for (const id of Object.keys(map)) if ((map[id].name || '').toLowerCase().includes(k)) return map[id];
  return null;
}

function help() {
  console.log(`Constellation CLI

OFFLINE (reads your data files directly — no app running, nothing sent):

  node cli.js lorebooks                         list lorebooks (id, name, entries, ~chars)
  node cli.js entries <name|id>                 list entries in a lorebook
  node cli.js sessions                          list chats + each chat's enabled lorebooks
  node cli.js retrieve "<query>" [filters]      show which lore passages pull for a query (BM25 path)
       filters:  --chat <id>      use that chat's enabled lorebooks
                 --lore <a,b>     use these lorebooks by name/id (default: ALL lorebooks)
  node cli.js bans "<text>"                     apply your saved phrase bans to <text>; show before/after
  node cli.js inspect                           overall data summary

PROMPT LAB (needs the app running with the CLI server on — Settings → Advanced; makes real
GLM calls on /dry, but persists NOTHING and changes nothing on disk):

  node cli.js ping                              liveness + auth check
  node cli.js state                             what chat/conversation is loaded
  node cli.js dry --probe scene.txt --system-file candidate-v7.txt
                                                one iteration: fixed probe + CANDIDATE system
                                                prompt (replaces the session's for this call only)
       options:  --msg "text"      inline message (alternative to --probe)
                 --system-file F   candidate prompt (the prompt-lab primitive)
                 --history-file F  JSON array of {role, content} — REPLACES the conversation
                                   for this call (multi-turn labs: own the history like a probe,
                                   no restarts, no app patches)
                 --max-reason N    digest the thinking to ~N chars head+tail (default 1500;
                                   for reasoning-steering work prefer --full — the signal is
                                   often mid-deliberation)
                 --full            full thinking, no digest
                 --json            raw JSON only (for scripting)
                 --out FILE        also save the raw result (for the lab notebook rounds/)
                 --profile DIR     app user-data dir holding cli-server.json
                                   (default: the installed app; pass a sandbox profile for labs)

  data dir: ${DATA}`);
}

// ---- prompt-lab (server) mode ----
function flag(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !String(v).startsWith('--') ? v : true;
}
// Git Bash passes MSYS paths (/c/Users/...) verbatim to Node, where they resolve as C:\c\... —
// normalize them so both path styles work.
function normPath(p) {
  if (typeof p !== 'string') return p;
  const m = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m) return m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\');
  return p;
}
function readArgFile(p) { return fs.readFileSync(normPath(String(p)), 'utf8'); }
async function serverCall(profileDir, route, body) {
  const fs2 = require('fs'), path2 = require('path');
  const credPath = path2.join(String(profileDir), 'cli-server.json');
  let cred;
  try { cred = JSON.parse(fs2.readFileSync(credPath, 'utf8')); }
  catch (e) { console.error('No cli-server.json at ' + credPath); console.error('Is the app running with the CLI server enabled?'); process.exit(1); }
  const res = await fetch('http://127.0.0.1:' + cred.port + route, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { console.error('HTTP ' + res.status + ' on ' + route + ' — ' + (await res.text()).slice(0, 200)); process.exit(1); }
  return res.json();
}
// Head+tail with a marked gap: enough to judge HOW it approached the scene without context death.
// (Lab finding: mid-reasoning deliberation is often the signal — for steering work prefer --full.)
function digestReason(text, n) {
  text = String(text || '');
  if (!n || n >= text.length) return text;
  const half = Math.floor(n / 2);
  return text.slice(0, half) + '\n[… ' + (text.length - n) + ' chars truncated — rerun with --full or a larger --max-reason …]\n' + text.slice(text.length - half);
}
// Classify a failure at first glance — quota vs budget vs refusal vs network vs timeout.
function errorClass(msg) {
  const m = String(msg || '');
  if (/429|balance|quota|resource pack/i.test(m)) return 'QUOTA';
  if (/401|unauthorized|invalid.*key/i.test(m)) return 'AUTH';
  if (/timeout/i.test(m)) return 'TIMEOUT';
  if (/fetch|network|ECONN/i.test(m)) return 'NETWORK';
  if (/unsafe|sensitive/i.test(m)) return 'MODERATION';
  return 'OTHER';
}
// A round file (--out output) chains directly: its probe+reply become the next history.
function parseHistoryInput(raw) {
  const j = JSON.parse(raw);
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object' && j.result && typeof j.result.reply === 'string') {
    const prev = Array.isArray(j.history) ? j.history : [];
    return prev.concat([{ role: 'user', content: j.probe || '' }, { role: 'assistant', content: j.result.reply }]);
  }
  throw new Error('history file must be a {role, content}[] array or a saved round file');
}
async function labMain(cmd) {
  const profile = flag('profile', ROOT);
  if (cmd === 'ping') { console.log(JSON.stringify(await serverCall(profile, '/ping'), null, 2)); return; }
  if (cmd === 'state') { console.log(JSON.stringify(await serverCall(profile, '/state'), null, 2)); return; }

  // First-class teardown: kill ONLY processes whose command line names THIS profile's sandbox,
  // never by image name (the owner's live app is electron.exe too), then delete and verify.
  // Exit 0 on real success — a safe path that lies about failure trains operators toward
  // blunt instruments.
  if (cmd === 'teardown') {
    const { execFileSync } = require('child_process');
    const profStr = String(profile);
    const sbName = path.basename(path.dirname(profStr));   // e.g. constellation-promptlab
    // Refuse to kill anything unless the target positively looks like a sandbox profile: a real
    // dir containing cli-server.json (a running lab), with a non-empty, path-like name to match.
    if (!sbName || sbName === '/' || sbName === '\\' || !/^[a-z0-9_.-]+$/i.test(sbName) || !fs.existsSync(path.join(profStr, 'cli-server.json'))) {
      console.error('TEARDOWN REFUSED: ' + profStr + ' is not a recognizable sandbox profile (need <dir>/profile/cli-server.json). No processes were touched.');
      process.exit(1);
    }
    // Exclusion by ancestry, computed INSIDE PowerShell: walk $PID's parent chain to the root and
    // spare every shell layer that merely carries the sandbox name in its command text. The
    // owner's live app never matches sbName, so excluding ancestors costs nothing.
    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$anc = @(); $p = $PID; while ($p) { $anc += $p; $p = (Get-CimInstance Win32_Process -Filter "ProcessId=$p").ParentProcessId }',
      'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*' + sbName + '*" -and $_.ProcessId -notin $anc } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
      'Start-Sleep -Seconds 2',
      'exit 0',
    ].join('\n');
    try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch (e) { /* kills may race; verify below is the truth */ }
    let gone = false;
    try { process.chdir(process.env.TEMP || process.cwd()); } catch (e) { console.warn('[constellation]', e && e.message || e); }   // a CWD inside the sandbox blocks root deletion on Windows
    for (let i = 0; i < 3 && !gone; i++) {
      gone = !fs.existsSync(String(profile));
      if (!gone) {
        // The sandbox's app/node_modules is a JUNCTION into the real repo — unlink the link
        // itself first (rmdir on a junction never follows it) or rmSync dies on EPERM.
        const root = path.dirname(String(profile));
        try { fs.rmdirSync(path.join(root, 'app', 'node_modules')); } catch (e) {}
        try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { console.warn('[constellation]', e && e.message || e); }
      }
      if (!gone) await new Promise(r => setTimeout(r, 1500));
    }
    if (fs.existsSync(String(profile))) { console.error('TEARDOWN FAILED: ' + profile + ' still exists. Most likely a shell is still cd-ed into the sandbox (Windows refuses to delete a process\u2019s working directory) — cd out and re-run.'); process.exit(1); }
    console.log('teardown complete: ' + path.dirname(String(profile)) + ' removed');
    return;
  }

  if (cmd === 'dry') {
    let msg = flag('msg', '');
    const probe = flag('probe', '');
    if (probe && probe !== true) msg = readArgFile(probe);
    if (!msg || msg === true) { console.error('dry needs --msg "text" or --probe FILE'); process.exit(1); }
    const body = { msg: String(msg).trim() };
    const sysFile = flag('system-file', '');
    if (sysFile && sysFile !== true) body.system = readArgFile(sysFile);
    const histFile = flag('history-file', '');
    if (histFile && histFile !== true) {
      try { body.history = parseHistoryInput(readArgFile(histFile)); }
      catch (e) { console.error('--history-file: ' + e.message); process.exit(1); }
    }
    const effort = flag('effort', '');
    if (effort && effort !== true) body.effort = String(effort);

    const draws = Math.max(1, parseInt(flag('draws', '1'), 10) || 1);
    const outFile = flag('out', '');
    const results = [];
    const t0 = Date.now();
    for (let d = 0; d < draws; d++) {
      const r = await serverCall(profile, '/dry-send', body);
      if (r && r.error) { console.error('DRY FAILED [' + errorClass(r.error) + ']: ' + r.error); process.exit(1); }
      if (r && !r.reply) console.error('NOTE: empty reply — most likely the reasoning consumed the max_tokens budget; raise it and retry.');
      results.push(r);
      let outP = null;
      if (outFile && outFile !== true) {
        outP = normPath(String(outFile));
        if (draws > 1) outP = outP.replace(/(\.[^.]+)?$/, (d ? '-'.concat(String.fromCharCode(97 + d)) : '-a') + '$1');
        fs.mkdirSync(path.dirname(outP), { recursive: true });
        fs.writeFileSync(outP, JSON.stringify({ probe: body.msg, system: body.system || null, history: body.history || null, result: r, at: new Date().toISOString() }, null, 2));
      }
      const secs = Math.round((Date.now() - t0) / 1000);
      if (flag('json', false)) { console.log(JSON.stringify(r)); continue; }
      if (draws > 1) console.log('--- draw ' + (d + 1) + '/' + draws + ' ---');
      console.log('=== REPLY ===');
      console.log(r.reply || '(empty)');
      const rn = String(r.reasoning || '').length;
      const mr = flag('max-reason', '');   // digest is OPT-IN: full reasoning is the default (steering signal lives mid-deliberation)
      console.log('=== REASONING (' + (mr && mr !== true ? 'digest of ' + rn : 'full, ' + rn) + ' chars) ===');
      console.log(mr && mr !== true ? digestReason(r.reasoning, Number(mr)) : (r.reasoning || '(none)'));
      console.log('=== META ===');
      const u = r.usage ? (' · usage: prompt ' + (r.usage.prompt_tokens ?? '?') + ' / completion ' + (r.usage.completion_tokens ?? '?')) : '';
      console.log('system overridden: ' + (r.systemOverridden ? 'yes' : 'no') + ' · history overridden: ' + (r.historyOverridden ? 'yes' : 'no') + ' · trimmed: ' + (r.trimmedMessages || 0) + ' msg(s) · ~' + (r.estReqTokens || 0) + ' req tokens' + u + ' · ' + secs + 's' + ' · phrase bans: ' + (r.bansApplied ? 'yes' : 'no') + ' · lore: ' + (r.lore ? r.lore.length : 0) + (outP ? ' · saved: ' + outP : ''));
    }
    return;
  }
  console.error('lab commands: ping | state | teardown | dry');
  process.exit(1);
}

(async () => {
  const cmd = process.argv[2], arg = process.argv[3];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
  if (cmd === 'ping' || cmd === 'state' || cmd === 'dry' || cmd === 'teardown') return labMain(cmd);

  if (cmd === 'lorebooks' || cmd === 'lb') {
    const map = loadLorebooks(), ids = Object.keys(map);
    if (!ids.length) return console.log('No lorebooks.');
    for (const id of ids) { const lb = map[id]; const ch = (lb.entries || []).reduce((n, e) => n + (e.content || '').length, 0);
      console.log(`${id}  "${lb.name || 'Untitled'}"  entries:${(lb.entries || []).length}  ~${ch} chars  semantic:${!!lb.semantic}`); }
    return;
  }

  if (cmd === 'entries') {
    if (!arg) return console.log('usage: node cli.js entries <name|id>');
    const lb = findLorebook(loadLorebooks(), arg);
    if (!lb) return console.log('Lorebook not found: ' + arg);
    console.log('"' + (lb.name || 'Untitled') + '" — ' + (lb.entries || []).length + ' entries:');
    (lb.entries || []).forEach((e, i) => {
      const k = (e.keys && e.keys.length) ? 'keys:[' + e.keys.join(',') + ']' : 'smart';
      const t = [e.enabled ? '' : 'OFF', e.constant ? 'CONST' : ''].filter(Boolean).join(' ');
      console.log(`  [${i}] ${k} ${t}  ${(e.content || '').replace(/\s+/g, ' ').slice(0, 70)}`);
    });
    return;
  }

  if (cmd === 'sessions') {
    const map = loadLorebooks(), ss = loadSessions();
    if (!ss.length) return console.log('No sessions.');
    for (const s of ss) { const names = (s.lore || []).map((id) => map[id] ? '"' + map[id].name + '"' : id).join(', ') || '(none)';
      console.log(`${s.id}  "${(s.title || 'Untitled').slice(0, 30)}"  lore: ${names}`); }
    return;
  }

  if (cmd === 'retrieve') {
    const query = arg;
    if (!query) return console.log('usage: node cli.js retrieve "<query>" [--chat <id> | --lore <name,id>]');
    const map = loadLorebooks();
    let chatId = null, loreArg = null;
    for (let i = 4; i < process.argv.length; i++) {
      if (process.argv[i] === '--chat') chatId = process.argv[++i];
      else if (process.argv[i] === '--lore') loreArg = process.argv[++i];
    }
    let ids;
    if (loreArg) ids = loreArg.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const lb = findLorebook(map, s); return lb ? lb.id : s; });
    else if (chatId) ids = (readJSON(path.join(SESS_DIR, chatId + '.json'), {}).lore || []);
    else ids = Object.keys(map);
    const activeLore = ids.map((id) => map[id]).filter(Boolean);
    const res = await lore.buildLoreContext(activeLore, query, null);   // BM25 path (no embedder in the CLI)
    console.log(`query: "${query}"`);
    console.log(`active: ${activeLore.map((lb) => '"' + lb.name + '"').join(', ') || '(none)'}`);
    console.log(`pulled ${res.items.length} passage(s):` + (res.items.length ? '' : ' (none)'));
    res.items.forEach((it, i) => console.log(`  [${i}] (${it.label}) ${(it.text || '').replace(/\s+/g, ' ').slice(0, 120)}`));
    return;
  }

  if (cmd === 'bans') {
    const text = arg;
    if (text == null) return console.log('usage: node cli.js bans "<text>"');
    const rules = bans.parse(readText(BANS_FILE));
    console.log(`phrase-ban rules loaded: ${rules.length}`);
    console.log('in : ' + text);
    console.log('out: ' + bans.apply(text, rules));
    return;
  }

  if (cmd === 'inspect') {
    const map = loadLorebooks(), ss = loadSessions();
    console.log('data dir:', DATA);
    console.log('lorebooks:', Object.keys(map).length);
    for (const id of Object.keys(map)) { const lb = map[id]; console.log(`  - "${lb.name}" (${(lb.entries || []).length} entries, semantic:${!!lb.semantic})`); }
    console.log('sessions:', ss.length);
    console.log('phrase-ban rules:', bans.parse(readText(BANS_FILE)).length);
    return;
  }

  console.log('Unknown command: ' + cmd);
  help();
})();
