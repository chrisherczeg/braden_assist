const canvas = document.getElementById('gameCanvas');
const distanceEl = document.getElementById('distance');
const restartButton = document.getElementById('restartButton');
const topScoresButton = document.getElementById('topScoresButton');
const ctx = canvas.getContext('2d');

const TOP_SCORES_KEY = 'purdueRunTopScores';

function loadTopScores() {
  try {
    const raw = localStorage.getItem(TOP_SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isFinite(n)) : [];
  } catch (err) {
    return [];
  }
}

function saveTopScore(score) {
  const scores = loadTopScores();
  scores.push(score);
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, 3);
  try {
    localStorage.setItem(TOP_SCORES_KEY, JSON.stringify(top));
  } catch (err) {
    /* ignore */
  }
  return top;
}

// Purdue landmarks that loom up on the roadside as you run.
const LANDMARKS = [
  { name: 'ROSS-ADE STADIUM', body: '#b8a36a', roof: '#6e5e34', type: 'stadium' },
  { name: 'MACKEY ARENA', body: '#8c8c95', roof: '#3a3a42', type: 'dome' },
  { name: 'SIGMA CHI', body: '#8a5a32', roof: '#4a2f18', type: 'house' },
  { name: 'CHI OMEGA', body: '#9a4a5e', roof: '#5e2434', type: 'house' },
  { name: 'TRI DELTA', body: '#4a7a9a', roof: '#274a5e', type: 'house' },
  { name: 'PI PHI', body: '#5a8a5e', roof: '#2f5a34', type: 'house' },
  { name: "HARRY'S CHOC SHOP", body: '#6a4426', roof: '#3a2410', type: 'shop' },
  { name: 'DISCOVERY PARK', body: '#6f9ec4', roof: '#2f4a5e', type: 'tower' },
];

const LANE_X = [-1, 0, 1];
const LANE_W = 1.7;
const FOG = 60;
const HORIZON = 0.46;

const state = {
  W: 0, H: 0,
  player: null,
  obstacles: [],
  coins: [],
  buildings: [],
  popups: [],
  distance: 0,
  score: 0,
  speed: 18,
  spawnZ: 0,
  bldZ: 0,
  lmIndex: 0,
  bob: 0,
  last: 0,
  running: false,
  gameOver: false,
  started: false,
  showTop: false,
  shake: 0,
  flash: 0,
};

const GRAVITY = 130;
const JUMP_V = 38;

function f() { return state.W * 0.9; }

function project(x, h, z, camX) {
  const fl = f();
  const sx = state.W / 2 + ((x - camX) / z) * fl;
  const groundY = state.H * HORIZON + (1 / z) * fl * 0.9;
  const sy = groundY - (h / z) * fl;
  return { sx, sy, scale: fl / z, groundY };
}

function reset() {
  state.obstacles = [];
  state.coins = [];
  state.buildings = [];
  state.popups = [];
  state.distance = 0;
  state.score = 0;
  state.speed = 18;
  state.spawnZ = 14;
  state.bldZ = 20;
  state.lmIndex = 0;
  state.bob = 0;
  state.last = 0;
  state.running = false;
  state.gameOver = false;
  state.started = false;
  state.shake = 0;
  state.flash = 0;
  state.player = { lane: 1, x: 0, h: 0, vy: 0, onGround: true };
  distanceEl.textContent = '0';
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const first = !state.W;
  state.W = r.width;
  state.H = r.height;
  if (first) reset();
}

function jump() {
  if (state.player.onGround) { state.player.vy = JUMP_V; state.player.onGround = false; }
}
function lane(d) {
  state.player.lane = Math.max(0, Math.min(2, state.player.lane + d));
}

function spawn() {
  const l = Math.floor(Math.random() * 3);
  if (Math.random() < 0.6) {
    state.obstacles.push({ lane: l, z: FOG, type: Math.random() < 0.5 ? 'low' : 'tall', hit: false });
  } else {
    for (let i = 0; i < 3; i++) state.coins.push({ lane: l, z: FOG + i * 1.4, h: 0, taken: false });
  }
}

function end() {
  if (state.gameOver) return;
  state.gameOver = true; state.running = false;
  saveTopScore(Math.round(state.distance) + state.score);
}

