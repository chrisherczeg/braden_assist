const PLAYER_ID = "5105854";
const PURDUE_TEAM_ID = "2509";
const BASE = "https://site.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes";
const ESPN_V2 = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const SCOREBOARD_URL = ESPN_V2 + "/scoreboard";
const SUMMARY_URL = ESPN_V2 + "/summary";
const REFRESH_MS = 45_000;
const RECORD = 1076;
let confettiFired = false;

const elCount = document.getElementById("assist-count");
const elBreakdown = document.getElementById("breakdown");
const elPulse = document.getElementById("pulse");
const elStatus = document.getElementById("status-text");
const elProgress = document.getElementById("progress-fill");
const elError = document.getElementById("error-msg");

async function espnGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ESPN returned ${resp.status}`);
  return resp.json();
}

async function getCareerAssists() {
  // 1) Per-season totals from /stats
  const stats = await espnGet(`${BASE}/${PLAYER_ID}/stats`);
  let priorAst = 0;
  let currentSeasonName = "";

  for (const cat of (stats.categories || [])) {
    if (!(cat.displayName || "").includes("Total")) continue;
    const labels = cat.labels || [];
    const astIdx = labels.indexOf("AST");
    if (astIdx === -1) continue;

    const seasons = cat.statistics || [];
    if (seasons.length) {
      currentSeasonName = (seasons[seasons.length - 1].season || {}).displayName || "";
    }
    // Sum all prior seasons (everything except the last)
    for (const entry of seasons.slice(0, -1)) {
      const val = parseInt(entry.stats?.[astIdx], 10);
      if (!isNaN(val)) priorAst += val;
    }
    break;
  }

  // 2) Current season assists from gamelog (real-time)
  const gamelog = await espnGet(`${BASE}/${PLAYER_ID}/gamelog`);
  const glLabels = gamelog.labels || [];
  const glAstIdx = glLabels.indexOf("AST");

  let currentAst = 0;
  if (glAstIdx !== -1) {
    for (const st of (gamelog.seasonTypes || [])) {
      for (const cat of (st.categories || [])) {
        for (const event of (cat.events || [])) {
          const row = event.stats || [];
          if (glAstIdx < row.length) {
            const val = parseInt(row[glAstIdx], 10);
            if (!isNaN(val)) currentAst += val;
          }
        }
      }
    }
  }

  return { total: priorAst + currentAst, priorAst, currentAst, currentSeasonName };
}

async function getLiveGameAssists() {
  try {
    const scoreboard = await espnGet(SCOREBOARD_URL);
    for (const event of (scoreboard.events || [])) {
      const st = (event.status || {}).type || {};
      if (st.state !== "in") continue;
      for (const comp of (event.competitions || [])) {
        for (const team of (comp.competitors || [])) {
          if ((team.team || {}).id === PURDUE_TEAM_ID || String((team.team || {}).id) === PURDUE_TEAM_ID) {
            const summary = await espnGet(`${SUMMARY_URL}?event=${event.id}`);
            for (const bp of ((summary.boxscore || {}).players || [])) {
              if (String((bp.team || {}).id) !== PURDUE_TEAM_ID) continue;
              for (const statSet of (bp.statistics || [])) {
                const labels = statSet.labels || [];
                const astIdx = labels.indexOf("AST");
                if (astIdx === -1) continue;
                for (const athlete of (statSet.athletes || [])) {
                  if (String((athlete.athlete || {}).id) === PLAYER_ID) {
                    const val = parseInt((athlete.stats || [])[astIdx], 10);
                    return isNaN(val) ? 0 : val;
                  }
                }
              }
            }
            return 0;
          }
        }
      }
    }
  } catch (e) { /* scoreboard unavailable, not critical */ }
  return 0;
}

async function refresh() {
  try {
    elCount.classList.add("loading");
    const [career, liveAst] = await Promise.all([getCareerAssists(), getLiveGameAssists()]);
    const { total, priorAst, currentAst, currentSeasonName } = career;
    const grandTotal = total + liveAst;

    document.getElementById("assist-num").textContent = grandTotal.toLocaleString();
    elCount.classList.remove("loading");

    if (grandTotal > RECORD && !confettiFired) {
      confettiFired = true;
      launchConfetti();
      document.getElementById("record-holder").textContent = "Record held by Braden Smith 🚂";
    }

    const parts = [];
    if (priorAst) parts.push(`<span>${priorAst}</span> prior seasons`);
    if (currentAst || currentSeasonName) parts.push(`<span>${currentAst}</span> ${currentSeasonName || "current season"}`);
    if (liveAst) parts.push(`<span>${liveAst}</span> live game`);
    elBreakdown.innerHTML = parts.join(" + ");

    elPulse.classList.remove("error");
    elStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    elError.style.display = "none";
  } catch (err) {
    elPulse.classList.add("error");
    elStatus.textContent = "Update failed";
    elError.textContent = err.message;
    elError.style.display = "block";
    elCount.classList.remove("loading");
  }
}

// ─── Confetti Explosion ──────────────────────────
function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W, H;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener("resize", resize);

  const COLORS = ["#CFB991", "#FFFFFF", "#F5D56E", "#E8C547", "#FFD700", "#C4A44A"];
  const COUNT = 250;
  const pieces = [];

  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    pieces.push({
      x: W / 2, y: H / 2,
      vx: Math.cos(angle) * speed * (0.6 + Math.random()),
      vy: Math.sin(angle) * speed * (0.6 + Math.random()) - 3,
      w: 4 + Math.random() * 6,
      h: 6 + Math.random() * 10,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.3,
      gravity: 0.12 + Math.random() * 0.06,
      alpha: 1,
      decay: 0.003 + Math.random() * 0.004
    });
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rot += p.rv;
      p.alpha -= p.decay;
      if (p.alpha <= 0) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else { canvas.remove(); window.removeEventListener("resize", resize); }
  }
  requestAnimationFrame(frame);
}

// Progress bar animation
function startProgress() {
  elProgress.style.transition = "none";
  elProgress.style.width = "0%";
  // Force reflow
  void elProgress.offsetWidth;
  elProgress.style.transition = `width ${REFRESH_MS}ms linear`;
  elProgress.style.width = "100%";
}

async function tick() {
  await Promise.allSettled([refresh(), fetchGameCard()]);
  startProgress();
}

// ─── Game Card (Live or Next) ────────────────────
const SCHEDULE_URL = ESPN_V2 + "/teams/" + PURDUE_TEAM_ID + "/schedule";
const PURDUE_LOGO = "https://a.espncdn.com/i/teamlogos/ncaa/500/2509.png";

const elCardTitle   = document.getElementById("game-card-title");
const elGameContent = document.getElementById("game-content");
const elGameLoading = document.getElementById("game-loading");
const elGameError   = document.getElementById("game-error");

function toLocalTime(utcStr) {
  const dt = new Date(utcStr);
  return dt.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short"
  });
}

function parseRecord(raw) {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (r && r.type === "total") return r.summary || r.displayValue || "";
    }
    if (raw.length && raw[0]) return raw[0].summary || raw[0].displayValue || "";
  }
  return "";
}

function getRec(t) {
  for (const r of (t.records || [])) { if (r.type === "total") return r.summary || ""; }
  return (t.records || [])[0]?.summary || "";
}

async function fetchAllEvents() {
  const allEvents = [];
  for (const st of [2, 3, 4]) {
    try {
      const data = await espnGet(SCHEDULE_URL + "?seasontype=" + st);
      allEvents.push(...(data.events || []));
    } catch (e) { /* season type may not exist */ }
  }
  return allEvents;
}

async function fetchGameCard() {
  try {
    elGameLoading.style.display = "block";
    elGameContent.style.display = "none";
    elGameError.style.display   = "none";

    const events = await fetchAllEvents();

    // Separate live games from upcoming
    let liveEvent = null;
    const upcoming = [];

    for (const ev of events) {
      const st = ((ev.competitions || [{}])[0].status || {}).type || {};
      if (st.name === "STATUS_FINAL") continue;
      if (st.name === "STATUS_IN_PROGRESS" || st.name === "STATUS_HALFTIME" || st.name === "STATUS_END_PERIOD") {
        liveEvent = ev;
        break;
      }
      upcoming.push(ev);
    }

    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (liveEvent) {
      await renderLiveGame(liveEvent);
    } else if (upcoming.length) {
      renderNextGame(upcoming[0]);
    } else {
      elCardTitle.textContent = "Next Game";
      elGameLoading.style.display = "none";
      elGameContent.innerHTML = '<div class="game-loading">No upcoming games found.</div>';
      elGameContent.style.display = "block";
    }
  } catch (err) {
    elGameLoading.style.display = "none";
    elGameError.textContent = err.message;
    elGameError.style.display = "block";
  }
}

async function renderLiveGame(ev) {
  elCardTitle.textContent = "Live Game";

  const eventId = ev.id || (ev.competitions || [{}])[0].id || "";
  const summary = await espnGet(`${SUMMARY_URL}?event=${eventId}`);
  const header = summary.header || {};
  const comps = header.competitions || [];
  if (!comps.length) throw new Error("No live data available");

  const comp = comps[0];
  const status = comp.status || {};
  const statusType = status.type || {};
  const competitors = comp.competitors || [];

  let purdue = null, opponent = null;
  for (const c of competitors) {
    if (String((c.team || {}).id) === PURDUE_TEAM_ID) purdue = c;
    else opponent = c;
  }
  if (!purdue || !opponent) throw new Error("Could not identify teams");

  const purTeam = purdue.team || {};
  const oppTeam = opponent.team || {};
  const purScore = purdue.score || "0";
  const oppScore = opponent.score || "0";
  const purRec = parseRecord(purdue.record || "");
  const oppRec = parseRecord(opponent.record || "");
  const purRank = purdue.rank;
  const oppRank = opponent.rank;
  const purRankStr = purRank && purRank <= 25 ? `#${purRank}` : "";
  const oppRankStr = oppRank && oppRank <= 25 ? `#${oppRank}` : "";
  const oppLogo = (oppTeam.logos || [])[0]?.href || "";

  const purWinning = parseInt(purScore) >= parseInt(oppScore);
  const purMarker = purWinning ? " ◀" : "";
  const oppMarker = !purWinning ? " ◀" : "";

  let statusLine = "";
  if (statusType.name === "STATUS_HALFTIME") {
    statusLine = "🔴 Halftime";
  } else if (statusType.name === "STATUS_END_PERIOD") {
    statusLine = `🔴 End of ${status.displayPeriod || "period"}`;
  } else {
    statusLine = `🔴 ${statusType.detail || statusType.description || "Live"}`;
  }

  let html = `
    <div class="scoreboard">
      <div class="score-row">
        <img class="score-logo" src="${PURDUE_LOGO}" alt="Purdue">
        <div class="score-team-info">
          <span class="score-team-name">${purRankStr ? purRankStr + " " : ""}Purdue</span>
          ${purRec ? `<span class="score-team-record">${purRec}</span>` : ""}
        </div>
        <span class="score-value${purWinning ? " winning" : ""}">${purScore}${purMarker}</span>
      </div>
      <div class="score-row">
        <img class="score-logo" src="${oppLogo}" alt="${oppTeam.displayName || ""}">
        <div class="score-team-info">
          <span class="score-team-name">${oppRankStr ? oppRankStr + " " : ""}${oppTeam.shortDisplayName || oppTeam.displayName || ""}</span>
          ${oppRec ? `<span class="score-team-record">${oppRec}</span>` : ""}
        </div>
        <span class="score-value${!purWinning ? " winning" : ""}">${oppScore}${oppMarker}</span>
      </div>
    </div>
    <div class="live-status">${statusLine}</div>`;

  // Add venue/TV from schedule event as extra context
  const schedComp = (ev.competitions || [])[0] || {};
  const venue = schedComp.venue || {};
  const venueName = venue.fullName || "";
  const venueCity = (venue.address || {}).city || "";
  const venueState = (venue.address || {}).state || "";
  const venueLoc = [venueCity, venueState].filter(Boolean).join(", ");
  const broadcasts = schedComp.broadcasts || [];
  const tvNames = broadcasts.flatMap(b => b.names || []);
  const tv = tvNames.length ? tvNames.join(", ") : "";

  const details = [];
  if (venueName) {
    let v = venueName;
    if (venueLoc) v += " — " + venueLoc;
    details.push(["Venue", v]);
  }
  if (tv) details.push(["TV", tv]);

  if (details.length) {
    html += `<div class="game-details" style="margin-top: 1rem;">`;
    for (const [label, value] of details) {
      html += `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
    }
    html += `</div>`;
  }

  const noteHeadline = ((schedComp.notes || [])[0] || {}).headline || "";
  if (noteHeadline) {
    html += `<div class="game-note">${noteHeadline}</div>`;
  }

  elGameLoading.style.display = "none";
  elGameContent.innerHTML = html;
  elGameContent.style.display = "block";
}

function renderNextGame(ev) {
  elCardTitle.textContent = "Next Game";

  const comp = (ev.competitions || [])[0] || {};
  const competitors = comp.competitors || [];

  let purdue = null, opponent = null;
  for (const t of competitors) {
    if (String((t.team || {}).id) === PURDUE_TEAM_ID) purdue = t;
    else opponent = t;
  }
  if (!opponent) throw new Error("Could not determine opponent");

  const oppTeam = opponent.team || {};

  // Rankings
  const purRank = (purdue || {}).curatedRank?.current;
  const oppRank = opponent.curatedRank?.current;
  const purRankStr = purRank && purRank <= 25 ? `#${purRank}` : "";
  const oppRankStr = oppRank && oppRank <= 25 ? `#${oppRank}` : "";

  // Records
  const purRec = getRec(purdue || {});
  const oppRec = getRec(opponent);

  // Venue
  const venue = comp.venue || {};
  const venueName = venue.fullName || "";
  const venueCity = (venue.address || {}).city || "";
  const venueState = (venue.address || {}).state || "";
  const venueLoc = [venueCity, venueState].filter(Boolean).join(", ");

  // Broadcast
  const broadcasts = comp.broadcasts || [];
  const tvNames = broadcasts.flatMap(b => b.names || []);
  const tv = tvNames.length ? tvNames.join(", ") : "TBD";

  // Odds
  const odds = (comp.odds || [])[0] || {};
  const spread = odds.details || "";
  const ou = odds.overUnder || "";

  // Status
  const statusType = ((comp.status || {}).type || {});
  const isLive = statusType.name === "STATUS_IN_PROGRESS" || statusType.name === "STATUS_HALFTIME";
  const statusDesc = statusType.description || "";

  // Notes
  const noteHeadline = ((comp.notes || [])[0] || {}).headline || "";
  const neutralSite = comp.neutralSite || false;
  const isHome = (purdue || {}).homeAway === "home";

  // Opponent logo
  const oppLogo = (oppTeam.logos || [])[0]?.href || "";

  // Build HTML
  let vsLabel = neutralSite ? "vs" : (isHome ? "vs" : "at");

  let html = `
    <div class="matchup">
      <div class="matchup-team">
        <img src="${PURDUE_LOGO}" alt="Purdue">
        ${purRankStr ? `<span class="team-rank">${purRankStr}</span>` : ""}
        <span class="team-name">Purdue</span>
        ${purRec ? `<span class="team-record">${purRec}</span>` : ""}
      </div>
      <span class="matchup-vs">${vsLabel}</span>
      <div class="matchup-team">
        <img src="${oppLogo}" alt="${oppTeam.displayName || ""}">
        ${oppRankStr ? `<span class="team-rank">${oppRankStr}</span>` : ""}
        <span class="team-name">${oppTeam.shortDisplayName || oppTeam.displayName || ""}</span>
        ${oppRec ? `<span class="team-record">${oppRec}</span>` : ""}
      </div>
    </div>
    <div class="game-details">`;

  if (isLive) {
    html += `<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value live">🔴 LIVE — ${statusDesc}</span></div>`;
  }

  html += `<div class="detail-row"><span class="detail-label">When</span><span class="detail-value">${toLocalTime(ev.date)}</span></div>`;

  if (venueName) {
    let venueStr = venueName;
    if (venueLoc) venueStr += " — " + venueLoc;
    html += `<div class="detail-row"><span class="detail-label">Venue</span><span class="detail-value">${venueStr}</span></div>`;
  }

  if (neutralSite) {
    html += `<div class="detail-row"><span class="detail-label">Site</span><span class="detail-value">Neutral Site</span></div>`;
  } else {
    html += `<div class="detail-row"><span class="detail-label">Site</span><span class="detail-value">${isHome ? "Home" : "Away"}</span></div>`;
  }

  html += `<div class="detail-row"><span class="detail-label">TV</span><span class="detail-value">${tv}</span></div>`;

  if (spread) {
    let lineStr = spread;
    if (ou) lineStr += `  |  O/U: ${ou}`;
    html += `<div class="detail-row"><span class="detail-label">Line</span><span class="detail-value">${lineStr}</span></div>`;
  }

  html += `</div>`;

  if (noteHeadline) {
    html += `<div class="game-note">${noteHeadline}</div>`;
  }

  elGameLoading.style.display = "none";
  elGameContent.innerHTML = html;
  elGameContent.style.display = "block";
}

// ─── Previous Game Card ─────────────────────────
const elPrevCardTitle   = document.getElementById("prev-card-title");
const elPrevGameContent = document.getElementById("prev-game-content");
const elPrevGameLoading = document.getElementById("prev-game-loading");
const elPrevGameError   = document.getElementById("prev-game-error");

async function fetchPrevGameCard() {
  try {
    elPrevGameLoading.style.display = "block";
    elPrevGameContent.style.display = "none";
    elPrevGameError.style.display   = "none";

    const events = await fetchAllEvents();

    // Collect all finished games and pick the most recent one
    const finished = [];
    for (const ev of events) {
      const st = ((ev.competitions || [{}])[0].status || {}).type || {};
      if (st.name === "STATUS_FINAL") finished.push(ev);
    }

    finished.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!finished.length) {
      elPrevGameLoading.style.display = "none";
      elPrevGameContent.innerHTML = '<div class="game-loading">No completed games found.</div>';
      elPrevGameContent.style.display = "block";
      return;
    }

    await renderPrevGame(finished[0]);
  } catch (err) {
    elPrevGameLoading.style.display = "none";
    elPrevGameError.textContent = err.message;
    elPrevGameError.style.display = "block";
  }
}

