const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(require.resolve("../js/main.js"), "utf8");

function element(id) {
  const classes = new Set();
  return {
    id, style: {}, dataset: {}, attributes: {}, listeners: {},
    textContent: "", innerHTML: "",
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    focus() { this.focused = true; }
  };
}

function event(id, name, state, date, opponent = "Opponent") {
  return {
    id, date,
    competitions: [{
      status: { type: { name, state, completed: name.startsWith("STATUS_FINAL") } },
      competitors: [
        { team: { id: "2509" }, homeAway: "home" },
        { team: { id: "1", displayName: opponent }, homeAway: "away" }
      ]
    }]
  };
}

function summary(ev, purdueScore = "31", opponentScore = "24") {
  const comp = ev.competitions[0];
  return {
    header: {
      competitions: [{
        ...comp,
        competitors: comp.competitors.map((competitor, index) => ({
          ...competitor, score: index ? opponentScore : purdueScore
        }))
      }]
    }
  };
}

function app(respond) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const tabs = ["basketball", "football", "womens-basketball", "volleyball"].map(sport => {
    const tab = get(sport + "-tab");
    tab.dataset.sport = sport;
    return tab;
  });
  const requests = [];
  let interval;
  const context = vm.createContext({
    document: { getElementById: get, querySelectorAll: () => tabs },
    navigator: {}, window: {},
    fetch: async url => {
      requests.push(url);
      const data = await respond(url);
      return { ok: true, json: async () => data };
    },
    setInterval: (callback, ms) => { interval = { callback, ms }; }
  });
  vm.runInContext(source, context);
  return {
    get, tabs, requests,
    tick: () => vm.runInContext("tick()", context),
    interval: () => interval
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("basketball is the default and no athlete stats are requested", async () => {
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Basketball opponent");
  const dashboard = app(() => ({ events: [next] }));
  await flush();
  assert.match(dashboard.get("game-content").innerHTML, /Basketball opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /No completed games/);
  assert.equal(dashboard.requests.length, 3);
  assert.ok(dashboard.requests.every(url => url.includes("basketball") && !url.includes("athletes")));
  assert.equal(dashboard.interval().ms, 45_000);
});

test("football shows its next game and most recent final score including overtime", async () => {
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Football opponent");
  const last = event("last", "STATUS_FINAL_OVERTIME", "post", "2026-10-16T18:00Z", "Last opponent");
  const older = event("older", "STATUS_FINAL", "post", "2026-10-01T18:00Z");
  const canceled = event("canceled", "STATUS_CANCELED", "post", "2026-10-20T18:00Z");
  const dashboard = app(url => url.includes("/summary")
    ? summary(last)
    : { events: url.includes("football") ? [next, older, last, canceled] : [] });
  await flush();
  dashboard.tabs[1].listeners.click();
  await flush();
  assert.equal(dashboard.tabs[1].attributes["aria-selected"], "true");
  assert.equal(dashboard.get("sport-title").textContent, "Football");
  assert.equal(dashboard.get("sports-panel").attributes["aria-labelledby"], "football-tab");
  assert.match(dashboard.get("game-content").innerHTML, /Football opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /Last opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /31/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /24/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /result-badge win/);
  assert.equal(dashboard.requests.filter(url => url.includes("/summary")).length, 1);
  assert.ok(dashboard.requests.some(url => url.includes("football/college-football/summary?event=last")));
});

test("live football becomes the last game on the next refresh", async () => {
  const live = event("live", "STATUS_HALFTIME", "in", "2026-10-31T18:00Z", "Live opponent");
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-07T18:00Z", "Next opponent");
  const dashboard = app(url => url.includes("/summary")
    ? summary(live)
    : { events: url.includes("football") ? [live, next] : [] });
  await flush();
  dashboard.tabs[1].listeners.click();
  await flush();
  assert.equal(dashboard.get("game-card-title").textContent, "Live Game");
  assert.match(dashboard.get("game-content").innerHTML, /Halftime/);
  live.competitions[0].status.type = { name: "STATUS_FINAL", state: "post", completed: true };
  await dashboard.interval().callback();
  assert.equal(dashboard.get("game-card-title").textContent, "Next Game");
  assert.match(dashboard.get("game-content").innerHTML, /Next opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /Live opponent/);
});

test("late football summaries cannot overwrite basketball after switching tabs", async () => {
  const live = event("live", "STATUS_IN_PROGRESS", "in", "2026-10-31T18:00Z", "Football opponent");
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Basketball opponent");
  let resolveSummary;
  const pending = new Promise(resolve => { resolveSummary = resolve; });
  const dashboard = app(url => url.includes("/summary")
    ? pending
    : { events: url.includes("football") ? [live] : [next] });
  await flush();
  dashboard.tabs[1].listeners.click();
  await flush();
  dashboard.tabs[0].listeners.click();
  await flush();
  resolveSummary(summary(live));
  await flush();
  assert.equal(dashboard.get("sport-title").textContent, "Men's Basketball");
  assert.equal(dashboard.get("game-card-title").textContent, "Next Game");
  assert.match(dashboard.get("game-content").innerHTML, /Basketball opponent/);
  assert.doesNotMatch(dashboard.get("game-content").innerHTML, /Football opponent/);
});

test("schedule failures show an error instead of an empty schedule", async () => {
  const dashboard = app(() => { throw new Error("Schedule unavailable"); });
  await flush();
  assert.equal(dashboard.get("status-text").textContent, "Update failed");
  assert.equal(dashboard.get("error-msg").textContent, "Schedule unavailable");
  assert.equal(dashboard.get("error-msg").style.display, "block");
  assert.ok(dashboard.get("pulse").classList.contains("error"));
  assert.equal(dashboard.get("sports-panel").attributes["aria-busy"], "false");
});

test("summary failure is visible while the next game still renders", async () => {
  const last = event("last", "STATUS_FINAL", "post", "2026-10-16T18:00Z");
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Next opponent");
  const dashboard = app(url => {
    if (url.includes("/summary")) throw new Error("Results unavailable");
    return { events: [next, last] };
  });
  await flush();
  assert.match(dashboard.get("game-content").innerHTML, /Next opponent/);
  assert.equal(dashboard.get("prev-game-error").textContent, "Results unavailable");
  assert.equal(dashboard.get("prev-game-error").style.display, "block");
  assert.equal(dashboard.get("status-text").textContent, "Update failed");
});

test("keyboard navigation switches sports and supports Home and End", async () => {
  const dashboard = app(() => ({ events: [] }));
  await flush();
  let prevented = false;
  dashboard.tabs[0].listeners.keydown({
    key: "ArrowRight", preventDefault: () => { prevented = true; }
  });
  await flush();
  assert.ok(prevented);
  assert.ok(dashboard.tabs[1].focused);
  assert.equal(dashboard.tabs[1].tabIndex, 0);
  dashboard.tabs[1].listeners.keydown({ key: "Home", preventDefault() {} });
  await flush();
  assert.equal(dashboard.tabs[0].attributes["aria-selected"], "true");
  dashboard.tabs[0].listeners.keydown({ key: "End", preventDefault() {} });
  await flush();
  assert.equal(dashboard.tabs[3].attributes["aria-selected"], "true");
});

test("women's basketball uses its own schedule and results endpoints", async () => {
  const next = event("women-next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Women's next opponent");
  const last = event("women-last", "STATUS_FINAL", "post", "2026-10-16T18:00Z", "Women's last opponent");
  const dashboard = app(url => url.includes("/summary")
    ? summary(last, "70", "65")
    : { events: url.includes("womens-college-basketball") ? [next, last] : [] });
  await flush();
  dashboard.tabs[2].listeners.click();
  await flush();
  assert.equal(dashboard.get("sport-title").textContent, "Women's Basketball");
  assert.equal(dashboard.get("sports-panel").attributes["aria-labelledby"], "womens-basketball-tab");
  assert.equal(dashboard.tabs[0].attributes["aria-selected"], "false");
  assert.match(dashboard.get("game-content").innerHTML, /Women's next opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /Women's last opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /70/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /65/);
  assert.ok(dashboard.requests.some(url => url.includes("womens-college-basketball/summary?event=women-last")));
});

test("volleyball uses Purdue's ESPN schedule and renders match scores", async () => {
  const next = event("volleyball-next", "STATUS_SCHEDULED", "pre", "2099-11-02T18:00Z", "Volleyball next opponent");
  const last = event("volleyball-last", "STATUS_FINAL", "post", "2026-10-29T23:00Z", "Rutgers");
  const dashboard = app(url => url.includes("/summary")
    ? summary(last, "3", "1")
    : { events: url.includes("womens-college-volleyball") ? [next, last] : [] });
  await flush();
  dashboard.tabs[3].listeners.click();
  await flush();
  assert.equal(dashboard.get("sport-title").textContent, "Volleyball");
  assert.equal(dashboard.get("sports-panel").attributes["aria-labelledby"], "volleyball-tab");
  assert.match(dashboard.get("game-content").innerHTML, /Volleyball next opponent/);
  assert.match(dashboard.get("prev-game-content").innerHTML, /Rutgers/);
  assert.match(dashboard.get("prev-game-content").innerHTML, />3/);
  assert.match(dashboard.get("prev-game-content").innerHTML, />1/);
  assert.ok(dashboard.requests.some(url => url.includes("volleyball/womens-college-volleyball/teams/2509/schedule")));
  assert.ok(dashboard.requests.some(url => url.includes("womens-college-volleyball/summary?event=volleyball-last")));
});

test("unknown kickoff times are marked TBD and canceled games are excluded", async () => {
  const next = event("next", "STATUS_SCHEDULED", "pre", "2099-11-02T00:00Z", "Next opponent");
  next.competitions[0].timeValid = false;
  const canceled = event("canceled", "STATUS_CANCELED", "pre", "2099-11-01T18:00Z", "Canceled opponent");
  const dashboard = app(() => ({ events: [canceled, next] }));
  await flush();
  assert.match(dashboard.get("game-content").innerHTML, /Time TBD/);
  assert.match(dashboard.get("game-content").innerHTML, /November 2, 2099/);
  assert.doesNotMatch(dashboard.get("game-content").innerHTML, /Canceled opponent/);
});
