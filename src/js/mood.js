// Mood-weather sky: a small local lexicon reads the tone of the most recent writing and eases
// the whole starfield toward it — tension red-shifts and quickens the twinkle, sorrow dims and
// slows it, joy warms it, calm cools it. No API calls, no model involvement; it just reads words.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.mood = (function () {
  const LEX = {
    tense: 'blood|blades?|swords?|slammed?|screams?|screamed|shout|shouts?|rage|fury|snarl|strike|strikes?|punch|shove|shatter|chase|chased|fear|feared|terror|panic|danger|death|kill|killed|dying|dead|hurt|wounds?|burns?|burning|smoke|knives|knife|claws?|bite|bites?|hate|hated|angry|crash|crashes?|explod\\w*|fight|fights?|fighting|attack\\w*|flee|fled|dread|threat\\w*|venom|poison|cruel\\w*|storm|thunder|lightning|horror|monster|beasts?|violence|violent|gun|arrow|arrows?|fangs?|growls?|growled|roar|roars?|grab\\w*|threw|thrown|trapped|betray\\w*',
    sorrow: 'tears?|cried|crying|weep\\w*|grief|mourn\\w*|loss|lost|alone|lonely|empt(y|iness)|cold|ache|ached|aching|sorrow|sad\\w*|regret\\w*|goodbye|farewell|silence|silent|dim|faded?|forgotten|despair|hollow|heartbreak|miss(ed|ing)?|ghost|ghosts?|gone|funeral|grave|graves?|ashes|rain|rains?|grey|gray|winter|ruins?|broken|whisper\\w*|alone|loneliness|mourning',
    joy: 'laugh\\w*|smiled?|smiles?|joy\\w*|happ(y|iness)|warm(th)?|bright(er)?|hope\\w*|love(s|d)?|loved|kiss\\w*|delight\\w*|glee|cheer\\w*|danc\\w*|singing|sings?|song|songs?|golden|sun|sunlight|morning|spring|bloom\\w*|blossom\\w*|sweet|together|home|grin\\w*|playful|giggl\\w*|alive|freedom',
    calm: 'quiet(ly|ness)?|still(ness)?|calm(ly|ness)?|peace(ful)?|soft(ly|ness)?|slow(ly)?|gentl[ey]|gentle|rest(ful)?|sleeping|asleep|breath(e|ed|ing)?|steady|hush(ed)?|starlight|moonlight|serene|drift(s|ed|ing)?|float(s|ed|ing)?|settled|safe|cocoon'
  };
  const RE = {};
  for (const k in LEX) RE[k] = new RegExp('\\b(' + LEX[k] + ')\\b', 'gi');
  function count(re, s) { let n = 0; re.lastIndex = 0; let m; while ((m = re.exec(s))) n++; return n; }

  const TONES = {
    tense:   { tint: [255, 118, 108], amt: 0.34, twinkle: 2.0, dim: 1.0 },
    sorrow:  { tint: [148, 164, 205], amt: 0.40, twinkle: 0.45, dim: 0.55 },
    joy:     { tint: [255, 224, 158], amt: 0.30, twinkle: 1.25, dim: 1.10 },
    calm:    { tint: [168, 198, 255], amt: 0.22, twinkle: 0.80, dim: 0.90 },
    neutral: { tint: [255, 255, 255], amt: 0,    twinkle: 1.0,  dim: 1.0 }
  };

  let enabled = true;
  let lastTone = 'neutral';

  function apply(tone, snap) {
    lastTone = tone;
    if (window.Constellation && window.Constellation.starfield && window.Constellation.starfield.setMood) {
      window.Constellation.starfield.setMood(TONES[tone] || TONES.neutral, snap);
    }
  }

  // Read the tail of the recent writing (recent half counts 1.5×) and pick the dominant tone.
  function assess(text) {
    if (!enabled) return lastTone;
    const t = String(text || '').slice(-1600);
    if (!t.trim()) return lastTone;
    const half = Math.floor(t.length / 2);
    const front = t.slice(0, half), back = t.slice(half);
    let best = 'neutral', bestScore = 0, runnerUp = 0, total = 0;
    for (const k in RE) {
      const score = count(RE[k], front) + count(RE[k], back) * 1.5;
      total += score;
      if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = k; }
      else if (score > runnerUp) runnerUp = score;
    }
    if (bestScore < 2 || bestScore < total * 0.55) best = 'neutral';   // mixed signals → let the sky stay neutral
    apply(best);
    return best;
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) apply('neutral', true);
  }

  return { assess: assess, apply: apply, setEnabled: setEnabled, tone: function () { return lastTone; } };
})();