async function renderPrevGame(ev) {
  elPrevCardTitle.textContent = "Last Game";

  const eventId = ev.id || (ev.competitions || [{}])[0].id || "";
  const summary = await espnGet(`${SUMMARY_URL}?event=${eventId}`);
  const header = summary.header || {};
  const comps = header.competitions || [];
  if (!comps.length) throw new Error("No game data available");

  const comp = comps[0];
  const statusType = (comp.status || {}).type || {};
  const competitors = comp.competitors || [];

  let purdue = null, opponent = null;
  for (const c of competitors) {
    if (String((c.team || {}).id) === PURDUE_TEAM_ID) purdue = c;
    else opponent = c;
  }
  if (!purdue || !opponent) throw new Error("Could not identify teams");

  const purTeam = purdue.team || {};
  const oppTeam = opponent.team || {};
  const purScore = purdue.score || "0";
  const oppScore = opponent.score || "0";
  const purRec = parseRecord(purdue.record || "");
  const oppRec = parseRecord(opponent.record || "");
  const purRank = purdue.rank;
  const oppRank = opponent.rank;
  const purRankStr = purRank && purRank <= 25 ? `#${purRank}` : "";
  const oppRankStr = oppRank && oppRank <= 25 ? `#${oppRank}` : "";
  const oppLogo = (oppTeam.logos || [])[0]?.href || "";

  const purWon = parseInt(purScore) > parseInt(oppScore);
  const purMarker = purWon ? " ◀" : "";
  const oppMarker = !purWon ? " ◀" : "";

  const resultBadge = purWon
    ? '<span class="result-badge win">W</span>'
    : '<span class="result-badge loss">L</span>';

  let html = `
    ${resultBadge}
    <div class="scoreboard">
      <div class="score-row">
        <img class="score-logo" src="${PURDUE_LOGO}" alt="Purdue">
        <div class="score-team-info">
          <span class="score-team-name">${purRankStr ? purRankStr + " " : ""}Purdue</span>
          ${purRec ? `<span class="score-team-record">${purRec}</span>` : ""}
        </div>
        <span class="score-value${purWon ? " winning" : ""}">${purScore}${purMarker}</span>
      </div>
      <div class="score-row">
        <img class="score-logo" src="${oppLogo}" alt="${oppTeam.displayName || ""}">
        <div class="score-team-info">
          <span class="score-team-name">${oppRankStr ? oppRankStr + " " : ""}${oppTeam.shortDisplayName || oppTeam.displayName || ""}</span>
          ${oppRec ? `<span class="score-team-record">${oppRec}</span>` : ""}
        </div>
        <span class="score-value${!purWon ? " winning" : ""}">${oppScore}${oppMarker}</span>
      </div>
    </div>
    <div class="final-status">${statusType.detail || "Final"}</div>`;

  // Date and venue from schedule event
  const schedComp = (ev.competitions || [])[0] || {};
  const venue = schedComp.venue || {};
  const venueName = venue.fullName || "";
  const venueCity = (venue.address || {}).city || "";
  const venueState = (venue.address || {}).state || "";
  const venueLoc = [venueCity, venueState].filter(Boolean).join(", ");

  const details = [];
  if (ev.date) details.push(["Date", toLocalTime(ev.date)]);
  if (venueName) {
    let v = venueName;
    if (venueLoc) v += " — " + venueLoc;
    details.push(["Venue", v]);
  }

  const noteHeadline = ((schedComp.notes || [])[0] || {}).headline || "";

  if (details.length) {
    html += `<div class="game-details" style="margin-top: 1rem;">`;
    for (const [label, value] of details) {
      html += `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
    }
    html += `</div>`;
  }

  if (noteHeadline) {
    html += `<div class="game-note">${noteHeadline}</div>`;
  }

  elPrevGameLoading.style.display = "none";
  elPrevGameContent.innerHTML = html;
  elPrevGameContent.style.display = "block";
}

// ─── PWA Service Worker Registration ─────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ─── Push Notification Setup ─────────────────────
const elNotifyBtn = document.getElementById("notify-btn");

function updateNotifyBtn(subscribed) {
  elNotifyBtn.classList.toggle("subscribed", subscribed);
  elNotifyBtn.title = subscribed ? "Notifications enabled" : "Enable notifications";
}

async function checkExistingSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    elNotifyBtn.style.display = "none";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    updateNotifyBtn(!!sub);
  } catch {
    // Not critical
  }
}

elNotifyBtn.addEventListener("click", async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Push notifications are not supported in this browser.");
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();

  if (existing) {
    await existing.unsubscribe();
    updateNotifyBtn(false);
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  // Subscribe — generates a subscription object the server would use.
  // Without a real push server, we use local notifications as a fallback.
  try {
    await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: null  // Replace with VAPID public key when you add a push server
    });
    updateNotifyBtn(true);
  } catch {
    // Fallback: just use Notification API directly (no push server needed)
    updateNotifyBtn(true);
    localStorage.setItem("pb_notify", "1");
  }
});

// Local notification helpers (fire from the main thread when no push server)
let _prevAssistTotal = null;

function maybeNotifyMilestone(currentTotal) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!localStorage.getItem("pb_notify")) return;

  if (_prevAssistTotal !== null && currentTotal > _prevAssistTotal) {
    // Milestone checks
    if (currentTotal >= RECORD && _prevAssistTotal < RECORD) {
      new Notification("🚂 RECORD BROKEN!", {
        body: `Braden Smith just broke the all-time assist record with ${currentTotal} career assists!`,
        icon: "/purdue_ballers.png"
      });
    } else if (currentTotal % 50 === 0) {
      new Notification("Purdue Ball", {
        body: `Braden Smith has reached ${currentTotal} career assists! Boiler Up! 🚂`,
        icon: "/purdue_ballers.png"
      });
    }
  }
  _prevAssistTotal = currentTotal;
}

// ─── Share Stats Card (html2canvas) ──────────────
const elShareBtn = document.getElementById("share-btn");

elShareBtn.addEventListener("click", async () => {
  const card = elShareBtn.closest(".card");
  elShareBtn.style.visibility = "hidden";

  try {
    const canvas = await html2canvas(card, {
      backgroundColor: "#101010",
      scale: 2,
      useCORS: true,
      logging: false
    });

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // Use Web Share API if available (mobile)
      if (navigator.canShare && navigator.canShare({ files: [new File([blob], "purdue-ball.png", { type: "image/png" })] })) {
        try {
          await navigator.share({
            title: "Purdue Ball — Braden Smith Assist Tracker",
            text: `Braden Smith: ${document.getElementById("assist-num").textContent} career assists 🚂`,
            files: [new File([blob], "purdue-ball.png", { type: "image/png" })]
          });
        } catch {
          downloadBlob(blob);
        }
      } else {
        downloadBlob(blob);
      }
    }, "image/png");
  } catch {
    alert("Could not generate image. Try again.");
  } finally {
    elShareBtn.style.visibility = "";
  }
});

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "purdue-ball.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Patched refresh to fire milestone notifications ──
const _origRefresh = refresh;
refresh = async function () {
  await _origRefresh();
  const numEl = document.getElementById("assist-num");
  const val = parseInt(numEl.textContent.replace(/,/g, ""), 10);
  if (!isNaN(val)) maybeNotifyMilestone(val);
};

// Initial fetch + recurring timer (must be after all declarations)
checkExistingSubscription();
tick();
setInterval(tick, REFRESH_MS);

// Fetch previous game once on load (doesn't need recurring refresh)
fetchPrevGameCard();
