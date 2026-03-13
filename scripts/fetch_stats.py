#!/usr/bin/env python3
"""
Braden Smith Career Assist Tracker.
Run anytime — including mid-game — to get his up-to-date career assist total.

Usage:  python fetch_stats.py
"""

import json
import ssl
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

PLAYER_ID = "5105854"  # Braden Smith, Purdue #3
PURDUE_TEAM_ID = "2509"

ESPN_BASE = "https://site.api.espn.com/apis"
ATHLETE_URL = f"{ESPN_BASE}/common/v3/sports/basketball/mens-college-basketball/athletes"
SCOREBOARD_URL = f"{ESPN_BASE}/site/v2/sports/basketball/mens-college-basketball/scoreboard"
SUMMARY_URL = f"{ESPN_BASE}/site/v2/sports/basketball/mens-college-basketball/summary"


def espn_get(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    ctx = None
    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        else:
            raise
    with urlopen(req, timeout=10, context=ctx) as resp:
        return json.loads(resp.read().decode())


def get_career_assists() -> int:
    """
    Calculate career assists accurately:
    - Prior completed seasons: use per-season totals from /stats endpoint (reliable)
    - Current season: sum game-by-game from /gamelog endpoint (real-time, updates mid-game)
    """
    # 1) Get per-season totals from /stats
    stats = espn_get(f"{ATHLETE_URL}/{PLAYER_ID}/stats")
    prior_seasons_ast = 0
    current_season_name = None

    for cat in stats.get("categories", []):
        if "Total" not in cat.get("displayName", ""):
            continue
        labels = cat.get("labels", [])
        if "AST" not in labels:
            continue
        ast_idx = labels.index("AST")
        seasons = cat.get("statistics", [])
        # The last entry is the current/most-recent season
        if seasons:
            current_season_name = seasons[-1].get("season", {}).get("displayName", "")
        # Sum all prior seasons (everything except the last)
        for entry in seasons[:-1]:
            try:
                prior_seasons_ast += int(entry["stats"][ast_idx])
            except (IndexError, ValueError, KeyError):
                pass
        break

    # 2) Get current season assists from gamelog (most up-to-date, includes live games)
    gamelog = espn_get(f"{ATHLETE_URL}/{PLAYER_ID}/gamelog")
    labels = gamelog.get("labels", [])
    col_map = {lbl: i for i, lbl in enumerate(labels)}
    ast_idx = col_map.get("AST")

    current_season_ast = 0
    if ast_idx is not None:
        for st in gamelog.get("seasonTypes", []):
            for cat in st.get("categories", []):
                for event in cat.get("events", []):
                    row = event.get("stats", [])
                    if ast_idx < len(row):
                        try:
                            current_season_ast += int(row[ast_idx])
                        except (ValueError, TypeError):
                            pass

    return prior_seasons_ast + current_season_ast


def get_live_game_assists() -> int:
    """If Purdue has a game currently in progress, return Braden's assists from the live boxscore."""
    scoreboard = espn_get(SCOREBOARD_URL)
    for event in scoreboard.get("events", []):
        status = event.get("status", {}).get("type", {})
        if status.get("state") != "in":
            continue
        for comp in event.get("competitions", []):
            for team in comp.get("competitors", []):
                if team.get("team", {}).get("id") == PURDUE_TEAM_ID:
                    return _assists_from_boxscore(event["id"])
    return 0


def _assists_from_boxscore(game_id: str) -> int:
    summary = espn_get(f"{SUMMARY_URL}?event={game_id}")
    for bp in summary.get("boxscore", {}).get("players", []):
        if bp.get("team", {}).get("id") != PURDUE_TEAM_ID:
            continue
        for stat_set in bp.get("statistics", []):
            labels = stat_set.get("labels", [])
            if "AST" not in labels:
                continue
            ast_idx = labels.index("AST")
            for athlete in stat_set.get("athletes", []):
                if athlete.get("athlete", {}).get("id") == PLAYER_ID:
                    stats = athlete.get("stats", [])
                    if ast_idx < len(stats):
                        try:
                            return int(stats[ast_idx])
                        except (ValueError, TypeError):
                            pass
    return 0


def main():
    career = get_career_assists()
    live = get_live_game_assists()
    total = career + live
    if live:
        print(f"Braden Smith Career Assists: {total}  (includes {live} from live game)")
    else:
        print(f"Braden Smith Career Assists: {total}")


if __name__ == "__main__":
    main()
