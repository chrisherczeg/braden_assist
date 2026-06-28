const canvas = document.getElementById('gameCanvas');
const scoreEl = document.getElementById('score');
const restartButton = document.getElementById('restartButton');
const topScoresButton = document.getElementById('topScoresButton');
const ctx = canvas.getContext('2d');

const TOP_SCORES_KEY = 'flappyTopScores';

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
    /* ignore storage errors */
  }
  return top;
}

const state = {
  width: 0,
  height: 0,
  scale: 1,
  bird: null,
  pipes: [],
  score: 0,
  lastTime: 0,
  speed: 220,
  pipeTimer: 0,
  pipeInterval: 1.35,
  gravity: 1200,
  flapVelocity: -360,
  running: false,
  gameOver: false,
  started: false,
  backgroundGradient: null,
  stars: [],
  pipeWidth: 70,
  groundY: 0,
  showTopScores: false,
  spaceMode: false,
  spaceT: 0,
  spaceStars: [],
};

function resetGame() {
  state.score = 0;
  state.pipes = [];
  state.pipeTimer = 0;
  state.lastTime = 0;
  state.running = false;
  state.gameOver = false;
  state.started = false;
  state.spaceMode = false;
  state.spaceT = 0;
  state.bird = {
    x: state.width * 0.25,
    y: state.height * 0.45,
    radius: 18,
    velocity: 0,
  };
  scoreEl.textContent = '0';
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.width = rect.width;
  state.height = rect.height;
  state.scale = dpr;
  state.groundY = state.height * 0.88;
  state.pipeWidth = Math.max(56, Math.min(70, state.width * 0.12));

  state.backgroundGradient = ctx.createLinearGradient(0, 0, 0, state.height);
  state.backgroundGradient.addColorStop(0, '#8fe7ff');
  state.backgroundGradient.addColorStop(1, '#d8f6ff');

  state.stars = Array.from({ length: 7 }, (_, index) => ({
    x: (index * state.width) / 7 + 24,
    y: 70 + (index % 3) * 18,
    size: 6,
  }));

  state.spaceStars = Array.from({ length: 60 }, () => ({
    x: Math.random() * state.width,
    y: Math.random() * state.height,
    size: Math.random() * 1.6 + 0.4,
    phase: Math.random() * Math.PI * 2,
  }));

  // Pre-build space-mode gradients once per resize so the render loop
  // doesn't allocate new gradients every frame.
  state.spaceGradient = ctx.createLinearGradient(0, 0, 0, state.height);
  state.spaceGradient.addColorStop(0, '#050217');
  state.spaceGradient.addColorStop(1, '#1a0b3d');

  state.moonRockGradient = ctx.createLinearGradient(0, 0, state.pipeWidth, 0);
  state.moonRockGradient.addColorStop(0, '#5d5d68');
  state.moonRockGradient.addColorStop(0.5, '#9b9ba6');
  state.moonRockGradient.addColorStop(1, '#4a4a55');

  const planetX = state.width * 0.78;
  const planetY = state.height * 0.2;
  const planetR = Math.max(26, state.width * 0.09);
  const planetGradient = ctx.createRadialGradient(
    planetX - planetR * 0.3,
    planetY - planetR * 0.3,
    planetR * 0.2,
    planetX,
    planetY,
    planetR
  );
  planetGradient.addColorStop(0, '#6fd0ff');
  planetGradient.addColorStop(1, '#13407a');
  state.planet = { x: planetX, y: planetY, r: planetR, gradient: planetGradient };

  if (!state.bird) {
    resetGame();
  } else {
    state.bird.x = state.width * 0.25;
    state.bird.y = state.height * 0.45;
    state.bird.radius = Math.min(18, state.width * 0.045);
  }
}

function startGame() {
  if (state.gameOver) {
    resetGame();
  }

  state.started = true;
  state.running = true;
  state.lastTime = performance.now();
}

