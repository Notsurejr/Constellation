// Generates build/icon.ico for the Constellation app.
// Pure-JS rasterizer (no native deps): draws a dark cosmic field with a pale-blue
// constellation motif, renders a 1024px master, downscales to standard icon sizes,
// and packs them into a multi-resolution .ico.
//
// Re-run anytime with:  node build/icon-render.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const toIco = require('to-ico');

const N = 1024;                 // master resolution
const OUT_DIR = __dirname;

// ---- Tunable look (edit these to restyle the icon) -------------------------
const BG_INNER  = [20, 24, 50]; // deep blue-black toward the middle
const BG_OUTER  = [4, 5, 12];   // near-black at the edges
const STAR_GLOW = [150, 170, 255]; // pale starlight blue
const STAR_CORE = [236, 240, 255]; // bright white-blue core
const LINE_RGB  = [120, 145, 235]; // constellation connector lines
const NEBULA    = [55, 78, 165];   // faint blue depth glow
const CORNER_R  = 0.20;        // rounded-corner radius as fraction of size

// Constellation nodes, normalized 0..1 (x right, y down).
// 'sp' = sparkle (bright 4-point star); plain nodes are glowing dots.
const NODES = [
  { x: 0.22, y: 0.67, r: 0.018 },
  { x: 0.33, y: 0.57, r: 0.020 },
  { x: 0.45, y: 0.51, r: 0.026, sp: true, big: false },
  { x: 0.59, y: 0.47, r: 0.055, sp: true, big: true },  // focal sparkle
  { x: 0.70, y: 0.36, r: 0.020 },
  { x: 0.64, y: 0.23, r: 0.022 },
  { x: 0.48, y: 0.28, r: 0.018 },
];
// Connected pairs (indices into NODES) draw the constellation lines.
const LINKS = [[0,1],[1,2],[2,3],[3,4],[4,5],[3,6]];
// Scattered background pinpoints.
const PINPOINTS = [
  [0.15,0.20],[0.81,0.17],[0.88,0.55],[0.12,0.45],[0.30,0.12],[0.63,0.79],
  [0.20,0.88],[0.85,0.83],[0.91,0.31],[0.40,0.86],[0.55,0.66],[0.26,0.40],
];
// ----------------------------------------------------------------------------

const buf = new Float32Array(N * N * 4); // RGBA 0..255

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
function addRGB(i, r, g, b) {
  buf[i]   += r; buf[i+1] += g; buf[i+2] += b;
}
function gauss(d, sigma) { return Math.exp(-(d * d) / (sigma * sigma)); }

