// Real-cosmic starfield: pure black, pinpoint stars, slow twinkle, faint drift, pointer parallax.
// Bright-star glow is a cached sprite (no per-frame gradient); the rAF loop pauses when hidden.
var Constellation = window.Constellation || (window.Constellation = {});

Constellation.starfield = (function () {
  const canvas = document.getElementById('starfield');
  if (!canvas) return { setDensity() {}, setTwinkle() {} };
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0, dpr = 1;
  let stars = [];
  const BASE_DENSITY = 0.00018;   // ~200–350 stars at density 1
  let densityMul = 1;
  let twinkleMul = 1;

  // Parallax: target offset from the pointer (-1..1), eased each frame toward ox/oy.
  let targetX = 0, targetY = 0;
  let ox = 0, oy = 0;

  // Cached glow sprite for the bright anchors (built once, drawn scaled per star).
  let glow = null;
  function buildGlow() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(200,215,255,0.9)');
    grad.addColorStop(0.4, 'rgba(200,215,255,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glow = c;
  }

  function makeStar() {
    const bright = Math.random() < 0.06;   // a few bright anchors
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: bright ? 1.1 + Math.random() * 1.1 : 0.4 + Math.random() * 0.9,
      baseAlpha: bright ? 0.75 + Math.random() * 0.25 : 0.12 + Math.random() * 0.5,
      twinkleAmp: 0.15 + Math.random() * 0.35,
      twinkleSpeed: 0.4 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      tinted: Math.random() < 0.25,          // some faintly blue-white
      drift: (Math.random() - 0.5) * 0.015,  // very slow vertical drift
      depth: Math.random(),                  // parallax depth: 0 = far, 1 = near
    };
  }
  function buildStars() {
    const count = Math.max(60, Math.min(520, Math.floor(w * h * BASE_DENSITY * densityMul)));
    stars = [];
    for (let i = 0; i < count; i++) stars.push(makeStar());
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
  }

  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }

  let running = true;
  function frame(t) {
    if (!running) return;
    const time = t / 1000;
    ox += (targetX - ox) * 0.05;   // ease the parallax offset for a liquid follow
    oy += (targetY - oy) * 0.05;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    for (const s of stars) {
      const tw = Math.sin(time * s.twinkleSpeed * twinkleMul * moodCur.twinkle + s.phase);
      let alpha = Math.max(0, Math.min(1, s.baseAlpha + tw * s.twinkleAmp * (s.baseAlpha * 0.6)));
      alpha = Math.min(1, alpha * moodCur.dim);
      const br = s.tinted ? 190 : 255, bg = s.tinted ? 210 : 255;
      const rgb = [
        Math.round(br + (moodCur.r - br) * moodCur.amt),
        Math.round(bg + (moodCur.g - bg) * moodCur.amt),
        Math.round(255 + (moodCur.b - 255) * moodCur.amt),
      ];
      const k = 4 + s.depth * 18;            // near stars (depth→1) shift a little more than far
      const sx = s.x + ox * k;
      const sy = s.y + oy * k;

      if (s.r > 1.4 && glow) {                // bright anchors: cached glow sprite
        const gr = s.r * 4;
        ctx.globalAlpha = alpha * 0.35;
        ctx.drawImage(glow, sx - gr, sy - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = rgba(rgb, alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();

      s.y += s.drift;
      if (s.y < -2) s.y = h + 2;
      if (s.y > h + 2) s.y = -2;
    }

    // Ease the weather toward its target mood (about 10–15s to fully turn).
    moodCur.r += (moodTarget.r - moodCur.r) * 0.004;
    moodCur.g += (moodTarget.g - moodCur.g) * 0.004;
    moodCur.b += (moodTarget.b - moodCur.b) * 0.004;
    moodCur.amt += (moodTarget.amt - moodCur.amt) * 0.004;
    moodCur.twinkle += (moodTarget.twinkle - moodCur.twinkle) * 0.004;
    moodCur.dim += (moodTarget.dim - moodCur.dim) * 0.004;

    requestAnimationFrame(frame);
  }

  function setDensity(mul) {
    densityMul = Math.max(0, Number(mul) || 0);
    const target = Math.max(60, Math.min(520, Math.floor(w * h * BASE_DENSITY * densityMul)));
    if (target > stars.length) {
      for (let i = stars.length; i < target; i++) stars.push(makeStar());
    } else if (target < stars.length) {
      stars.length = target;
    }
  }
  function setTwinkle(mul) { twinkleMul = Math.max(0, Number(mul) || 0); }

  // Mood-weather: the whole sky eases toward an emotional tone set by mood.js — tint mix,
  // twinkle speed, overall dimness. Weather, not a switch: transitions take ~10–15 seconds.
  let moodCur = { r: 255, g: 255, b: 255, amt: 0, twinkle: 1, dim: 1 };
  let moodTarget = { r: 255, g: 255, b: 255, amt: 0, twinkle: 1, dim: 1 };
  function setMood(m, snap) {
    if (!m) return;
    moodTarget = {
      r: m.tint ? m.tint[0] : 255, g: m.tint ? m.tint[1] : 255, b: m.tint ? m.tint[2] : 255,
      amt: Math.max(0, Math.min(0.5, m.amt || 0)),
      twinkle: Math.max(0, Math.min(3, m.twinkle != null ? m.twinkle : 1)),
      dim: Math.max(0.3, Math.min(1.3, m.dim != null ? m.dim : 1)),
    };
    if (snap) moodCur = { r: moodTarget.r, g: moodTarget.g, b: moodTarget.b, amt: moodTarget.amt, twinkle: moodTarget.twinkle, dim: moodTarget.dim };
  }

  // Pause when the window is hidden (minimized / covered) — free CPU/battery.
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  window.addEventListener('mousemove', (e) => {
    targetX = (e.clientX / w - 0.5) * 2;   // -1..1
    targetY = (e.clientY / h - 0.5) * 2;
  });
  window.addEventListener('resize', resize);
  buildGlow();
  resize();
  requestAnimationFrame(frame);

  return { setDensity, setTwinkle, setMood };
})();