function update(dt) {
  if (!state.running) return;
  state.speed = Math.min(46, state.speed + dt * 1.05);
  state.distance += state.speed * dt;
  state.bob += state.speed * dt;

  const p = state.player;
  const tx = LANE_X[p.lane] * LANE_W;
  p.x += (tx - p.x) * Math.min(1, dt * 12);
  if (!p.onGround) { p.vy -= GRAVITY * dt; p.h += p.vy * dt; if (p.h <= 0) { p.h = 0; p.vy = 0; p.onGround = true; } }

  state.spawnZ -= state.speed * dt;
  if (state.spawnZ <= 0) { state.spawnZ = 8 + Math.random() * 6; spawn(); }
  state.bldZ -= state.speed * dt;
  if (state.bldZ <= 0) {
    state.bldZ = 9;
    state.lmIndex = (state.lmIndex + 1) % LANDMARKS.length;
    const side = Math.random() < 0.5 ? -1 : 1;
    state.buildings.push({ z: FOG, side, lm: state.lmIndex, label: true });
    state.buildings.push({ z: FOG, side: -side, lm: (state.lmIndex + 3) % LANDMARKS.length, label: false });
  }

  for (const o of state.obstacles) o.z -= state.speed * dt;
  for (const c of state.coins) c.z -= state.speed * dt;
  for (const b of state.buildings) b.z -= state.speed * dt;
  state.obstacles = state.obstacles.filter((o) => o.z > -2);
  state.coins = state.coins.filter((c) => c.z > -2);
  state.buildings = state.buildings.filter((b) => b.z > -4);

  for (const o of state.obstacles) {
    if (o.hit || o.z > 2.2 || o.z < 0.4) continue;
    if (o.lane !== p.lane) continue;
    const cleared = o.type === 'low' && p.h > 2;
    if (!cleared) { o.hit = true; state.flash = 0.5; end(); }
  }
  for (const c of state.coins) {
    if (c.taken || c.z > 2 || c.z < 0.4) continue;
    if (c.lane !== p.lane) continue;
    if (Math.abs((c.h || 0) - p.h) < 2.5) { c.taken = true; state.score += 10; state.popups.push({ x: state.W / 2, y: state.H * 0.72, t: 1 }); }
  }
  state.coins = state.coins.filter((c) => !c.taken);

  if (state.shake > 0) state.shake -= 1;
  if (state.flash > 0) state.flash -= dt;
  for (const u of state.popups) { u.t -= dt; u.y -= dt * 60; }
  state.popups = state.popups.filter((u) => u.t > 0);
  distanceEl.textContent = String(Math.round(state.distance) + state.score);
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, state.H * HORIZON + 40);
  g.addColorStop(0, '#2a6fd6');
  g.addColorStop(0.6, '#7db9ff');
  g.addColorStop(1, '#e9d7a6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, state.W, state.H * HORIZON + 40);
  ctx.fillStyle = 'rgba(255,240,200,0.9)';
  ctx.beginPath(); ctx.arc(state.W * 0.5, state.H * HORIZON - 20, state.W * 0.08, 0, 7); ctx.fill();
}

function drawGround(camX) {
  const hY = state.H * HORIZON;
  const g = ctx.createLinearGradient(0, hY, 0, state.H);
  g.addColorStop(0, '#3a5a3a'); g.addColorStop(1, '#1c2a1c');
  ctx.fillStyle = g; ctx.fillRect(0, hY, state.W, state.H - hY);
  const near = project(0, 0, 0.6, camX), far = project(0, 0, FOG, camX);
  const roadNearW = (LANE_W * 2.4 / 0.6) * f();
  const roadFarW = (LANE_W * 2.4 / FOG) * f();
  ctx.fillStyle = '#33373d';
  ctx.beginPath();
  ctx.moveTo(state.W / 2 - roadNearW, near.groundY);
  ctx.lineTo(state.W / 2 + roadNearW, near.groundY);
  ctx.lineTo(state.W / 2 + roadFarW, far.groundY);
  ctx.lineTo(state.W / 2 - roadFarW, far.groundY);
  ctx.closePath(); ctx.fill();
  for (let i = -1; i <= 1; i += 2) {
    for (let z = 1; z < FOG; z += 3) {
      const off = z - (state.bob % 3);
      if (off < 0.5) continue;
      const a = project(i * LANE_W, 0, off, camX);
      const b = project(i * LANE_W, 0, off + 1.5, camX);
      ctx.strokeStyle = 'rgba(207,185,145,0.7)';
      ctx.lineWidth = Math.max(1, a.scale * 0.05);
      ctx.beginPath(); ctx.moveTo(a.sx, a.groundY); ctx.lineTo(b.sx, b.groundY); ctx.stroke();
    }
  }
}

