const canvas = document.getElementById('gameCanvas');
const scoreEl = document.getElementById('score');
const restartButton = document.getElementById('restartButton');
const ctx = canvas.getContext('2d');

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
};

function resetGame() {
  state.score = 0;
  state.pipes = [];
  state.pipeTimer = 0;
  state.lastTime = 0;
  state.running = false;
  state.gameOver = false;
  state.started = false;
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

function update(dt) {
  if (!state.running) return;

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
  if (state.bird.y + state.bird.radius >= ground || state.bird.y - state.bird.radius <= 0) {
    endGame();
    return;
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
}

function drawBackground() {
  ctx.fillStyle = state.backgroundGradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = '#ffd166';
  const drift = ((state.lastTime / 1000) % 1) * 45;
  for (const star of state.stars) {
    ctx.beginPath();
    ctx.arc(star.x + drift, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
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
}

function drawPipes() {
  ctx.fillStyle = '#42b84b';
  for (const pipe of state.pipes) {
    const topHeight = pipe.topHeight;
    const bottomY = topHeight + pipe.gap;
    const pipeWidth = state.pipeWidth;

    ctx.fillRect(pipe.x, 0, pipeWidth, topHeight);
    ctx.fillRect(pipe.x, bottomY, pipeWidth, state.height - bottomY);

    ctx.fillStyle = '#5edd63';
    ctx.fillRect(pipe.x - 4, 0, 8, topHeight);
    ctx.fillRect(pipe.x - 4, bottomY, 8, state.height - bottomY);
    ctx.fillStyle = '#42b84b';
  }
}

function drawBird() {
  const bird = state.bird;
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(Math.max(-0.45, Math.min(0.55, bird.velocity / 700)));

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

function draw() {
  drawBackground();
  drawPipes();
  drawBird();
  drawGround();
  drawOverlay();
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

restartButton.addEventListener('click', () => {
  resetGame();
  startGame();
});

resizeCanvas();
resetGame();
requestAnimationFrame(loop);
