/* Tamagotchi — static, cache-backed virtual pet.
 * Faithful to 2008-era (Connection / Version) mechanics:
 * egg hatch, hunger & happy hearts, discipline, weight, poop, sickness,
 * sleep by clock, attention calls, care mistakes, evolution, old age & death.
 * All state persists in the browser cache (localStorage) and the pet ages in
 * real time even while the tab is closed.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "tamagotchi_v1";
  const CACHE_NAME = "tamagotchi-state";

  // ---- Time constants (real time, authentic ratios) --------------------
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const CFG = {
    hatchCareMs: 30 * 1000,     // egg hatches after a short while
    hungerDecayMs: 30 * MIN,    // -1 hunger heart every 30 min
    happyDecayMs: 30 * MIN,     // -1 happy heart every 30 min
    disciplineDecayPerHour: 4,  // discipline slowly slips
    poopMinMs: 60 * MIN,        // poop 1-3 h after eating
    poopMaxMs: 180 * MIN,
    sickFromPoopMs: 60 * MIN,   // poop left ~1h risks sickness
    neglectDeathMs: 12 * HOUR,  // need at zero this long -> risk death
    sickDeathMs: 24 * HOUR,     // untreated sickness this long -> death
    // evolution timeline (time since birth)
    babyMs: 1 * HOUR,
    childMs: 1 * DAY,
    teenMs: 3 * DAY,
    adultMs: 6 * DAY,
    ageYearMs: 1 * DAY,         // +1 "year" of age per real day
    oldAgeMs: 12 * DAY,         // baseline lifespan; care extends it
    // sleep window (local clock hours)
    sleepStart: 20,
    sleepEnd: 8,
    callMinMs: 8 * MIN,         // attention calls
    callMaxMs: 20 * MIN,
  };

  const STAGES = ["egg", "baby", "child", "teen", "adult", "senior"];

  // ---- State -----------------------------------------------------------
  function freshState(now) {
    return {
      v: 1,
      bornAt: now,
      lastUpdate: now,
      stage: "egg",
      hatched: false,
      careMs: 0,            // attention accumulated while egg
      hunger: 4,            // 0..4 hearts (full float)
      happy: 4,             // 0..4 hearts
      discipline: 0,        // 0..100
      weight: 5,
      poop: 0,
      poopDueAt: now + rand(CFG.poopMinMs, CFG.poopMaxMs),
      sick: false,
      sickSince: 0,
      lightOn: true,
      hungerZeroSince: 0,
      happyZeroSince: 0,
      poopSince: 0,
      careMistakes: 0,
      sleepPenalized: false,  // light-on-at-bedtime counted once per night
      goodCare: 0,
      call: null,           // 'need' | 'discipline' | null
      nextCallAt: now + rand(CFG.callMinMs, CFG.callMaxMs),
      alive: true,
      deathReason: null,
      ageYears: 0,
    };
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  let state = load() || freshState(Date.now());

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      const raw = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, raw);
      // Mirror into the Cache API as a second cache-backed copy.
      if (window.caches) {
        caches.open(CACHE_NAME).then((c) =>
          c.put("/tamagotchi/state.json", new Response(raw, {
            headers: { "Content-Type": "application/json" },
          }))
        ).catch(() => {});
      }
    } catch (e) {
      /* storage full or unavailable */
    }
  }

  // ---- Simulation ------------------------------------------------------
  function isSleepHour(date) {
    const h = date.getHours();
    if (CFG.sleepStart > CFG.sleepEnd) {
      return h >= CFG.sleepStart || h < CFG.sleepEnd;
    }
    return h >= CFG.sleepStart && h < CFG.sleepEnd;
  }

  function isSleeping() {
    return state.hatched && state.alive && isSleepHour(new Date());
  }

  function simulate(now) {
    if (!state.alive) {
      state.lastUpdate = now;
      return;
    }
    let elapsed = now - state.lastUpdate;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > 30 * DAY) elapsed = 30 * DAY; // clamp absurd gaps

    // Egg hatching
    if (!state.hatched) {
      state.careMs += elapsed;
      if (state.careMs >= CFG.hatchCareMs) {
        state.hatched = true;
        state.stage = "baby";
        state.call = null;
      }
      state.lastUpdate = now;
      return;
    }

    const sleeping = isSleepHour(new Date(now));

    // Stats do not decay while asleep (light should be off).
    if (!sleeping) {
      state.hunger = clamp(state.hunger - elapsed / CFG.hungerDecayMs, 0, 4);
      state.happy = clamp(state.happy - elapsed / CFG.happyDecayMs, 0, 4);
      state.discipline = clamp(
        state.discipline - (CFG.disciplineDecayPerHour * elapsed) / HOUR,
        0,
        100
      );
      state.sleepPenalized = false; // reset for the next night
    } else if (state.lightOn && !state.sleepPenalized) {
      // Light left on at bedtime is a single care mistake per night.
      state.careMistakes += 1;
      state.sleepPenalized = true;
    }

    // Track empty-need neglect windows
    trackZero(now, "hunger", "hungerZeroSince");
    trackZero(now, "happy", "happyZeroSince");

    // Poop
    if (now >= state.poopDueAt) {
      state.poop += 1;
      if (state.poopSince === 0) state.poopSince = now;
      state.poopDueAt = now + rand(CFG.poopMinMs, CFG.poopMaxMs);
    }

    // Sickness triggers
    if (!state.sick) {
      const poopLong = state.poop > 0 && state.poopSince &&
        now - state.poopSince > CFG.sickFromPoopMs;
      const starving = state.hungerZeroSince &&
        now - state.hungerZeroSince > 2 * HOUR;
      if (poopLong || starving || (!sleeping && Math.random() < elapsed / (12 * HOUR))) {
        state.sick = true;
        state.sickSince = now;
      }
    }

    // Attention calls (only when awake)
    if (!sleeping && !state.call && now >= state.nextCallAt) {
      if (Math.floor(state.hunger) === 0 || Math.floor(state.happy) === 0 || state.sick) {
        state.call = "need";
      } else {
        state.call = "discipline"; // "bad behaviour" call
      }
      state.nextCallAt = now + rand(CFG.callMinMs, CFG.callMaxMs);
    }

    // Age in years
    state.ageYears = Math.floor((now - state.bornAt) / CFG.ageYearMs);

    // Evolution
    evolve(now);

    // Death checks
    checkDeath(now);

    state.lastUpdate = now;
  }

  function trackZero(now, statKey, sinceKey) {
    if (Math.floor(state[statKey]) === 0) {
      if (state[sinceKey] === 0) state[sinceKey] = now;
    } else {
      state[sinceKey] = 0;
    }
  }

  function evolve(now) {
    const age = now - state.bornAt;
    let target = "baby";
    if (age >= CFG.adultMs) target = "adult";
    else if (age >= CFG.teenMs) target = "teen";
    else if (age >= CFG.childMs) target = "child";
    else if (age >= CFG.babyMs) target = "baby";
    // Senior once past old-age threshold
    if (age >= CFG.oldAgeMs * 0.75) target = "senior";
    if (STAGES.indexOf(target) > STAGES.indexOf(state.stage)) {
      state.stage = target;
    }
  }

  function checkDeath(now) {
    let reason = null;
    if (state.sick && state.sickSince && now - state.sickSince > CFG.sickDeathMs) {
      reason = "illness";
    } else if (
      state.hungerZeroSince && now - state.hungerZeroSince > CFG.neglectDeathMs &&
      state.happyZeroSince && now - state.happyZeroSince > CFG.neglectDeathMs
    ) {
      reason = "neglect";
    } else {
      // Old age — lifespan extended by good care, shortened by mistakes.
      const lifespan = CFG.oldAgeMs +
        state.goodCare * 20 * MIN -
        state.careMistakes * 30 * MIN;
      if (now - state.bornAt > lifespan) reason = "old age";
    }
    if (reason) {
      state.alive = false;
      state.deathReason = reason;
      state.call = null;
    }
  }

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  // ---- Care actions ----------------------------------------------------
  function feedMeal() {
    if (!careable()) return msg("Zzz...");
    if (Math.floor(state.hunger) >= 4) return msg("Too full!");
    state.hunger = clamp(state.hunger + 1, 0, 4);
    state.weight += 1;
    state.hungerZeroSince = 0;
    if (state.poopSince === 0 && state.poop === 0) {
      state.poopDueAt = Date.now() + rand(CFG.poopMinMs, CFG.poopMaxMs);
    }
    goodCare();
    animate("eat");
    msg("Yum, a meal!");
  }

  function feedSnack() {
    if (!careable()) return msg("Zzz...");
    state.happy = clamp(state.happy + 1, 0, 4);
    state.weight += 2; // snacks add more weight, like the real toy
    state.happyZeroSince = 0;
    animate("eat");
    msg("Sweet snack!");
  }

  function toggleLight() {
    state.lightOn = !state.lightOn;
    save();
    render();
  }

  function giveMedicine() {
    if (!state.sick) return msg("Not sick.");
    state.sick = false;
    state.sickSince = 0;
    goodCare();
    animate("heal");
    msg("All better!");
  }

  function cleanPoop() {
    if (state.poop <= 0) return msg("It's clean.");
    state.poop = 0;
    state.poopSince = 0;
    goodCare();
    msg("Flushed!");
  }

  function scold() {
    if (!careable()) return msg("Zzz...");
    if (state.call === "discipline") {
      state.discipline = clamp(state.discipline + 15, 0, 100);
      state.call = null;
      goodCare();
      animate("angry");
      msg("Behave!");
    } else {
      // Scolding for no reason lowers happiness — like the real toy.
      state.happy = clamp(state.happy - 1, 0, 4);
      msg("Wasn't naughty!");
    }
  }

  function acknowledgeCall() {
    if (!state.call) return msg("Nothing.");
    if (state.call === "discipline") {
      scold();
    } else {
      state.call = null;
      render();
    }
  }

  function careable() {
    return state.hatched && state.alive && !isSleeping();
  }

  function goodCare() {
    state.goodCare += 1;
  }

  function reset() {
    state = freshState(Date.now());
    save();
    ui.mode = "main";
    ui.cursor = 0;
    render();
  }

  // ---- Mini-game (direction guess, classic Tamagotchi) -----------------
  const game = { active: false, round: 0, wins: 0, target: 0, guess: null, revealAt: 0 };

  function startGame() {
    if (!careable()) return msg("Zzz...");
    if (Math.floor(state.happy) >= 4) { /* still allowed, keeps them fit */ }
    game.active = true;
    game.round = 0;
    game.wins = 0;
    game.guess = null;
    nextRound();
    ui.mode = "game";
    render();
  }

  function nextRound() {
    game.round += 1;
    game.target = Math.random() < 0.5 ? 0 : 1; // 0 left, 1 right
    game.guess = null;
    game.revealAt = 0;
  }

  function playGuess(dir) {
    if (game.guess !== null) return;
    game.guess = dir;
    if (dir === game.target) game.wins += 1;
    game.revealAt = Date.now() + 900;
    render();
    setTimeout(() => {
      if (game.round >= 5) {
        endGame();
      } else {
        nextRound();
        render();
      }
    }, 950);
  }

  function endGame() {
    game.active = false;
    ui.mode = "main";
    if (game.wins >= 3) {
      state.happy = clamp(state.happy + 1, 0, 4);
      state.weight = Math.max(1, state.weight - 1);
      state.happyZeroSince = 0;
      goodCare();
      msg("You won! +1 happy");
    } else {
      msg("You lost...");
    }
  }

  // ---- UI / input ------------------------------------------------------
  const ICONS = [
    "food", "light", "play", "medicine",
    "bathroom", "status", "discipline", "attention",
  ];

  const ui = {
    mode: "main",     // main | feed | game | status | message
    cursor: 0,        // selected icon index
    feedCursor: 0,    // 0 meal, 1 snack
    statusPage: 0,
    message: "",
    messageUntil: 0,
    anim: null,
    animUntil: 0,
    blink: 0,
  };

  function msg(text) {
    ui.message = text;
    ui.messageUntil = Date.now() + 1600;
    save();
    render();
  }

  function animate(kind) {
    ui.anim = kind;
    ui.animUntil = Date.now() + 1200;
  }

  function activateIcon(name) {
    if (!state.hatched) {
      // Any button caring for the egg is fine; just show it.
      return render();
    }
    switch (name) {
      case "food":
        ui.mode = "feed";
        ui.feedCursor = 0;
        break;
      case "light":
        toggleLight();
        return;
      case "play":
        startGame();
        return;
      case "medicine":
        giveMedicine();
        break;
      case "bathroom":
        cleanPoop();
        break;
      case "status":
        ui.mode = "status";
        ui.statusPage = 0;
        break;
      case "discipline":
        scold();
        break;
      case "attention":
        acknowledgeCall();
        break;
    }
    render();
  }

  // Button A: move / select
  function pressA() {
    if (!state.alive) return;
    if (ui.mode === "main") {
      ui.cursor = (ui.cursor + 1) % ICONS.length;
    } else if (ui.mode === "feed") {
      ui.feedCursor = (ui.feedCursor + 1) % 2;
    } else if (ui.mode === "status") {
      ui.statusPage = (ui.statusPage + 1) % 3;
    } else if (ui.mode === "game") {
      playGuess(0); // guess left
    }
    render();
  }

  // Button B: confirm / enter
  function pressB() {
    if (!state.alive) return;
    if (ui.mode === "main") {
      activateIcon(ICONS[ui.cursor]);
    } else if (ui.mode === "feed") {
      ui.feedCursor === 0 ? feedMeal() : feedSnack();
    } else if (ui.mode === "status") {
      ui.mode = "main";
      render();
    } else if (ui.mode === "game") {
      playGuess(1); // guess right
    }
  }

  // Button C: cancel / back
  function pressC() {
    if (!state.alive) return;
    if (ui.mode === "game") {
      game.active = false;
    }
    ui.mode = "main";
    render();
  }

  // ---- Rendering (LCD canvas) -----------------------------------------
  const canvas = document.getElementById("lcd");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const INK = "#38400f";
  const DIM = "rgba(56,64,15,0.35)";
  const LCD = "#9bb03f"; // background "off" pixel colour (for eye sparkle etc.)

  function px(x, y, w, h, color) {
    ctx.fillStyle = color || INK;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function text(str, x, y, size, color, align) {
    ctx.fillStyle = color || INK;
    ctx.font = `700 ${size}px "Courier New", monospace`;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    ctx.fillText(str, x, y);
    ctx.textAlign = "left";
  }

  function clearLcd() {
    ctx.clearRect(0, 0, W, H);
  }

  function drawHearts(x, y, value, label) {
    text(label, x, y, 13, INK);
    const full = Math.floor(clamp(value, 0, 4));
    for (let i = 0; i < 4; i++) {
      drawHeart(x + 52 + i * 20, y - 1, i < full);
    }
  }

  function drawHeart(x, y, filled) {
    ctx.fillStyle = filled ? INK : DIM;
    ctx.beginPath();
    const s = 14;
    ctx.moveTo(x + s / 2, y + s);
    ctx.bezierCurveTo(x - s * 0.2, y + s * 0.55, x + s * 0.1, y, x + s / 2, y + s * 0.32);
    ctx.bezierCurveTo(x + s * 0.9, y, x + s * 1.2, y + s * 0.55, x + s / 2, y + s);
    ctx.fill();
  }

  // ---- Cute pixel characters (outlined LCD style, not solid blobs) ----
  // 'X' = ink outline/body, 'e' = eye, 'o' = ink detail dot, '.' = LCD green.
  const SPRITES = {
    baby: [
      ".XXXXX.",
      "X.....X",
      "X.e.e.X",
      "X.....X",
      "X.....X",
      ".XXXXX.",
      ".X...X.",
      "XX...XX",
    ],
    child: [
      "...X...",
      "..XXX..",
      ".XXXXX.",
      "X.....X",
      "X.e.e.X",
      "X.....X",
      "X.....X",
      ".XXXXX.",
      ".X...X.",
      ".XX.XX.",
    ],
    teen: [
      ".X.....X.",
      ".X.....X.",
      ".XX...XX.",
      "X..XXX..X",
      "X.......X",
      "X.e...e.X",
      "X.......X",
      "X.......X",
      ".X.....X.",
      "..XXXXX..",
      "..X...X..",
    ],
    adult: [
      ".X.......X.",
      ".XX.....XX.",
      "X.XXXXXXX.X",
      "X.........X",
      "X..e...e..X",
      "X.........X",
      "X.........X",
      ".X.......X.",
      "..XXXXXXX..",
      "..X.....X..",
      ".XX.....XX.",
    ],
  };

  function blinkNow() {
    return Date.now() % 4200 < 170; // occasional cute blink
  }

  function creatureMood() {
    const hun = Math.floor(state.hunger);
    const hap = Math.floor(state.happy);
    if (state.sick) return "sad";
    if (hap >= 3 && hun >= 2) return "happy";
    if (hun === 0 || hap === 0) return "sad";
    return "neutral";
  }

  function drawMouth(x, y, m, mood) {
    const p = (dx, dy) => px(x + dx * m - m / 2, y + dy * m, m, m, INK);
    if (mood === "happy") {
      p(-1.4, 0); p(1.4, 0); p(-0.5, 0.7); p(0.5, 0.7);
    } else if (mood === "sad") {
      p(-1.4, 0.7); p(1.4, 0.7); p(-0.5, 0); p(0.5, 0);
    } else {
      p(-0.5, 0.35); p(0.5, 0.35);
    }
  }

  // Draw a sprite grid centered on cx/cy. cx/cy is the visual center.
  function drawSprite(grid, cx, cy, s, bob, opts) {
    opts = opts || {};
    const rows = grid.length;
    const cols = grid[0].length;
    const ox = Math.round(cx - (cols * s) / 2);
    const oy = Math.round(cy - (rows * s) / 2 + (bob ? -Math.round(s * 0.5) : 0));
    const eyes = [];
    for (let r = 0; r < rows; r++) {
      const line = grid[r];
      for (let c = 0; c < cols; c++) {
        const ch = line[c];
        if (ch === "X" || ch === "o") px(ox + c * s, oy + r * s, s, s, INK);
        else if (ch === "e") eyes.push([c, r]);
      }
    }
    const closed = opts.eyesClosed || blinkNow();
    let sumCol = 0;
    let maxRow = 0;
    eyes.forEach(([c, r]) => {
      sumCol += c;
      if (r > maxRow) maxRow = r;
      const ex = ox + c * s;
      const ey = oy + r * s;
      if (closed) {
        px(ex - 1, ey + s * 0.45, s + 2, Math.max(2, s * 0.22), INK);
      } else {
        px(ex, ey, s, s, INK);
        // sparkle highlight (LCD green) for a lively, cute eye
        px(ex + s * 0.5, ey + s * 0.12, Math.max(2, s * 0.3), Math.max(2, s * 0.3), LCD);
      }
    });
    if (eyes.length) {
      const mx = ox + (sumCol / eyes.length + 0.5) * s;
      const my = oy + (maxRow + 2) * s;
      drawMouth(mx, my, s * 0.5, opts.mood || "neutral");
    }
    if (opts.whiskers) {
      const wy = oy + Math.round(rows * 0.55) * s;
      px(ox - s * 0.7, wy, s * 0.8, Math.max(2, s * 0.22), INK);
      px(ox + cols * s - s * 0.1, wy, s * 0.8, Math.max(2, s * 0.22), INK);
    }
    return { ox, oy, cols, rows };
  }

  // Draw the pet for the current life stage. cx/cy is the visual center.
  function drawCreature(cx, cy, bob) {
    const stage = state.stage;
    if (stage === "egg") return drawEgg(cx, cy, bob);
    const s = 10;
    const grid = stage === "senior" ? SPRITES.adult : SPRITES[stage] || SPRITES.adult;
    const half = (grid[0].length * s) / 2;

    if (isSleeping()) {
      drawSprite(grid, cx, cy, s, false, {
        eyesClosed: true,
        mood: "neutral",
        whiskers: stage === "senior",
      });
      const now = Date.now();
      const rise = Math.floor(now / 600) % 2 === 0 ? 0 : -4;
      text("z", cx + half + 6, cy - 12 + rise, 15, INK);
      text("Z", cx + half + 20, cy - 30 + rise, 21, INK);
      return;
    }

    drawSprite(grid, cx, cy, s, bob, {
      mood: creatureMood(),
      whiskers: stage === "senior",
    });

    if (state.sick) {
      // sweat drop + alert, blinking gently
      if (Math.floor(Date.now() / 500) % 2 === 0) {
        text("!", cx + half + 6, cy - (grid.length * s) / 2, 22, INK, "center");
      }
      px(cx - half - 4, cy - 2, 4, 6, INK);
    }
  }

  function drawEgg(cx, cy, wobble) {
    const s = 9;
    const grid = [
      "...XXX...",
      "..X...X..",
      ".X.....X.",
      ".X..o..X.",
      "X.......X",
      "X..o.o..X",
      "X.......X",
      ".X.....X.",
      "..XXXXX..",
    ];
    const tilt = wobble ? 4 : -4;
    const cols = grid[0].length;
    const rows = grid.length;
    const ox = Math.round(cx + tilt - (cols * s) / 2);
    const oy = Math.round(cy - (rows * s) / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === "X" || grid[r][c] === "o") px(ox + c * s, oy + r * s, s, s, INK);
      }
    }
  }

  function drawPoop(x, y) {
    const s = 5;
    // classic soft-serve swirl pile
    px(x - s, y - 2 * s, 1.6 * s, s);
    px(x - 1.6 * s, y - s, 3 * s, s);
    px(x - 2.6 * s, y, 5 * s, s);
    px(x - 3 * s, y + s, 6 * s, s);
    // light notch that suggests the swirl curl
    px(x + 0.1 * s, y - s, s, s, LCD);
    px(x - 1 * s, y, s, s, LCD);
  }

  function render() {
    clearLcd();
    const now = Date.now();
    const bob = Math.floor(now / 500) % 2 === 0;

    if (!state.alive) return renderDeath();

    if (ui.mode === "feed") return renderFeed();
    if (ui.mode === "status") return renderStatus();
    if (ui.mode === "game") return renderGame(bob);

    // MAIN
    // top status glyphs (stacked so they never overlap)
    let labelY = 6;
    if (state.sick) { text("SICK", W - 8, labelY, 12, INK, "right"); labelY += 16; }
    if (isSleeping()) { text("SLEEP", W - 8, labelY, 12, INK, "right"); labelY += 16; }
    if (state.call) {
      // blinking call indicator
      if (Math.floor(now / 400) % 2 === 0) text("!", 10, 6, 22, INK);
    }

    // creature
    const cx = W / 2;
    const cy = H / 2 - 6;
    drawCreature(cx, cy, bob);

    // poop
    for (let i = 0; i < Math.min(state.poop, 3); i++) {
      drawPoop(46 + i * 40, H - 40);
    }

    // eating / anim overlays
    if (ui.anim && now < ui.animUntil) {
      if (ui.anim === "eat") text("munch", cx, cy + 50, 13, INK, "center");
      if (ui.anim === "heal") text("+", cx + 44, cy - 20, 22, INK, "center");
      if (ui.anim === "angry") text("grr", cx, cy + 50, 13, INK, "center");
    } else {
      ui.anim = null;
    }

    // transient message
    if (ui.message && now < ui.messageUntil) {
      px(0, H - 26, W, 26, INK);
      text(ui.message, W / 2, H - 22, 14, "#9bb03f", "center");
    } else if (!state.hatched) {
      px(0, H - 26, W, 26, INK);
      text("An egg! Wait for it to hatch...", W / 2, H - 22, 12, "#9bb03f", "center");
    }
  }

  function renderFeed() {
    text("FEED", W / 2, 12, 18, INK, "center");
    const opts = ["Meal (+hunger)", "Snack (+happy)"];
    opts.forEach((o, i) => {
      const y = 70 + i * 40;
      if (i === ui.feedCursor) {
        px(30, y - 4, W - 60, 30, DIM);
        text(">", 40, y, 18, INK);
      }
      text(o, 64, y, 18, INK);
    });
    text("A: switch   B: choose   C: back", W / 2, H - 22, 12, INK, "center");
  }

  function renderStatus() {
    const pages = [statusVitals, statusBody, statusCare];
    pages[ui.statusPage]();
    text(`STATUS ${ui.statusPage + 1}/3   A:next  B/C:back`, W / 2, H - 20, 11, INK, "center");
  }

  function statusVitals() {
    text("VITALS", W / 2, 8, 16, INK, "center");
    drawHearts(24, 46, state.hunger, "Hun");
    drawHearts(24, 76, state.happy, "Hap");
    text("Discipline", 24, 108, 13, INK);
    px(120, 110, 120, 12, DIM);
    px(120, 110, 120 * (state.discipline / 100), 12, INK);
  }

  function statusBody() {
    text("BODY", W / 2, 8, 16, INK, "center");
    text(`Stage:  ${cap(state.stage)}`, 24, 46, 15, INK);
    text(`Age:    ${state.ageYears} yr`, 24, 74, 15, INK);
    text(`Weight: ${Math.round(state.weight)} lb`, 24, 102, 15, INK);
    text(state.sick ? "Health: SICK" : "Health: OK", 24, 130, 15, INK);
  }

  function statusCare() {
    text("CARE LOG", W / 2, 8, 16, INK, "center");
    text(`Good care: ${state.goodCare}`, 24, 46, 15, INK);
    text(`Mistakes:  ${state.careMistakes}`, 24, 74, 15, INK);
    text(`Poop:      ${state.poop}`, 24, 102, 15, INK);
    text(`Light:     ${state.lightOn ? "ON" : "OFF"}`, 24, 130, 15, INK);
  }

  function renderGame(bob) {
    text("GUESS THE WAY!", W / 2, 8, 16, INK, "center");
    text(`Round ${game.round}/5   Wins ${game.wins}`, W / 2, 32, 13, INK, "center");

    const cx = W / 2, cy = H / 2 + 4;
    const revealed = game.guess !== null;
    // Pet turns toward target once revealed, else faces center.
    let dir = 0;
    if (revealed) dir = game.target === 0 ? -1 : 1;
    drawGamePet(cx, cy, dir, bob);

    if (revealed) {
      const win = game.guess === game.target;
      text(win ? "MATCH!" : "MISS!", W / 2, H - 46, 16, INK, "center");
    }
    text("A: left    B: right    C: quit", W / 2, H - 22, 12, INK, "center");
  }

  function drawGamePet(cx, cy, dir, bob) {
    const s = 8;
    const stage = state.stage;
    const grid = stage === "senior" ? SPRITES.adult
      : (SPRITES[stage] && stage !== "egg") ? SPRITES[stage] : SPRITES.child;
    drawSprite(grid, cx, cy, s, bob, {
      mood: "happy",
      whiskers: stage === "senior",
    });
    const half = (grid[0].length * s) / 2;
    if (dir < 0) text("<", cx - half - 14, cy - 12, 26, INK, "center");
    if (dir > 0) text(">", cx + half + 14, cy - 12, 26, INK, "center");
  }

  function renderDeath() {
    px(0, 0, W, H, INK);
    text("R.I.P.", W / 2, 40, 26, "#9bb03f", "center");
    text(`Passed from ${state.deathReason}`, W / 2, 84, 14, "#9bb03f", "center");
    text(`Lived ${state.ageYears} years`, W / 2, 108, 14, "#9bb03f", "center");
    text("Press any button to", W / 2, 146, 13, "#9bb03f", "center");
    text("hatch a new egg", W / 2, 164, 13, "#9bb03f", "center");
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---- Icon highlight in the DOM to match cursor -----------------------
  const iconEls = Array.from(document.querySelectorAll(".icon"));
  const iconIndex = {};
  iconEls.forEach((el) => (iconIndex[el.dataset.menu] = el));

  function syncIcons() {
    iconEls.forEach((el) => el.classList.remove("selected"));
    if (state.alive && ui.mode === "main") {
      const el = iconIndex[ICONS[ui.cursor]];
      if (el) el.classList.add("selected");
    }
  }

  const _render = render;
  render = function () {
    _render();
    syncIcons();
  };

  // ---- Wire up controls ------------------------------------------------
  function tapHandler(fn) {
    return (e) => {
      e.preventDefault();
      if (!state.alive) {
        reset();
        return;
      }
      fn();
    };
  }

  const bA = document.getElementById("btnA");
  const bB = document.getElementById("btnB");
  const bC = document.getElementById("btnC");
  bA.addEventListener("click", tapHandler(pressA));
  bB.addEventListener("click", tapHandler(pressB));
  bC.addEventListener("click", tapHandler(pressC));

  // Clicking an on-screen icon jumps the cursor there and activates it.
  iconEls.forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.alive) return reset();
      const name = el.dataset.menu;
      const idx = ICONS.indexOf(name);
      if (idx >= 0) ui.cursor = idx;
      ui.mode = "main";
      activateIcon(name);
    });
  });

  // Keyboard: A/left, B/right/enter, C/esc, plus arrows.
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (!state.alive) {
      reset();
      return;
    }
    if (k === "a" || k === "arrowleft") { e.preventDefault(); pressA(); }
    else if (k === "b" || k === "arrowright" || k === "enter") { e.preventDefault(); pressB(); }
    else if (k === "c" || k === "escape") { e.preventDefault(); pressC(); }
  });

  // ---- Main loop -------------------------------------------------------
  let lastSave = 0;
  function tick() {
    const now = Date.now();
    simulate(now);
    render();
    if (now - lastSave > 5000) {
      save();
      lastSave = now;
    }
  }
  setInterval(tick, 500);

  // Persist promptly when the tab is hidden or closed.
  document.addEventListener("visibilitychange", () => {
    simulate(Date.now());
    save();
  });
  window.addEventListener("pagehide", () => {
    simulate(Date.now());
    save();
  });

  // First paint
  simulate(Date.now());
  render();
})();