function flap() {
  if (!state.started) {
    startGame();
  }

  if (!state.running) {
    if (state.gameOver) {
      resetGame();
      state.started = true;
      state.running = true;
      state.lastTime = performance.now();
    }
    return;
  }

  state.bird.velocity = state.flapVelocity;
}

function spawnPipe() {
  const minHeight = 90;
  const maxHeight = state.height - 190;
  const gap = Math.max(120, state.height * 0.22);
  const topHeight = minHeight + Math.random() * (maxHeight - minHeight - gap);

  state.pipes.push({
    x: state.width + 40,
    topHeight,
    gap,
    passed: false,
  });
}

function activateSpaceMode() {
  state.spaceMode = true;
  state.bird.y = state.bird.radius + 1;
  state.bird.velocity = 120;
}

function update(dt) {
  if (!state.running) return;

  if (state.spaceMode && state.spaceT < 1) {
    state.spaceT = Math.min(1, state.spaceT + dt / 0.6);
  }

  state.bird.velocity += state.gravity * dt;
  state.bird.y += state.bird.velocity * dt;

  state.pipeTimer += dt;
  if (state.pipeTimer >= state.pipeInterval) {
    spawnPipe();
    state.pipeTimer = 0;
  }

  for (let i = state.pipes.length - 1; i >= 0; i -= 1) {
    const pipe = state.pipes[i];
    pipe.x -= state.speed * dt;

    if (!pipe.passed && pipe.x + 70 < state.bird.x) {
      pipe.passed = true;
      state.score += 1;
      scoreEl.textContent = String(state.score);
    }

    if (pipe.x + 70 < -20) {
      state.pipes.splice(i, 1);
    }
  }

  const ground = state.height * 0.88;
  const hitTop = state.bird.y - state.bird.radius <= 0;
  const hitGround = state.bird.y + state.bird.radius >= ground;

  if (hitGround) {
    endGame();
    return;
  }

  if (hitTop) {
    // Easter egg: fly all the way up before clearing the first pipe to
    // launch into outer space (bird -> basketball, pipes -> moon rock).
    if (!state.spaceMode && state.score === 0 && state.pipes.every((p) => !p.passed)) {
      activateSpaceMode();
    }

    if (state.spaceMode || state.score === 0) {
      // Before the first pipe (and in space) the ceiling is harmless;
      // bounce the bird back down instead of ending the game.
      state.bird.y = state.bird.radius;
      if (state.bird.velocity < 0) {
        state.bird.velocity = 0;
      }
    } else {
      endGame();
      return;
    }
  }

  for (const pipe of state.pipes) {
    const pipeWidth = state.pipeWidth;
    const pipeTopBottom = pipe.topHeight;
    const pipeBottomTop = pipe.topHeight + pipe.gap;

    const birdLeft = state.bird.x - state.bird.radius;
    const birdRight = state.bird.x + state.bird.radius;
    const birdTop = state.bird.y - state.bird.radius;
    const birdBottom = state.bird.y + state.bird.radius;

    const hitTop = birdRight > pipe.x && birdLeft < pipe.x + pipeWidth && birdBottom > 0 && birdTop < pipeTopBottom;
    const hitBottom = birdRight > pipe.x && birdLeft < pipe.x + pipeWidth && birdTop < pipeBottomTop && birdBottom > pipeBottomTop;

    if (hitTop || hitBottom) {
      endGame();
      return;
    }
  }
}

function endGame() {
  state.running = false;
  state.gameOver = true;
  saveTopScore(state.score);
}