// Rounded-rect signed distance (negative = inside). Square of size N, radius r.
function rectSDF(px, py, r) {
  const h = N / 2;
  const qx = Math.abs(px - h) - (h - r);
  const qy = Math.abs(py - h) - (h - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 8-vertex 4-pointed star polygon at (cx,cy), outer R, inner r.
function sparklePoly(cx, cy, R, r) {
  return [
    [cx,     cy - R], [cx + r, cy - r], [cx + R, cy],     [cx + r, cy + r],
    [cx,     cy + R], [cx - r, cy + r], [cx - R, cy],     [cx - r, cy - r],
  ];
}
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

const R = CORNER_R * N;
const nodesPx = NODES.map(n => ({ x: n.x * N, y: n.y * N, r: n.r * N, sp: n.sp, big: n.big }));
const linksPx = LINKS.map(([a, b]) => [nodesPx[a], nodesPx[b]]);
const pinPx = PINPOINTS.map(([x, y]) => [x * N, y * N]);

// Precompute sparkle polygons (big and small variants).
function sparkleFor(n) {
  const R = n.r * 1.0;          // outer = node radius
  const ir = R * 0.20;          // sharp inner
  return sparklePoly(n.x, n.y, R, ir);
}
const sparkles = nodesPx.filter(n => n.sp).map(n => ({ n, poly: sparkleFor(n) }));

// ---- Single pass over the master grid --------------------------------------
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (rectSDF(px, py, R) > 0) continue;          // outside rounded square

    // Background radial gradient.
    const cx = N / 2, cy = N * 0.46;
    const t = Math.min(1, Math.hypot(px - cx, py - cy) / (N * 0.62));
    let r = BG_INNER[0] + (BG_OUTER[0] - BG_INNER[0]) * t;
    let g = BG_INNER[1] + (BG_OUTER[1] - BG_INNER[1]) * t;
    let b = BG_INNER[2] + (BG_OUTER[2] - BG_INNER[2]) * t;

    // Faint nebula depth glow centered on the cluster.
    const nd = Math.hypot(px - N * 0.5, py - N * 0.46);
    const neb = gauss(nd, N * 0.22) * 0.30;
    r += NEBULA[0] * neb; g += NEBULA[1] * neb; b += NEBULA[2] * neb;

    // Constellation connector lines (soft glow).
    for (const [a, b2] of linksPx) {
      const d = distToSeg(px, py, a.x, a.y, b2.x, b2.y);
      if (d > N * 0.025) continue;
      const k = gauss(d, N * 0.0042) * 0.45;
      r += LINE_RGB[0] * k; g += LINE_RGB[1] * k; b += LINE_RGB[2] * k;
    }

    // Plain node dots: glow + bright core.
    for (const nd2 of nodesPx) {
      const d = Math.hypot(px - nd2.x, py - nd2.y);
      const cutoff = nd2.r * (nd2.sp ? 0 : 4.5);
      if (!nd2.sp && d < nd2.r * 4.5) {
        const k = gauss(d, nd2.r * 1.7) * 0.55;
        r += STAR_GLOW[0] * k; g += STAR_GLOW[1] * k; b += STAR_GLOW[2] * k;
        if (d < nd2.r * 0.9) {
          const c = gauss(d, nd2.r * 0.5);
          r += (STAR_CORE[0] - r) * c; g += (STAR_CORE[1] - g) * c; b += (STAR_CORE[2] - b) * c;
        }
      }
    }

    // Sparkles: surrounding glow + crisp 4-point fill.
    for (const s of sparkles) {
      const d = Math.hypot(px - s.n.x, py - s.n.y);
      const amp = s.n.big ? 0.9 : 0.6;
      if (d < s.n.r * 5) {
        const k = gauss(d, s.n.r * (s.n.big ? 1.7 : 1.4)) * amp;
        r += STAR_GLOW[0] * k; g += STAR_GLOW[1] * k; b += STAR_GLOW[2] * k;
      }
      if (inPoly(px, py, s.poly)) {
        const edge = Math.min(d, 1) / 1; // slight body brighten
        r = STAR_CORE[0]; g = STAR_CORE[1]; b = STAR_CORE[2];
        void edge;
      }
    }

    // Scattered pinpoints.
    for (const [ppx, ppy] of pinPx) {
      const d = Math.hypot(px - ppx, py - ppy);
      if (d > N * 0.010) continue;
      const k = gauss(d, N * 0.0026) * 0.7;
      r += STAR_CORE[0] * k; g += STAR_CORE[1] * k; b += STAR_CORE[2] * k;
    }

    const i = (y * N + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255;
  }
}

// ---- Encode master to PNG (for preview) ------------------------------------
function encodePNG(src, w) {
  const png = new PNG({ width: w, height: w });
  const data = png.data;
  if (w === N) {
    for (let k = 0; k < src.length; k++) data[k] = clamp(src[k]);
  } else {
    const k = N / w;
    for (let ty = 0; ty < w; ty++) {
      for (let tx = 0; tx < w; tx++) {
        let R2 = 0, G2 = 0, B2 = 0, A2 = 0, count = 0;
        const x0 = Math.floor(tx * k), x1 = Math.floor((tx + 1) * k);
        const y0 = Math.floor(ty * k), y1 = Math.floor((ty + 1) * k);
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const idx = (yy * N + xx) * 4;
            const a = src[idx + 3];
            R2 += src[idx] * a; G2 += src[idx+1] * a; B2 += src[idx+2] * a; A2 += a;
            count++;
          }
        }
        const o = (ty * w + tx) * 4;
        if (A2 > 0) {
          data[o]   = clamp(R2 / A2);
          data[o+1] = clamp(G2 / A2);
          data[o+2] = clamp(B2 / A2);
          data[o+3] = clamp(A2 / count);
        }
      }
    }
  }
  return PNG.sync.write(png);
}

(async () => {
  const sizes = [256, 128, 64, 48, 32, 16];
  // Preview at 256 (and 512 upscaled view via master crop).
  fs.writeFileSync(path.join(OUT_DIR, 'icon-preview.png'), encodePNG(buf, 256));
  const pngs = sizes.map(s => encodePNG(buf, s));
  const ico = await toIco(pngs);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
  console.log('Wrote build/icon.ico (' + sizes.join(',') + ' sizes) and build/icon-preview.png');
})().catch(e => { console.error(e); process.exit(1); });
