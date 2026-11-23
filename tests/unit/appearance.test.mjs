// Appearance math that lives in the shared engines module: the color-word bank and its
// everyday-word rule, the display tints, and the smart-quotes pass (display only).
// Source is pure ASCII on purpose — every curly mark is written as an escape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../src/js/engines.js');
const C = E.colors;
const Q = String.fromCharCode(39), DQ = String.fromCharCode(34);
const LDQ = '\u201C', RDQ = '\u201D', LSQ = '\u2018', RSQ = '\u2019';
const BG = { r: 8, g: 9, b: 17 };   // the darkest message surface
const rgbOf = (css) => { const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(css); assert.ok(m, 'expected an rgb() color, got: ' + css); return { r: +m[1], g: +m[2], b: +m[3] }; };

// ---------------- color words ----------------
test('color bank: every name is in the bank and the pattern finds words and hex literals', () => {
  assert.equal(C.names.length, 223);
  assert.equal(C.bank.cobalt, '#0047ab');
  const re = C.pattern();
  const hits = (s) => { re.lastIndex = 0; const out = []; let m; while ((m = re.exec(s))) out.push(m[0]); return out; };
  assert.deepEqual(hits('cobalt and #ffbf00'), ['cobalt', '#ffbf00']);
  assert.equal(C.pattern(), re, 'compiled once');
});

test('ordinary color names are colors anywhere', () => {
  assert.equal(C.isColorHere('cobalt', 'a ', ' ring'), true);
  assert.equal(C.isColorHere('Emerald', '', ' eyes caught the lamp'), true);
  assert.equal(C.isColorHere('crimson', 'The ', ' stamp'), true);
});

test('a capitalized color word used as a NAME is not a color', () => {
  assert.equal(C.isColorHere('Amber', 'She looked at ', ' and waited'), false, 'mid-sentence');
  assert.equal(C.isColorHere('Amber', '', ' said nothing'), false, 'opens the sentence, a verb follows');
  assert.equal(C.isColorHere('Rose', '', Q + 's hand was cold'), false, 'possessive');
  assert.equal(C.isColorHere('Violet', 'Later, ', ' turned away'), false);
  // ...but a genuine color still tints after a full stop
  assert.equal(C.isColorHere('Amber', 'The lamp burned. ', ' light filled the room'), true);
});

test('everyday thing-words tint only inside an explicit colour construction', () => {
  const plain = [['fog', 'if the ', ' holds'], ['dawn', 'before ', ' watch'], ['wine', 'a glass of ', ' and bread'], ['rose', 'She ', ' from the chair'], ['storm', 'The ', ' broke'], ['sky', 'The ', ' was low'], ['coffee', 'black ', ', no sugar'], ['peach', 'a ripe ', ' on the plate']];
  for (const [w, p, n] of plain) assert.equal(C.isColorHere(w, p, n), false, w + ' is a thing here');
  assert.equal(C.isColorHere('fog', 'a ', '-grey morning'), true, 'hyphen compound');
  assert.equal(C.isColorHere('royal', '', ' blue cloak'), true, 'space compound');
  assert.equal(C.isColorHere('rose', 'a ', ' tint lingered'), true, 'colour cue');
  assert.equal(C.isColorHere('wine', 'shades of ', ' and gold'), true, 'shades of');
  for (const w of C.everyday) assert.ok(C.bank[w], 'everyday word must be a bank word: ' + w);
  // the things-first list does not swallow real color names
  for (const w of ['crimson', 'cobalt', 'emerald', 'magenta', 'azure', 'amber', 'ivory', 'gold', 'silver']) assert.ok(!C.everyday.includes(w), w);
});

test('color words: every bank color becomes a tinted ink that stays readable', () => {
  let min = Infinity, darkest = null;
  for (const name of C.names) {
    const t = rgbOf(C.inkTint(C.bank[name]));
    const cr = C.contrastRatio(t, BG);
    if (cr < min) { min = cr; darkest = name; }
    assert.ok(cr >= 4.5, name + ' contrast ' + cr);
  }
  assert.ok(min >= 4.5, 'lowest contrast ' + min + ' (' + darkest + ')');
});

test('color words: hue is kept, the raw edge comes off, dark words stay darkest, white is left alone', () => {
  const blue = rgbOf(C.inkTint('#0000ff'));
  assert.ok(blue.b > blue.r && blue.b > blue.g, 'still blue');
  assert.ok(blue.r >= 60, 'no longer pure #00f: ' + JSON.stringify(blue));
  const amber = rgbOf(C.inkTint('#ffbf00'));
  assert.ok(amber.r > amber.b && amber.g > amber.b, 'still amber');
  assert.ok(amber.b > 0, 'the yellow is softened: ' + JSON.stringify(amber));
  const black = rgbOf(C.inkTint('#000000'));
  assert.ok(black.r < 150 && black.r === black.g && black.g === black.b, 'black stays a neutral grey: ' + JSON.stringify(black));
  assert.ok(C.contrastRatio(black, BG) >= 4.5);
  assert.deepEqual(rgbOf(C.inkTint('#ffffff')), { r: 255, g: 255, b: 255 });
  assert.equal(C.inkTint('nope'), null);
});