function drawBackground() {
  if (state.spaceMode && state.spaceT >= 1) {
    drawSpaceBackground();
    return;
  }

  ctx.fillStyle = state.backgroundGradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = '#ffd166';
  const drift = ((state.lastTime / 1000) % 1) * 45;
  for (const star of state.stars) {
    ctx.beginPath();
    ctx.arc(star.x + drift, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state.spaceMode) {
    drawSpaceBackground();
  }
}

function drawSpaceBackground() {
  const t = state.spaceT;
  ctx.save();

  ctx.globalAlpha = t;
  ctx.fillStyle = state.spaceGradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = '#ffffff';
  for (const s of state.spaceStars) {
    const twinkle = 0.6 + 0.4 * Math.sin(state.lastTime / 400 + s.phase);
    ctx.globalAlpha = t * twinkle;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Distant Earth.
  ctx.globalAlpha = t;
  ctx.fillStyle = state.planet.gradient;
  ctx.beginPath();
  ctx.arc(state.planet.x, state.planet.y, state.planet.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGround() {
  ctx.fillStyle = '#5a9f3f';
  ctx.fillRect(0, state.groundY, state.width, state.height - state.groundY);
  ctx.fillStyle = '#7ad14d';
  ctx.fillRect(0, state.groundY - 12, state.width, 12);

  ctx.strokeStyle = '#4b7d31';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= state.width; i += 25) {
    ctx.moveTo(i, state.groundY + 6);
    ctx.lineTo(i + 12, state.groundY + 18);
  }
  ctx.stroke();

  if (state.spaceMode) {
    drawMoonGround();
  }
}

function drawMoonGround() {
  ctx.save();
  ctx.globalAlpha = state.spaceT;
  ctx.fillStyle = '#9a9aa5';
  ctx.fillRect(0, state.groundY, state.width, state.height - state.groundY);
  ctx.fillStyle = '#b8b8c4';
  ctx.fillRect(0, state.groundY - 12, state.width, 12);

  ctx.fillStyle = '#7d7d88';
  for (let i = 20; i < state.width; i += 70) {
    ctx.beginPath();
    ctx.ellipse(i, state.groundY + 22, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPipes() {
  for (const pipe of state.pipes) {
    const topHeight = pipe.topHeight;
    const bottomY = topHeight + pipe.gap;
    const pipeWidth = state.pipeWidth;

    if (state.spaceMode) {
      drawMoonRock(pipe.x, 0, pipeWidth, topHeight);
      drawMoonRock(pipe.x, bottomY, pipeWidth, state.height - bottomY);
      continue;
    }

    ctx.fillStyle = '#42b84b';
    ctx.fillRect(pipe.x, 0, pipeWidth, topHeight);
    ctx.fillRect(pipe.x, bottomY, pipeWidth, state.height - bottomY);

    ctx.fillStyle = '#5edd63';
    ctx.fillRect(pipe.x - 4, 0, 8, topHeight);
    ctx.fillRect(pipe.x - 4, bottomY, 8, state.height - bottomY);
  }
}

function drawMoonRock(x, y, w, h) {
  ctx.save();
  ctx.translate(x, 0);

  ctx.fillStyle = state.moonRockGradient;
  ctx.fillRect(0, y, w, h);

  // Lighter rim edge.
  ctx.fillStyle = '#bcbcc8';
  ctx.fillRect(-4, y, 6, h);

  // Crater pockmarks.
  ctx.fillStyle = 'rgba(55, 55, 65, 0.55)';
  for (let cy = y + 16; cy < y + h - 8; cy += 36) {
    ctx.beginPath();
    ctx.arc(w * 0.35, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w * 0.7, cy + 18, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBird() {
  const bird = state.bird;
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(Math.max(-0.45, Math.min(0.55, bird.velocity / 700)));

  if (state.spaceMode) {
    drawBasketball(bird.radius);
    ctx.restore();
    return;
  }

  ctx.fillStyle = '#f7c948';
  ctx.beginPath();
  ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff7f50';
  ctx.beginPath();
  ctx.moveTo(bird.radius * 0.8, -4);
  ctx.lineTo(bird.radius * 1.4, 2);
  ctx.lineTo(bird.radius * 0.8, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(7, -5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(8, -5, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBasketball(r) {
  const ball = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  ball.addColorStop(0, '#ffae5e');
  ball.addColorStop(1, '#e87b1e');
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Keep all seams inside the ball.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = '#1a0d00';
  ctx.lineWidth = Math.max(1.6, r * 0.13);
  ctx.lineCap = 'round';

  // Vertical center seam.
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.stroke();

  // Horizontal center seam.
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();

  // Left curved seam bowing outward.
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(-r * 1.15, 0, 0, r);
  ctx.stroke();

  // Right curved seam bowing outward.
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 1.15, 0, 0, r);
  ctx.stroke();

  ctx.restore();

  // Crisp outline on top.
  ctx.strokeStyle = '#1a0d00';
  ctx.lineWidth = Math.max(1.2, r * 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawOverlay() {
  const titleSize = Math.max(18, Math.min(30, state.width * 0.07));
  const bodySize = Math.max(12, Math.min(16, state.width * 0.04));
  const cx = state.width / 2;
  const cy = state.height / 2;

  if (!state.started) {
    ctx.fillStyle = 'rgba(5, 25, 52, 0.45)';
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = `700 ${titleSize}px Inter, sans-serif`;
    ctx.fillText('Tap or press Space to start', cx, cy - 10);
    ctx.font = `500 ${bodySize}px Inter, sans-serif`;
    ctx.fillText('Avoid the pipes and keep flying', cx, cy + 22);
  } else if (state.gameOver) {
    ctx.fillStyle = 'rgba(5, 25, 52, 0.45)';
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = `700 ${titleSize}px Inter, sans-serif`;
    ctx.fillText('Game Over', cx, cy - 10);
    ctx.font = `500 ${bodySize}px Inter, sans-serif`;
    ctx.fillText(`Score: ${state.score}`, cx, cy + 20);
    ctx.fillText('Tap or press Space to play again', cx, cy + 46);
  }
}

function drawTopScores() {
  const titleSize = Math.max(18, Math.min(30, state.width * 0.07));
  const bodySize = Math.max(14, Math.min(20, state.width * 0.05));
  const cx = state.width / 2;
  const cy = state.height / 2;
  const scores = loadTopScores();

  ctx.fillStyle = 'rgba(5, 25, 52, 0.7)';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.font = `700 ${titleSize}px Inter, sans-serif`;
  ctx.fillText('Your Top 3', cx, cy - titleSize);

  ctx.font = `600 ${bodySize}px Inter, sans-serif`;
  if (scores.length === 0) {
    ctx.fillText('No scores yet', cx, cy + bodySize);
  } else {
    for (let i = 0; i < scores.length; i += 1) {
      ctx.fillText(`${i + 1}.  ${scores[i]}`, cx, cy - bodySize * 0.2 + i * (bodySize * 1.6));
    }
  }
}

function draw() {
  drawBackground();
  drawPipes();
  drawBird();
  drawGround();
  if (state.showTopScores) {
    drawTopScores();
  } else {
    drawOverlay();
  }
}

function loop(timestamp) {
  if (!state.lastTime) {
    state.lastTime = timestamp;
  }
  const dt = Math.min((timestamp - state.lastTime) / 1000, 0.03);
  state.lastTime = timestamp;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    event.preventDefault();
    flap();
  }
});

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  flap();
});

// iOS Safari ignores `user-scalable=no`, so prevent double-tap zoom in JS.
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  },
  { passive: false }
);

// Block pinch / gesture zoom on iOS Safari.
document.addEventListener('gesturestart', (event) => event.preventDefault());
document.addEventListener('gesturechange', (event) => event.preventDefault());
document.addEventListener('gestureend', (event) => event.preventDefault());

// Prevent double-tap zoom from a quick second tap that still scrolls/zooms.
canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

topScoresButton.addEventListener('click', () => {
  state.showTopScores = !state.showTopScores;
  topScoresButton.textContent = state.showTopScores ? 'Hide' : 'Top 3';
});

restartButton.addEventListener('click', () => {
  state.showTopScores = false;
  topScoresButton.textContent = 'Top 3';
  resetGame();
  startGame();
});

resizeCanvas();
resetGame();
requestAnimationFrame(loop);