function drawBuilding(b, camX) {
  if (b.z < 0.4) return;
  const lm = LANDMARKS[b.lm];
  const base = project(b.side * 6, 0, b.z, camX);
  const s = base.scale;
  const w = Math.max(3, s * 7);
  const x = base.sx - w / 2;
  const g = base.groundY;
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.fillStyle = lm.body;
  if (lm.type === 'dome') {
    const h = s * 9;
    ctx.fillRect(x, g - h, w, h);
    ctx.fillStyle = lm.roof; ctx.beginPath(); ctx.arc(x + w / 2, g - h, w * 0.6, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + w / 2, g - h, w * 0.55, Math.PI, 0); ctx.stroke();
    win(x, g - h, w, h, s);
  } else if (lm.type === 'stadium') {
    const h = s * 6;
    ctx.fillRect(x, g - h, w, h);
    ctx.fillStyle = lm.roof; // bleacher slope
    ctx.beginPath(); ctx.moveTo(x, g - h); ctx.lineTo(x + w, g - h); ctx.lineTo(x + w, g - h * 1.5); ctx.lineTo(x, g - h); ctx.fill();
    ctx.fillStyle = '#dcd0a8'; for (let i = 0; i < 5; i++) ctx.fillRect(x + w * 0.1, g - h + i * h * 0.18, w * 0.8, h * 0.06);
  } else if (lm.type === 'tower') {
    const h = s * 16;
    ctx.fillStyle = lm.body; ctx.fillRect(x + w * 0.2, g - h, w * 0.6, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let r = 0; r < 8; r++) ctx.fillRect(x + w * 0.25, g - h + r * h * 0.12, w * 0.5, h * 0.07);
  } else if (lm.type === 'shop') {
    const h = s * 6;
    ctx.fillRect(x, g - h, w, h);
    ctx.fillStyle = lm.roof; ctx.fillRect(x, g - h - s * 1.2, w, s * 1.4);
    win(x, g - h, w, h, s);
  } else { // house: gable roof + columns
    const h = s * 7;
    ctx.fillRect(x, g - h, w, h);
    ctx.fillStyle = lm.roof; ctx.beginPath(); ctx.moveTo(x - w * 0.08, g - h); ctx.lineTo(x + w / 2, g - h * 1.5); ctx.lineTo(x + w * 1.08, g - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#efe7cf'; for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.12 + i * 0.25), g - h * 0.7, w * 0.06, h * 0.7);
    win(x, g - h, w, h * 0.5, s);
  }
  ctx.restore();
}

function win(x, y, w, h, s) {
  ctx.fillStyle = 'rgba(255,240,200,0.65)';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) ctx.fillRect(x + w * (0.15 + c * 0.2), y + h * 0.2 + r * h * 0.2, w * 0.1, h * 0.1);
}

function drawObstacle(o, camX) {
  if (o.z < 0.4) return;
  const p = project(LANE_X[o.lane] * LANE_W, 0, o.z, camX);
  const w = p.scale * 1.1; const h = p.scale * (o.type === 'tall' ? 3 : 0.8);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(p.sx, p.groundY, w * 0.6, w * 0.18, 0, 0, 7); ctx.fill();
  ctx.fillStyle = o.type === 'tall' ? '#7a1f1f' : '#222';
  ctx.fillRect(p.sx - w / 2, p.groundY - h, w, h);
  ctx.fillStyle = '#CFB991'; ctx.fillRect(p.sx - w / 2, p.groundY - h, w, h * 0.12);
}

function drawCoin(c, camX) {
  if (c.z < 0.4) return;
  const p = project(LANE_X[c.lane] * LANE_W, 0.7, c.z, camX);
  const r = p.scale * 0.22;
  ctx.fillStyle = '#caa84a'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#f3dd86'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.62, 0, 7); ctx.fill();
}

function drawHero() {
  const cx = state.W / 2; const bob = Math.sin(state.bob * 2) * 6;
  const jmp = state.player.h * 22;
  const y = state.H * 0.92 + bob - jmp;
  const run = state.bob * 2;
  const SKIN = '#d49a6a', GOLD = '#CEB888', BLK = '#1a1a1a';

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx, state.H * 0.93, 56, 13, 0, 0, 7); ctx.fill();

  // legs (running) with sneakers
  const ls = Math.sin(run) * 26;
  for (const [side, ph] of [[-1, 0], [1, Math.PI]]) {
    const sw = Math.sin(run + ph) * 22;
    ctx.strokeStyle = SKIN; ctx.lineWidth = 17; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + side * 12, y - 6); ctx.lineTo(cx + side * 12 + sw, y + 36); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cx + side * 12 + sw + 4, y + 38, 14, 7, 0, 0, 7); ctx.fill();
  }
  // basketball shorts
  ctx.fillStyle = BLK; ctx.beginPath(); ctx.moveTo(cx - 26, y - 14); ctx.lineTo(cx + 26, y - 14); ctx.lineTo(cx + 24, y + 6); ctx.lineTo(cx + 3, y + 6); ctx.lineTo(cx, y - 4); ctx.lineTo(cx - 3, y + 6); ctx.lineTo(cx - 24, y + 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = GOLD; ctx.fillRect(cx - 26, y - 16, 52, 4);

  // tank top torso (tapered)
  ctx.fillStyle = GOLD; ctx.beginPath();
  ctx.moveTo(cx - 30, y - 86); ctx.lineTo(cx + 30, y - 86);
  ctx.lineTo(cx + 24, y - 12); ctx.lineTo(cx - 24, y - 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = BLK; ctx.fillRect(cx - 30, y - 86, 5, 74); ctx.fillRect(cx + 25, y - 86, 5, 74); // armhole trim
  // straps + neckline (skin between)
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.moveTo(cx - 12, y - 86); ctx.lineTo(cx + 12, y - 86); ctx.lineTo(cx, y - 66); ctx.closePath(); ctx.fill();
  // SMITH 3
  ctx.fillStyle = BLK; ctx.textAlign = 'center';
  ctx.font = 'bold 30px Inter'; ctx.fillText('3', cx, y - 28);

  // arms swinging
  ctx.strokeStyle = SKIN; ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 28, y - 80); ctx.lineTo(cx - 48 - ls, y - 36); ctx.moveTo(cx + 28, y - 80); ctx.lineTo(cx + 48 + ls, y - 36); ctx.stroke();

  // neck + head + hair
  ctx.fillStyle = SKIN; ctx.fillRect(cx - 7, y - 96, 14, 12);
  ctx.beginPath(); ctx.arc(cx, y - 108, 20, 0, 7); ctx.fill();
  ctx.fillStyle = '#2a1c10'; ctx.beginPath(); ctx.arc(cx, y - 116, 20, Math.PI, 0); ctx.fill();
}