test('glow tint is the pastel of its hue, lighter than the raw color', () => {
  const raw = { r: 255, g: 191, b: 0 };
  const p = rgbOf(C.glowTint('#ffbf00'));
  assert.ok(p.r >= raw.r && p.g > raw.g && p.b > raw.b, 'lighter in every channel');
  assert.ok(p.r > p.b, 'still warm');
  assert.deepEqual(rgbOf(C.glowTintRgb(raw)), p);
  assert.equal(C.glowTint('nope'), null);
});

test('event tint keeps the old dark-hue floor and leaves bright colors alone', () => {
  assert.deepEqual(rgbOf(C.eventTint('#ffbf00')), { r: 255, g: 191, b: 0 });
  const onyx = rgbOf(C.eventTint('#353839'));
  assert.ok(onyx.r > 0x35 * 1.5, 'dark hue lifted: ' + JSON.stringify(onyx));
});

// ---------------- smart quotes ----------------
test('smart quotes: dialogue gets curly marks chosen from context', () => {
  const out = E.smartQuotes('<p>' + DQ + 'Hello,' + DQ + ' she said. ' + DQ + 'It' + Q + 's fine.' + DQ + '</p>');
  assert.equal(out, '<p>' + LDQ + 'Hello,' + RDQ + ' she said. ' + LDQ + 'It' + RSQ + 's fine.' + RDQ + '</p>');
});

test('smart quotes: context is tracked across inline tags and line breaks', () => {
  assert.equal(E.smartQuotes('<p>He said <strong>' + DQ + 'no' + DQ + '</strong> and left.</p>'), '<p>He said <strong>' + LDQ + 'no' + RDQ + '</strong> and left.</p>');
  assert.equal(E.smartQuotes('<p>' + DQ + 'One.' + DQ + '<br>' + DQ + 'Two.' + DQ + '</p>'), '<p>' + LDQ + 'One.' + RDQ + '<br>' + LDQ + 'Two.' + RDQ + '</p>');
  assert.equal(E.smartQuotes('<ul><li>' + DQ + 'a' + DQ + '</li><li>' + DQ + 'b' + DQ + '</li></ul>'), '<ul><li>' + LDQ + 'a' + RDQ + '</li><li>' + LDQ + 'b' + RDQ + '</li></ul>');
});

test('smart quotes: code, panes and attributes are never touched', () => {
  const code = '<p>a <code>' + Q + 'raw' + Q + ' ' + DQ + 'x' + DQ + '</code> and it' + Q + 's prose</p>';
  assert.equal(E.smartQuotes(code), '<p>a <code>' + Q + 'raw' + Q + ' ' + DQ + 'x' + DQ + '</code> and it' + RSQ + 's prose</p>');
  const pre = '<pre><code>const a = ' + DQ + 'b' + DQ + ';</code></pre>';
  assert.equal(E.smartQuotes(pre), pre);
  const pane = '<div class="codeblock prose"><div class="prose-content"><p>' + DQ + 'signed' + DQ + '</p></div></div>';
  assert.equal(E.smartQuotes(pane), pane);
  assert.equal(E.smartQuotes('<a href="/x?a=1&amp;b=2" title="q">' + DQ + 't' + DQ + '</a>'), '<a href="/x?a=1&amp;b=2" title="q">' + LDQ + 't' + RDQ + '</a>');
});

test('smart quotes: nested single quotes, measurements, dropped letters', () => {
  assert.equal(E.smartQuotes('<p>' + DQ + 'It' + Q + 's ' + Q + 'fine,' + Q + DQ + ' he said.</p>'), '<p>' + LDQ + 'It' + RSQ + 's ' + LSQ + 'fine,' + RSQ + LDQ + ' he said.</p>');
  assert.equal(E.smartQuotes('<p>5' + Q + '10' + DQ + '</p>'), '<p>5' + RSQ + '10' + RDQ + '</p>');
  assert.equal(E.smartQuotes('<p>' + Q + 'til the ' + Q + '99 end, rock ' + Q + 'n' + Q + ' roll</p>'), '<p>' + RSQ + 'til the ' + RSQ + '99 end, rock ' + RSQ + 'n' + RSQ + ' roll</p>');
});

test('smart quotes: an em dash or an opener invites an opening mark; a streaming fragment opens', () => {
  assert.equal(E.smartQuotes('<p>wait\u2014' + DQ + 'now' + DQ + '</p>'), '<p>wait\u2014' + LDQ + 'now' + RDQ + '</p>');
  assert.equal(E.smartQuotes('<p>(' + DQ + 'aside' + DQ + ')</p>'), '<p>(' + LDQ + 'aside' + RDQ + ')</p>');
  assert.equal(E.smartQuotes('<p>' + DQ + 'Wait</p>'), '<p>' + LDQ + 'Wait</p>');
});

test('smart quotes: text without quotes is returned untouched', () => {
  const s = '<p>plain <strong>text</strong> &amp; entities</p>';
  assert.equal(E.smartQuotes(s), s);
});
