// Character-card compile engine — pure text assembly, no DOM. Runs ONCE at "Start chat":
// the card's fields become a headed block, {{char}}/{{user}} resolve to real names, and the
// result is baked into the chat's system prompt beneath the chosen base instructions.
// Deliberately dropped from the prompt: creator_notes (author storefront), extensions,
// and the card's own system_prompt / post_history_instructions (ST injection points).
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.cardcompile = (function () {
  function substitute(text, charName, userName) {
    return String(text || '')
      .replace(/\{\{\s*char\s*\}\}/gi, charName)
      .replace(/\{\{\s*user\s*\}\}/gi, userName);
  }

  // The card block: WHO the model plays. Substitution happens here, once.
  function characterBlock(card, userName) {
    const name = String(card && card.name || 'The character');
    const parts = ['## Character — ' + name];
    if (card.description && String(card.description).trim()) parts.push(substitute(card.description, name, userName));
    if (card.personality && String(card.personality).trim()) parts.push('Personality: ' + substitute(card.personality, name, userName));
    if (card.scenario && String(card.scenario).trim()) parts.push('Scenario: ' + substitute(card.scenario, name, userName));
    if (card.mesExample && String(card.mesExample).trim()) {
      parts.push('### Example dialogue (voice reference, not events that happened)\n' + substitute(card.mesExample, name, userName));
    }
    return parts.join('\n\n');
  }

  // The persona block: WHO the user plays. Never added to non-character chats.
  function personaBlock(persona) {
    const name = String(persona && persona.name || 'You');
    const desc = String(persona && persona.description || '').trim();
    return '## You — ' + name + (desc ? '\n' + desc : '');
  }

  // Base instructions first (the HOW — the user's honed writing rules), then the character
  // (the WHO), then the persona. Each layer is independent; absence just skips it.
  function assemble(base, card, persona, userName) {
    const layers = [];
    if (base && String(base).trim()) layers.push(String(base).trim());
    if (card) layers.push(characterBlock(card, userName));
    if (persona) layers.push(personaBlock(persona));
    return layers.join('\n\n');
  }

  // chara_card_v2 character_book -> Constellation lorebook shape.
  // keys -> trigger words, content -> entry text, constant -> always-include; ST-only
  // machinery (depth/position/probability/selective logic) is ignored — our retrieval
  // engine has its own ranking.
  function bookToLore(card) {
    const book = card && card.characterBook;
    if (!book || !Array.isArray(book.entries) || !book.entries.length) return null;
    const entries = book.entries
      .filter((e) => e && e.content && String(e.content).trim())
      .map((e, i) => ({
        id: 'e' + (i + 1),
        enabled: e.enabled !== false,
        keys: Array.isArray(e.keys) ? e.keys.filter((k) => k && String(k).trim()).map(String) : [],
        content: String(e.content),
        constant: !!e.constant,
      }));
    if (!entries.length) return null;
    return { name: String(book.name || (card.name + ' — card book')), entries: entries };
  }

  function estimateTokens(text) { return Math.ceil(String(text || '').length / 4); }

  return { substitute: substitute, characterBlock: characterBlock, personaBlock: personaBlock, assemble: assemble, bookToLore: bookToLore, estimateTokens: estimateTokens };
})();