function render() {
  const camX = state.player.x; const sx = 0;
  ctx.save(); ctx.translate(sx, 0);
  drawSky(); drawGround(camX);
  state.buildings.slice().sort((a, b) => b.z - a.z).forEach((b) => drawBuilding(b, camX));
  const ents = [...state.obstacles.map((o) => ({ z: o.z, d: () => drawObstacle(o, camX) })), ...state.coins.map((c) => ({ z: c.z, d: () => drawCoin(c, camX) }))];
  ents.sort((a, b) => b.z - a.z).forEach((e) => e.d());
  drawHero();
  if (state.flash > 0) { ctx.fillStyle = `rgba(255,60,60,${state.flash})`; ctx.fillRect(0, 0, state.W, state.H); }
  ctx.textAlign = 'center';
  for (const u of state.popups) { ctx.fillStyle = `rgba(207,185,145,${u.t})`; ctx.font = 'bold 26px Inter'; ctx.fillText('+10', u.x, u.y); }
  if (!state.started) overlay('PURDUE RUN', 'Tap to jump · ←→ / swipe to dodge · grab coins (+10)');
  else if (state.gameOver) { overlay('CRASH!', 'Score ' + (Math.round(state.distance) + state.score) + ' · Restart'); if (state.showTop) drawTop(loadTopScores()); }
  else if (state.showTop) drawTop(loadTopScores());
  ctx.restore();
}

function overlay(t, s) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, state.W, state.H);
  ctx.fillStyle = '#CFB991'; ctx.textAlign = 'center'; ctx.font = `bold ${Math.max(30, state.W * 0.08)}px Inter`;
  ctx.fillText(t, state.W / 2, state.H / 2 - 8);
  ctx.fillStyle = '#fff'; ctx.font = `${Math.max(13, state.W * 0.025)}px Inter`; ctx.fillText(s, state.W / 2, state.H / 2 + 26);
}
function drawTop(top) {
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `${Math.max(13, state.W * 0.025)}px Inter`;
  for (let i = 0; i < 3; i++) ctx.fillText(`${i + 1}. ${top[i] ?? '—'}`, state.W / 2, state.H / 2 + 70 + i * 26);
}

function loop(t) {
  const dt = state.last ? Math.min(0.05, (t - state.last) / 1000) : 0; state.last = t;
  update(dt); render(); requestAnimationFrame(loop);
}
function start() { if (state.gameOver) reset(); state.started = true; state.running = true; state.showTop = false; }

canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; if (!state.started) start(); else if (!state.gameOver) jump(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!state.started) start(); else if (!state.gameOver) jump(); }
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') lane(-1);
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') lane(1);
});
let ts = null;
canvas.addEventListener('touchstart', (e) => { ts = e.changedTouches[0]; }, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!ts) return; const t = e.changedTouches[0]; const dx = t.clientX - ts.clientX; const dy = t.clientY - ts.clientY;
  if (Math.abs(dx) > 30 || Math.abs(dy) > 30) { if (Math.abs(dx) > Math.abs(dy)) lane(dx > 0 ? 1 : -1); else if (dy < 0) jump(); }
  else if (!state.started) start(); else if (!state.gameOver) jump();
  ts = null;
}, { passive: true });
restartButton.addEventListener('click', () => { reset(); start(); });
topScoresButton.addEventListener('click', () => { state.showTop = !state.showTop; if (state.started && !state.gameOver) state.running = !state.showTop; });
window.addEventListener('resize', resize);
resize(); requestAnimationFrame(loop);
