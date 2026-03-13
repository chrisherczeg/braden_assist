#!/usr/bin/env python3
"""
Purdue Basketball — Next Game Finder.
Fetches Purdue's schedule from ESPN and displays details about the next upcoming game.

Usage:  python next_purdue_basketball_game.py
"""

import json
import ssl
import sys
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

PURDUE_TEAM_ID = "2509"

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
SCHEDULE_URL = f"{ESPN_BASE}/teams/{PURDUE_TEAM_ID}/schedule"
SCOREBOARD_URL = f"{ESPN_BASE}/scoreboard"


def espn_get(url: str) -> dict:
    """Fetch JSON from ESPN API (mirrors fetch_stats.py pattern)."""
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


def parse_utc(date_str: str) -> datetime:
    """Parse ESPN's UTC date string (e.g. '2026-03-15T23:00Z')."""
    date_str = date_str.replace("Z", "+00:00")
    return datetime.fromisoformat(date_str)


def format_eastern(dt_utc: datetime) -> str:
    """Convert UTC datetime to Eastern Time string (handles EST/EDT naively)."""
    # Determine EST (-5) vs EDT (-4) — EDT is roughly Mar second Sun to Nov first Sun
    year = dt_utc.year
    # Approximate EDT start: second Sunday of March
    mar1 = datetime(year, 3, 1, tzinfo=timezone.utc)
    days_to_sun = (6 - mar1.weekday()) % 7
    edt_start = mar1 + timedelta(days=days_to_sun + 7, hours=2)
    # Approximate EDT end: first Sunday of November
    nov1 = datetime(year, 11, 1, tzinfo=timezone.utc)
    days_to_sun = (6 - nov1.weekday()) % 7
    edt_end = nov1 + timedelta(days=days_to_sun, hours=2)

    if edt_start <= dt_utc < edt_end:
        eastern = dt_utc + timedelta(hours=-4)
        tz_label = "EDT"
    else:
        eastern = dt_utc + timedelta(hours=-5)
        tz_label = "EST"

    return eastern.strftime(f"%A, %B %-d, %Y at %-I:%M %p {tz_label}")


def get_next_game() -> dict | None:
    """
    Find Purdue's next upcoming game from ESPN schedule API.
    Returns a dict with game details, or None if no future game found.
    """
    data = espn_get(SCHEDULE_URL)
    now_utc = datetime.now(timezone.utc)

    events = data.get("events", [])
    upcoming = []

    for event in events:
        date_str = event.get("date", "")
        if not date_str:
            continue

        game_dt = parse_utc(date_str)

        # Include games that haven't finished yet (in progress or upcoming)
        status_type = (
            event.get("competitions", [{}])[0]
            .get("status", {})
            .get("type", {})
            .get("name", "")
        )

        if status_type == "STATUS_FINAL":
            continue

        # For games in the past that aren't final (i.e., in progress), include them
        # For future games, include them
        upcoming.append((game_dt, event))

    if not upcoming:
        return None

    # Sort by date and pick the earliest
    upcoming.sort(key=lambda x: x[0])
    game_dt, event = upcoming[0]

    # Extract details
    competition = event.get("competitions", [{}])[0]
    competitors = competition.get("competitors", [])

    purdue = None
    opponent = None
    for team in competitors:
        team_info = team.get("team", {})
        if str(team_info.get("id", "")) == PURDUE_TEAM_ID:
            purdue = team
        else:
            opponent = team

    if not opponent:
        return None

    opp_team = opponent.get("team", {})
    purdue_team = purdue.get("team", {}) if purdue else {}

    # Home / Away
    home_away = purdue.get("homeAway", "") if purdue else ""
    is_home = home_away == "home"

    # Location / Venue
    venue = competition.get("venue", {})
    venue_name = venue.get("fullName", "")
    venue_city = venue.get("address", {}).get("city", "")
    venue_state = venue.get("address", {}).get("state", "")
    venue_loc = ", ".join(filter(None, [venue_city, venue_state]))

    # Broadcast info
    broadcasts = competition.get("broadcasts", [])
    broadcast_names = []
    for b in broadcasts:
        for name_entry in b.get("names", []):
            broadcast_names.append(name_entry)
    tv_str = ", ".join(broadcast_names) if broadcast_names else "TBD"

    # Status details
    status = competition.get("status", {})
    status_type = status.get("type", {})
    status_name = status_type.get("name", "")
    status_desc = status_type.get("description", "")
    status_detail = status.get("displayClock", "")

    # Odds / spread
    odds_data = competition.get("odds", [{}])
    spread = ""
    over_under = ""
    if odds_data:
        odds = odds_data[0] if odds_data else {}
        spread = odds.get("details", "")
        over_under = odds.get("overUnder", "")

    # Conference game?
    conference_game = competition.get("conferenceCompetition", False)

    # Opponent record
    opp_records = opponent.get("records", [])
    opp_record = ""
    for rec in opp_records:
        if rec.get("type") == "total":
            opp_record = rec.get("summary", "")
            break
    if not opp_record and opp_records:
        opp_record = opp_records[0].get("summary", "")

    # Purdue record
    pur_records = purdue.get("records", []) if purdue else []
    pur_record = ""
    for rec in pur_records:
        if rec.get("type") == "total":
            pur_record = rec.get("summary", "")
            break
    if not pur_record and pur_records:
        pur_record = pur_records[0].get("summary", "")

    # Opponent ranking
    opp_rank = opponent.get("curatedRank", {}).get("current", 99)
    opp_rank_str = f"#{opp_rank} " if opp_rank and opp_rank <= 25 else ""

    # Purdue ranking
    pur_rank = purdue.get("curatedRank", {}).get("current", 99) if purdue else 99
    pur_rank_str = f"#{pur_rank} " if pur_rank and pur_rank <= 25 else ""

    # Season type (regular season, postseason, etc.)
    season_type = event.get("seasonType", {}).get("name", "")

    # Game name (e.g., tournament round name)
    game_name = event.get("name", "")
    game_notes = competition.get("notes", [])
    note_headline = ""
    if game_notes:
        note_headline = game_notes[0].get("headline", "")

    return {
        "game_name": game_name,
        "date_utc": game_dt,
        "date_eastern": format_eastern(game_dt),
        "opponent_name": opp_team.get("displayName", opp_team.get("shortDisplayName", "Unknown")),
        "opponent_abbrev": opp_team.get("abbreviation", ""),
        "opponent_record": opp_record,
        "opponent_rank": opp_rank_str,
        "opponent_logo": opp_team.get("logos", [{}])[0].get("href", "") if opp_team.get("logos") else "",
        "purdue_record": pur_record,
        "purdue_rank": pur_rank_str,
        "is_home": is_home,
        "home_away": "Home" if is_home else "Away",
        "neutral_site": competition.get("neutralSite", False),
        "venue": venue_name,
        "venue_location": venue_loc,
        "tv": tv_str,
        "spread": spread,
        "over_under": over_under,
        "conference_game": conference_game,
        "status": status_name,
        "status_desc": status_desc,
        "season_type": season_type,
        "note": note_headline,
    }


