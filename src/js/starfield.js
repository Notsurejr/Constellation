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
      const tw = Math.sin(time * s.twinkleSpeed * twinkleMul + s.phase);
      const alpha = Math.max(0, Math.min(1, s.baseAlpha + tw * s.twinkleAmp * (s.baseAlpha * 0.6)));
      const rgb = s.tinted ? [190, 210, 255] : [255, 255, 255];
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

  return { setDensity, setTwinkle };
})();
