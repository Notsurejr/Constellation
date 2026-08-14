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
  console.log(`Constellation CLI  (read-only / test — nothing is written or sent)

  node cli.js lorebooks                         list lorebooks (id, name, entries, ~chars)
  node cli.js entries <name|id>                 list entries in a lorebook
  node cli.js sessions                          list chats + each chat's enabled lorebooks
  node cli.js retrieve "<query>" [filters]      show which lore passages pull for a query (BM25 path)
       filters:  --chat <id>      use that chat's enabled lorebooks
                 --lore <a,b>     use these lorebooks by name/id (default: ALL lorebooks)
  node cli.js bans "<text>"                     apply your saved phrase bans to <text>; show before/after
  node cli.js inspect                           overall data summary

  data dir: ${DATA}`);
}

(async () => {
  const cmd = process.argv[2], arg = process.argv[3];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();

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
