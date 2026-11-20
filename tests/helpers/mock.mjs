// e2e helper — spawn the scenario mock on its OWN port (7391) so the suite never touches
// the shared lab mock (7390) or anything else. Killed by PID on teardown.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E_MOCK_PORT = 7391;

export async function spawnMock() {
  const child = spawn(process.execPath, [path.join(REPO, '..', 'lab', 'mock-server.mjs')], {
    env: Object.assign({}, process.env, { MOCK_PORT: String(E2E_MOCK_PORT) }),
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${E2E_MOCK_PORT}/v1`;
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'health' }] }), signal: AbortSignal.timeout(1500),
      });
      if (r.ok) up = true;
    } catch (e) { await sleep(150); }
  }
  if (!up) { try { child.kill(); } catch (e) {} throw new Error('mock on ' + E2E_MOCK_PORT + ' never came up'); }
  return { child, port: E2E_MOCK_PORT, base };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