def main():
    game = get_next_game()
    if not game:
        print("No upcoming Purdue basketball games found.")
        sys.exit(0)

    sep = "─" * 52

    print()
    print(f"  {'🏀  PURDUE BASKETBALL — NEXT GAME':^52}")
    print(f"  {sep}")
    print()

    # Matchup
    pur_str = f"{game['purdue_rank']}Purdue"
    opp_str = f"{game['opponent_rank']}{game['opponent_name']}"
    if game["purdue_record"]:
        pur_str += f" ({game['purdue_record']})"
    if game["opponent_record"]:
        opp_str += f" ({game['opponent_record']})"

    if game["is_home"]:
        print(f"  {'Matchup:':<14} {opp_str}")
        print(f"  {'':<14} {'at'} {pur_str}")
    else:
        print(f"  {'Matchup:':<14} {pur_str}")
        print(f"  {'':<14} {'at'} {opp_str}")

    print()
    print(f"  {'Date/Time:':<14} {game['date_eastern']}")

    if game["status"] == "STATUS_IN_PROGRESS":
        print(f"  {'Status:':<14} 🔴 LIVE — {game['status_desc']}")
    elif game["status"] == "STATUS_HALFTIME":
        print(f"  {'Status:':<14} 🔴 HALFTIME")
    elif game["note"]:
        print(f"  {'Round:':<14} {game['note']}")

    if game["season_type"]:
        print(f"  {'Season:':<14} {game['season_type']}")

    if game["neutral_site"]:
        print(f"  {'Site:':<14} Neutral Site")
    else:
        print(f"  {'Site:':<14} {game['home_away']}")

    if game["venue"]:
        venue_str = game["venue"]
        if game["venue_location"]:
            venue_str += f" — {game['venue_location']}"
        print(f"  {'Venue:':<14} {venue_str}")

    print(f"  {'TV:':<14} {game['tv']}")

    if game["conference_game"]:
        print(f"  {'Conference:':<14} Big Ten")

    if game["spread"]:
        line = game["spread"]
        if game["over_under"]:
            line += f"  |  O/U: {game['over_under']}"
        print(f"  {'Line:':<14} {line}")

    print()
    print(f"  {sep}")
    print(f"  {'Boiler Up! 🚂':^52}")
    print()


if __name__ == "__main__":
    main()
