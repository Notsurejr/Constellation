// Craft mode: a writing coach. Analyzes your writing and logs takeaways to a growing journal.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.craft = (function () {
  function $(id) { return document.getElementById(id); }
  let busy = false;

  async function open() {
    $('craftOverlay').classList.add('open');
    $('craftResultSection').hidden = true;
    $('craftResult').querySelector('.body').textContent = '';
    await refreshJournal();
  }
  function close() { $('craftOverlay').classList.remove('open'); }

  function flash(id) {
    const el = $(id); if (!el) return;
    el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1200);
  }

  async function refreshJournal() {
    let text = '';
    try { text = await window.api.loadCraftJournal(); } catch (e) {}
    $('craftJournal').textContent = (text || '').trim() || 'No lessons yet.';
  }

  function extractTakeaway(text) {
    const m = String(text || '').match(/Craft takeaway:\s*(.+)/i);
    return m ? m[1].trim() : '';
  }

  async function pullFromChat() {
    const text = Constellation.chat && Constellation.chat.getUserWriting ? Constellation.chat.getUserWriting() : '';
    $('craftInput').value = text;
    flash('craftPulled');
  }

  async function analyze() {
    const source = $('craftInput').value.trim();
    if (!source || busy) return;
    busy = true;
    $('craftAnalyze').disabled = true;
    $('craftResultSection').hidden = false;
    const body = $('craftResult').querySelector('.body');
    body.textContent = '';
    body.classList.add('caret');

    let craftPrompt = '';
    try { const modes = await window.api.loadModes(); craftPrompt = (modes.craft || '').trim(); } catch (e) {}
    const messages = [
      { role: 'system', content: craftPrompt },
      { role: 'user', content: 'Here is my writing. Review it according to the instructions.\n\n---\n' + source },
    ];
    // Craft follows the active chat's model/thinking/etc., but keeps a low temperature for analysis.
    const o = Constellation.chat && Constellation.chat.getOptions ? Constellation.chat.getOptions() : {};
    const opts = {
      model: o.model || 'glm-5.2',
      temperature: 0.5,                       // analysis likes lower creativity
      topP: o.topP ?? 0.95,
      maxTokens: o.maxTokens ?? 0,
      thinking: !!o.thinking,
    };

    // smooth buffered output
    let buf = '', n = 0, streaming = true, raf = null;
    function pump() {
      raf = null;
      if (n < buf.length) {
        n = Math.min(buf.length, n + Math.max(2, Math.ceil((buf.length - n) * 0.25)));
        body.textContent = buf.slice(0, n);
      }
      if (streaming || n < buf.length) raf = requestAnimationFrame(pump);
      else body.classList.remove('caret');
    }
    raf = requestAnimationFrame(pump);

    window.api.chatStream(messages, opts, {
      onChunk: (d) => { buf += d; },
      onDone: async (full) => {
        streaming = false;
        if (full) buf = full;
        busy = false;
        $('craftAnalyze').disabled = false;
        if (!raf) raf = requestAnimationFrame(pump);
        const tk = extractTakeaway(buf);
        if (tk) {
          try { await window.api.appendCraftJournal(tk); } catch (e) {}
          await refreshJournal();
        }
      },
      onError: (msg) => {
        streaming = false;
        if (raf) cancelAnimationFrame(raf);
        body.classList.remove('caret');
        body.textContent = '⚠ ' + msg;
        busy = false;
        $('craftAnalyze').disabled = false;
      },
    });
  }

  function init() {
    $('craftBtn').addEventListener('click', open);
    $('closeCraft').addEventListener('click', close);
    $('craftPull').addEventListener('click', pullFromChat);
    $('craftAnalyze').addEventListener('click', analyze);
    $('craftOverlay').addEventListener('click', (e) => { if (e.target === $('craftOverlay')) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('craftOverlay').classList.contains('open')) close();
    });
  }

  return { init };
})();
