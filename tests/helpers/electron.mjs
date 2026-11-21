// e2e helper — launch the app in an isolated profile (CONSTELLATION_USER_DATA) on its own
// ports, connect over raw-WebSocket CDP, and tear everything down by PID. The shared
// .lab-sandbox and the installed app are never touched.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './mock.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E_CDP_PORT = 9233;
export { sleep };   // re-exported from mock.mjs for the suite runners

// Pre-flight: kill stale repo-launched electron instances left over from an interrupted
// run (they hold the CDP port and the disposable profile). Matches ONLY processes named
// electron.exe whose command line contains this repo's path — the installed app runs as
// Constellation.exe from a different location and is never touched.
function killStaleRepoInstances() {
  try {
    const script = `
      $procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
      foreach ($p in $procs) {
        if ($p.CommandLine -like '*${REPO.replace(/'/g, "''")}*') {
          try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {}
        }
      }`;
    spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 20000 });
  } catch (e) { /* best effort */ }
}

export async function launchApp({ userData, cliPort, cdpPort = E2E_CDP_PORT }) {
  killStaleRepoInstances();   // close previous sandbox runs before launching (user rule)
  await sleep(400);
  const child = spawn('npx', ['electron', '.', '--remote-debugging-port=' + cdpPort,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      CONSTELLATION_USER_DATA: userData,
      CONSTELLATION_PORT: String(cliPort),
    }),
    stdio: 'ignore',
    shell: true,
  });
  // wait for CDP
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) });
      const t = await r.json();
      const page = t.find((x) => x.type === 'page' && String(x.url).startsWith('file://'));
      if (page) { targets = page; break; }
    } catch (e) { await sleep(300); }
  }
  if (!targets) { try { child.kill(); } catch (e) {} throw new Error('app never exposed CDP on ' + cdpPort); }

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push({ at: Date.now(), method: m.method, params: m.params || {} });
  };
  async function call(method, params = {}) {
    const k = ++id; const pr = new Promise((r) => pending.set(k, r));
    ws.send(JSON.stringify({ id: k, method, params }));
    return pr.then((m) => m.result || m.error);
  }
  async function ev(expression, awaitPromise = false) {
    const m = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (m && m.exceptionDetails) {
      const d = m.exceptionDetails;
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'page exception';
      throw new Error('page: ' + String(text).slice(0, 300));
    }
    return m && m.result ? m.result.value : undefined;
  }
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.bringToFront').catch(() => {});

  return {
    child, cdpPort, ws, call, ev, events,
    raise: () => call('Page.bringToFront').catch(() => {}),
    async kill() {
      try { ws.close(); } catch (e) {}
      // Windows: the shell:true wrapper means child.pid is the npx shell — kill the whole
      // process TREE or the Electron grandchildren survive (and lock the profile dir).
      try {
        const { spawnSync } = await import('node:child_process');
        if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (e) {}
      try { child.kill(); } catch (e) {}
      // wait until the app actually released its profile (CDP port closed)
      for (let i = 0; i < 15; i++) {
        try { await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(600) }); await sleep(300); }
        catch (e) { break; }
      }
      await sleep(400);
    },
  };
}
