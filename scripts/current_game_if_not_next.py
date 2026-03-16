#!/usr/bin/env python3
"""
Purdue Basketball — Current Game or Next Game Finder.
Checks if Purdue is currently playing; if so, displays the live score.
Otherwise, displays details about the next upcoming game.

Usage:  python current_game_if_not_next.py
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
SUMMARY_URL = f"{ESPN_BASE}/summary"


def espn_get(url: str) -> dict:
    """Fetch JSON from ESPN API."""
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
    year = dt_utc.year
    mar1 = datetime(year, 3, 1, tzinfo=timezone.utc)
    days_to_sun = (6 - mar1.weekday()) % 7
    edt_start = mar1 + timedelta(days=days_to_sun + 7, hours=2)
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


def find_current_or_next_game() -> tuple:
    """
    Search Purdue's schedule for a live game or the next upcoming game.
    Checks regular season, postseason (March Madness), and conference tournament.
    Returns (event_dict, is_live) where is_live indicates an in-progress game.
    """
    events = []
    for season_type in (2, 3, 4):  # regular season, postseason, off-season/conf tourney
        try:
            data = espn_get(f"{SCHEDULE_URL}?seasontype={season_type}")
            events.extend(data.get("events", []))
        except Exception:
            continue

    live_game = None
    upcoming = []

    for event in events:
        date_str = event.get("date", "")
        if not date_str:
            continue

        game_dt = parse_utc(date_str)
        status_name = (
            event.get("competitions", [{}])[0]
            .get("status", {})
            .get("type", {})
            .get("name", "")
        )

        if status_name == "STATUS_FINAL":
            continue

        if status_name in ("STATUS_IN_PROGRESS", "STATUS_HALFTIME"):
            live_game = event
            break

        upcoming.append((game_dt, event))

    if live_game:
        return live_game, True

    if not upcoming:
        return None, False

    upcoming.sort(key=lambda x: x[0])
    return upcoming[0][1], False


def get_live_scores(event_id: str):
    """Fetch live score data from the ESPN summary/event endpoint."""
    data = espn_get(f"{SUMMARY_URL}?event={event_id}")
    header = data.get("header", {})
    comps = header.get("competitions", [])
    if not comps:
        return None

    comp = comps[0]
    status = comp.get("status", {})
    competitors = comp.get("competitors", [])

    purdue = None
    opponent = None
    for c in competitors:
        if str(c.get("team", {}).get("id", "")) == PURDUE_TEAM_ID:
            purdue = c
        else:
            opponent = c

    if not purdue or not opponent:
        return None

    def _parse_record(raw):
        """Extract total record string from header record field."""
        if isinstance(raw, str):
            return raw
        if isinstance(raw, list):
            for r in raw:
                if isinstance(r, dict) and r.get("type") == "total":
                    return r.get("summary", r.get("displayValue", ""))
            if raw and isinstance(raw[0], dict):
                return raw[0].get("summary", raw[0].get("displayValue", ""))
        return ""

    return {
        "purdue_name": purdue.get("team", {}).get("displayName", "Purdue Boilermakers"),
        "purdue_score": purdue.get("score", "0"),
        "purdue_rank": purdue.get("rank", ""),
        "purdue_record": _parse_record(purdue.get("record", "")),
        "purdue_logo": purdue.get("team", {}).get("logos", [{}])[0].get("href", ""),
        "opponent_name": opponent.get("team", {}).get("displayName", "Unknown"),
        "opponent_score": opponent.get("score", "0"),
        "opponent_rank": opponent.get("rank", ""),
        "opponent_record": _parse_record(opponent.get("record", "")),
        "opponent_logo": opponent.get("team", {}).get("logos", [{}])[0].get("href", ""),
        "clock": status.get("displayClock", ""),
        "period": status.get("displayPeriod", ""),
        "status_detail": status.get("type", {}).get("detail", ""),
        "status_name": status.get("type", {}).get("name", ""),
        "status_desc": status.get("type", {}).get("description", ""),
    }


def extract_game_details(event: dict) -> dict:
    """Extract next-game details from a schedule event."""
    game_dt = parse_utc(event.get("date", ""))
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
        return {}

    opp_team = opponent.get("team", {})
    purdue_team = purdue.get("team", {}) if purdue else {}

    home_away = purdue.get("homeAway", "") if purdue else ""
    is_home = home_away == "home"

    venue = competition.get("venue", {})
    venue_name = venue.get("fullName", "")
    venue_city = venue.get("address", {}).get("city", "")
    venue_state = venue.get("address", {}).get("state", "")
    venue_loc = ", ".join(filter(None, [venue_city, venue_state]))

    broadcasts = competition.get("broadcasts", [])
    broadcast_names = []
    for b in broadcasts:
        for name_entry in b.get("names", []):
            broadcast_names.append(name_entry)
    tv_str = ", ".join(broadcast_names) if broadcast_names else "TBD"

    status = competition.get("status", {})
    status_type = status.get("type", {})

    odds_data = competition.get("odds", [])
    spread = ""
    over_under = ""
    if odds_data:
        odds = odds_data[0]
        spread = odds.get("details", "")
        over_under = odds.get("overUnder", "")

    conference_game = competition.get("conferenceCompetition", False)

    opp_records = opponent.get("records", [])
    opp_record = ""
    for rec in opp_records:
        if rec.get("type") == "total":
            opp_record = rec.get("summary", "")
            break
    if not opp_record and opp_records:
        opp_record = opp_records[0].get("summary", "")

    pur_records = purdue.get("records", []) if purdue else []
    pur_record = ""
    for rec in pur_records:
        if rec.get("type") == "total":
            pur_record = rec.get("summary", "")
            break
    if not pur_record and pur_records:
        pur_record = pur_records[0].get("summary", "")

    opp_rank = opponent.get("curatedRank", {}).get("current", 99)
    opp_rank_str = f"#{opp_rank} " if opp_rank and opp_rank <= 25 else ""

    pur_rank = purdue.get("curatedRank", {}).get("current", 99) if purdue else 99
    pur_rank_str = f"#{pur_rank} " if pur_rank and pur_rank <= 25 else ""

    season_type = event.get("seasonType", {}).get("name", "")
    game_notes = competition.get("notes", [])
    note_headline = game_notes[0].get("headline", "") if game_notes else ""

    return {
        "game_name": event.get("name", ""),
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
        "status": status_type.get("name", ""),
        "status_desc": status_type.get("description", ""),
        "season_type": season_type,
        "note": note_headline,
    }


def print_live_game(scores: dict):
    """Print the live game scoreboard."""
    sep = "─" * 52

    print()
    print(f"  {'🏀  PURDUE BASKETBALL — LIVE GAME':^52}")
    print(f"  {sep}")
    print()

    pur_score = scores["purdue_score"]
    opp_score = scores["opponent_score"]

    pur_label = scores["purdue_name"]
    opp_label = scores["opponent_name"]
    if scores["purdue_rank"]:
        pur_label = f"#{scores['purdue_rank']} {pur_label}"
    if scores["opponent_rank"]:
        opp_label = f"#{scores['opponent_rank']} {opp_label}"
    if scores["purdue_record"]:
        pur_label += f" ({scores['purdue_record']})"
    if scores["opponent_record"]:
        opp_label += f" ({scores['opponent_record']})"

    # Determine who's winning
    pur_marker = " ◀" if int(pur_score) >= int(opp_score) else ""
    opp_marker = " ◀" if int(opp_score) > int(pur_score) else ""

    print(f"  {pur_label:<36} {pur_score:>4}{pur_marker}")
    print(f"  {opp_label:<36} {opp_score:>4}{opp_marker}")
    print()

    # Status line
    status_name = scores["status_name"]
    if status_name == "STATUS_HALFTIME":
        print(f"  {'Status:':<14} 🔴 HALFTIME")
    elif status_name == "STATUS_IN_PROGRESS":
        print(f"  {'Status:':<14} 🔴 {scores['status_detail']}")
    elif status_name == "STATUS_END_PERIOD":
        print(f"  {'Status:':<14} 🔴 End of {scores['period']}")
    else:
        print(f"  {'Status:':<14} {scores['status_desc']}")

    print()
    print(f"  {sep}")
    print(f"  {'Boiler Up! 🚂':^52}")
    print()


def print_next_game(game: dict):
    """Print the next upcoming game details."""
    sep = "─" * 52

    print()
    print(f"  {'🏀  PURDUE BASKETBALL — NEXT GAME':^52}")
    print(f"  {sep}")
    print()

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

    if game["note"]:
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


def main():
    event, is_live = find_current_or_next_game()

    if event is None:
        print("No upcoming Purdue basketball games found.")
        sys.exit(0)

    if is_live:
        event_id = event.get("id", "")
        if not event_id:
            # Try competition id
            event_id = event.get("competitions", [{}])[0].get("id", "")
        scores = get_live_scores(event_id)
        if scores:
            print_live_game(scores)
        else:
            # Fallback: show as upcoming if score fetch fails
            game = extract_game_details(event)
            if game:
                print_next_game(game)
            else:
                print("Could not retrieve live game details.")
    else:
        game = extract_game_details(event)
        if game:
            print_next_game(game)
        else:
            print("Could not parse next game details.")


if __name__ == "__main__":
    main()