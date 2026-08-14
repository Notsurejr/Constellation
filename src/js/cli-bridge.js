// CLI bridge (Shape A): the in-app localhost server (in the main process) forwards commands here;
// we dispatch them to the live modules (chat) and reply. All handlers are non-destructive.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.cliBridge = (function () {
  async function dispatch(cmd, args) {
    const chat = Constellation.chat;
    args = args || {};
    if (cmd === 'ping') return { ok: true };
    if (cmd === 'state') return chat.getState();
    if (cmd === 'retrieve') return await chat.testRetrieve(String(args.q || ''));
    if (cmd === 'bans') return chat.testBans(String(args.text || ''));
    if (cmd === 'dry-send') return await chat.dryRun(String(args.msg || ''));
    return { error: 'unknown command: ' + cmd };
  }
  function init() {
    if (!window.api || !window.api.onCliReq || !window.api.sendCliRes) return;
    window.api.onCliReq(async (req) => {
      let res;
      try { res = await dispatch(req.cmd, req.args); }
      catch (e) { res = { error: String((e && e.message) || e) }; }
      window.api.sendCliRes({ id: req.id, res });
    });
  }
  return { init };
})();
