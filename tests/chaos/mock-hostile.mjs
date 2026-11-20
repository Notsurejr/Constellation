// chaos helper — a HOSTILE OpenAI-compatible mock on its own port (7392). Behaviors are
// picked by the LAST USER message marker. Never talks to a real provider.
//   DROP         — headers + two SSE chunks, then the TCP socket is destroyed mid-stream
//   BADSSE       — malformed SSE frames (not JSON, wrong shapes, binary junk)
//   E401/E429/E500/E503 — HTTP error statuses (429/500 exercise the main-process retry path)
//   EMPTYCHOICES — chunks with choices: [] then a normal done
//   (default)    — a short valid reply (control)
import http from 'node:http';

const PORT = Number(process.env.CHAOS_MOCK_PORT) || 7392;

const server = http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let marker = '';
    try { const j = JSON.parse(body); const lu = [...(j.messages || [])].reverse().find((m) => m.role === 'user'); marker = (lu && lu.content) || ''; } catch (e) {}
    const send = (delta) => res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
    const done = () => { res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); };

    if (marker.includes('DROP')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      send({ content: 'The socket will die mid-sentence ' });
      send({ content: 'right about ' });
      setTimeout(() => res.destroy(), 250);   // TCP drop, no [DONE], no error frame
    } else if (marker.includes('BADSSE')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {not json at all}\n\n');
      res.write('data: {"choices": "a string, not an array"}\n\n');
      res.write('this line has no data: prefix at all\n\n');
      res.write('data: {"choices":[{"delta":{"content":"a valid bit after the junk "}}]}\n\n');
      setTimeout(done, 200);
    } else if (marker.includes('E401')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Bad key' } }));
    } else if (marker.includes('E429')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
    } else if (marker.includes('E500')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'server exploded' } }));
    } else if (marker.includes('E503')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unavailable' } }));
    } else if (marker.includes('EMPTYCHOICES')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (let i = 0; i < 4; i++) res.write('data: ' + JSON.stringify({ choices: [] }) + '\n\n');
      done();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      send({ content: 'Control reply. ' });
      setTimeout(done, 120);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('chaos hostile mock on ' + PORT));
