const PURDUE_TEAM_ID = "2509";
const SPORTS = {
  basketball: {
    label: "Men's Basketball",
    api: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
  },
  football: {
    label: "Football",
    api: "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
  },
  "womens-basketball": {
    label: "Women's Basketball",
    api: "https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball"
  }
};
const REFRESH_MS = 45_000;
let activeSport = "basketball";
let refreshVersion = 0;

const elPulse = document.getElementById("pulse");
const elStatus = document.getElementById("status-text");
const elProgress = document.getElementById("progress-fill");
const elError = document.getElementById("error-msg");

async function espnGet(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`ESPN returned ${resp.status}`);
  return resp.json();
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
  const version = ++refreshVersion;
  const sport = SPORTS[activeSport];
  const panel = document.getElementById("sports-panel");
  panel.setAttribute("aria-busy", "true");
  elCardTitle.textContent = "Next Game";
  elPrevCardTitle.textContent = "Last Game";
  elStatus.textContent = "Loading " + sport.label.toLowerCase() + "\u2026";
  elError.style.display = "none";
  for (const [loading, content, error] of [
    [elGameLoading, elGameContent, elGameError],
    [elPrevGameLoading, elPrevGameContent, elPrevGameError]
  ]) {
    loading.style.display = "block";
    content.style.display = "none";
    error.style.display = "none";
  }

  try {
    const events = await fetchAllEvents(sport.api);
    if (version !== refreshVersion) return;
    const results = await Promise.allSettled([
      fetchGameCard(events, sport.api, version),
      fetchPrevGameCard(events, sport.api, version)
    ]);
    if (version !== refreshVersion) return;
    const errors = results.filter(result => result.status === "rejected");
    if (errors.length) throw new Error(errors.map(result => result.reason.message).join("; "));
    elPulse.classList.remove("error");
    elStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (version !== refreshVersion) return;
    elPulse.classList.add("error");
    elStatus.textContent = "Update failed";
    elError.textContent = err.message;
    elError.style.display = "block";
    elGameLoading.style.display = "none";
    elPrevGameLoading.style.display = "none";
  } finally {
    if (version === refreshVersion) {
      panel.setAttribute("aria-busy", "false");
      startProgress();
    }
  }
}

// ─── Game Card (Live or Next) ────────────────────
const PURDUE_LOGO = "https://a.espncdn.com/i/teamlogos/ncaa/500/2509.png";

const elCardTitle   = document.getElementById("game-card-title");
const elGameContent = document.getElementById("game-content");
const elGameLoading = document.getElementById("game-loading");
const elGameError   = document.getElementById("game-error");

function toLocalTime(utcStr, timeValid = true) {
  const dt = new Date(utcStr);
  if (!timeValid) {
    return dt.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      timeZone: "UTC"
    }) + " \u2014 Time TBD";
  }
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

async function fetchAllEvents(api) {
  const schedules = await Promise.all([2, 3, 4].map(st =>
    espnGet(`${api}/teams/${PURDUE_TEAM_ID}/schedule?seasontype=${st}`)
  ));
  const events = new Map();
  for (const schedule of schedules) {
    for (const event of (schedule.events || [])) events.set(event.id, event);
  }
  return [...events.values()];
}

async function fetchGameCard(events, api, version) {
  try {
    // Separate live games from upcoming
    let liveEvent = null;
    const upcoming = [];

    for (const ev of events) {
      const st = ((ev.competitions || [{}])[0].status || {}).type || {};
      if (st.completed || st.name === "STATUS_FINAL" || st.name === "STATUS_CANCELED" || st.name === "STATUS_POSTPONED") continue;
      if (st.state === "in" || st.name === "STATUS_IN_PROGRESS" || st.name === "STATUS_HALFTIME" || st.name === "STATUS_END_PERIOD") {
        liveEvent = ev;
        break;
      }
      if (st.name === "STATUS_SCHEDULED" || (st.state === "pre" && new Date(ev.date) >= new Date())) upcoming.push(ev);
    }

    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (liveEvent) {
      const summary = await espnGet(`${api}/summary?event=${liveEvent.id}`);
      if (version !== refreshVersion) return;
      renderLiveGame(liveEvent, summary);
    } else if (upcoming.length) {
      renderNextGame(upcoming[0]);
    } else {
      elCardTitle.textContent = "Next Game";
      elGameLoading.style.display = "none";
      elGameContent.innerHTML = '<div class="game-loading">No upcoming games found.</div>';
      elGameContent.style.display = "block";
    }
  } catch (err) {
    if (version !== refreshVersion) return;
    elGameLoading.style.display = "none";
    elGameError.textContent = err.message;
    elGameError.style.display = "block";
    throw err;
  }
}

function renderLiveGame(ev, summary) {
  elCardTitle.textContent = "Live Game";

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

  html += `<div class="detail-row"><span class="detail-label">When</span><span class="detail-value">${toLocalTime(ev.date, comp.timeValid !== false)}</span></div>`;

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

async function fetchPrevGameCard(events, api, version) {
  try {
    // Collect all finished games and pick the most recent one
    const finished = [];
    for (const ev of events) {
      const st = ((ev.competitions || [{}])[0].status || {}).type || {};
      if (st.completed || st.name === "STATUS_FINAL") finished.push(ev);
    }

    finished.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!finished.length) {
      elPrevGameLoading.style.display = "none";
      elPrevGameContent.innerHTML = '<div class="game-loading">No completed games found.</div>';
      elPrevGameContent.style.display = "block";
      return;
    }

    const summary = await espnGet(`${api}/summary?event=${finished[0].id}`);
    if (version !== refreshVersion) return;
    renderPrevGame(finished[0], summary);
  } catch (err) {
    if (version !== refreshVersion) return;
    elPrevGameLoading.style.display = "none";
    elPrevGameError.textContent = err.message;
    elPrevGameError.style.display = "block";
    throw err;
  }
}

function renderPrevGame(ev, summary) {
  elPrevCardTitle.textContent = "Last Game";

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

const sportTabs = [...document.querySelectorAll(".sport-tab")];

function selectSport(tab) {
  if (tab.dataset.sport === activeSport) return;
  activeSport = tab.dataset.sport;
  for (const sportTab of sportTabs) {
    const selected = sportTab === tab;
    sportTab.setAttribute("aria-selected", String(selected));
    sportTab.tabIndex = selected ? 0 : -1;
  }
  document.getElementById("sport-title").textContent = SPORTS[activeSport].label;
  document.getElementById("sports-panel").setAttribute("aria-labelledby", tab.id);
  tick();
}

for (const tab of sportTabs) {
  tab.addEventListener("click", () => selectSport(tab));
  tab.addEventListener("keydown", event => {
    let index = sportTabs.indexOf(tab);
    if (event.key === "ArrowRight") index = (index + 1) % sportTabs.length;
    else if (event.key === "ArrowLeft") index = (index - 1 + sportTabs.length) % sportTabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = sportTabs.length - 1;
    else return;
    event.preventDefault();
    sportTabs[index].focus();
    selectSport(sportTabs[index]);
  });
}

// Initial fetch + recurring timer (must be after all declarations)
checkExistingSubscription();
tick();
setInterval(tick, REFRESH_MS);
