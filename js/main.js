const PLAYER_ID = "5105854";
const BASE = "https://site.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/athletes";
const REFRESH_MS = 45_000;

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

async function refresh() {
  try {
    elCount.classList.add("loading");
    const { total, priorAst, currentAst, currentSeasonName } = await getCareerAssists();

    document.getElementById("assist-num").textContent = total.toLocaleString();
    elCount.classList.remove("loading");

    const parts = [];
    if (priorAst) parts.push(`<span>${priorAst}</span> prior seasons`);
    if (currentAst || currentSeasonName) parts.push(`<span>${currentAst}</span> ${currentSeasonName || "current season"}`);
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
  await refresh();
  startProgress();
}

// Initial fetch + recurring timer
tick();
setInterval(tick, REFRESH_MS);

// ─── Next Game ───────────────────────────────────
const PURDUE_TEAM_ID = "2509";
const SCHEDULE_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/" + PURDUE_TEAM_ID + "/schedule";
const PURDUE_LOGO = "https://a.espncdn.com/i/teamlogos/ncaa/500/2509.png";

const elGameContent = document.getElementById("game-content");
const elGameLoading = document.getElementById("game-loading");
const elGameError   = document.getElementById("game-error");

function toEastern(utcStr) {
  const dt = new Date(utcStr);
  return dt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short"
  });
}

async function fetchNextGame() {
  try {
    elGameLoading.style.display = "block";
    elGameContent.style.display = "none";
    elGameError.style.display   = "none";

    const data = await espnGet(SCHEDULE_URL);
    const events = data.events || [];

    // Find first non-final game
    const upcoming = events
      .filter(ev => {
        const st = ((ev.competitions || [{}])[0].status || {}).type || {};
        return st.name !== "STATUS_FINAL";
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!upcoming.length) {
      elGameLoading.style.display = "none";
      elGameContent.innerHTML = '<div class="game-loading">No upcoming games found.</div>';
      elGameContent.style.display = "block";
      return;
    }

    const ev = upcoming[0];
    const comp = (ev.competitions || [])[0] || {};
    const competitors = comp.competitors || [];

    let purdue = null, opponent = null;
    for (const t of competitors) {
      if (String((t.team || {}).id) === PURDUE_TEAM_ID) purdue = t;
      else opponent = t;
    }
    if (!opponent) throw new Error("Could not determine opponent");

    const oppTeam = opponent.team || {};
    const purTeam = (purdue || {}).team || {};

    // Rankings
    const purRank = (purdue || {}).curatedRank?.current;
    const oppRank = opponent.curatedRank?.current;
    const purRankStr = purRank && purRank <= 25 ? `#${purRank}` : "";
    const oppRankStr = oppRank && oppRank <= 25 ? `#${oppRank}` : "";

    // Records
    const getRec = (t) => {
      for (const r of (t.records || [])) { if (r.type === "total") return r.summary || ""; }
      return (t.records || [])[0]?.summary || "";
    };
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

    html += `<div class="detail-row"><span class="detail-label">When</span><span class="detail-value">${toEastern(ev.date)}</span></div>`;

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
  } catch (err) {
    elGameLoading.style.display = "none";
    elGameError.textContent = err.message;
    elGameError.style.display = "block";
  }
}

fetchNextGame();
setInterval(fetchNextGame, 5 * 60_000); // refresh every 5 min
