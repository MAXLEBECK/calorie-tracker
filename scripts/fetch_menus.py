"""Fetch Traditions at Scott & Morrill menus from Nutrislice and write one small
JSON file per day to data/menus/YYYY-MM-DD.json for the app to load.

Runs nightly in GitHub Actions (see .github/workflows/menus.yml). Standard library only.
"""
import json
import pathlib
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

API = "https://osu.api.nutrislice.com/menu/api"
HALLS = [
    ("scott", "Traditions at Scott", "traditions-at-scott"),
    ("morrill", "Traditions at Morrill", "traditions-at-morrill"),
]
MEAL_ORDER = ["breakfast", "lunch", "dinner"]
DAYS_BACK, DAYS_AHEAD, KEEP_DAYS = 1, 6, 7
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "menus"


def get_json(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fuel-calorie-tracker", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # network hiccup: retry
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed {url}: {last}")


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return 0.0


def serving_text(item, food):
    amount = item.get("serving_size_amount")
    unit = item.get("serving_size_unit")
    if not amount:
        info = food.get("serving_size_info") or {}
        amount, unit = info.get("serving_size_amount"), info.get("serving_size_unit")
    if not amount:
        return ""
    amount = str(amount).strip()
    if amount.endswith(".0"):
        amount = amount[:-2]
    return f"{amount} {unit or ''}".strip()


def parse_day(menu_items):
    """Turn Nutrislice's flat item list into [{name, items:[...]}] grouped by station."""
    stations, current = [], None
    for it in menu_items:
        if it.get("is_station_header") or it.get("is_section_title"):
            current = {"name": (it.get("text") or "").strip() or "Other", "items": [], "_seen": set()}
            stations.append(current)
            continue
        food = it.get("food")
        if not food or not food.get("name"):
            continue
        if current is None:
            current = {"name": "Other", "items": [], "_seen": set()}
            stations.append(current)
        name = food["name"].strip()
        if name.lower() in current["_seen"]:
            continue
        current["_seen"].add(name.lower())
        n = food.get("rounded_nutrition_info") or {}
        per = None
        if n.get("calories") is not None:
            per = {"calories": num(n.get("calories")), "protein": num(n.get("g_protein")),
                   "carbs": num(n.get("g_carbs")), "fat": num(n.get("g_fat"))}
        current["items"].append({"name": name, "serving": serving_text(it, food), "per": per})
    return [{"name": s["name"], "items": s["items"]} for s in stations if s["items"]]


def meal_rank(name):
    low = name.lower()
    for i, word in enumerate(MEAL_ORDER):
        if word in low:
            return i
    return len(MEAL_ORDER)


def main():
    today = datetime.now(ZoneInfo("America/New_York")).date()
    wanted = [today + timedelta(days=d) for d in range(-DAYS_BACK, DAYS_AHEAD + 1)]
    week_starts = sorted({d - timedelta(days=(d.weekday() + 1) % 7) for d in wanted})  # Sundays

    schools = {s["slug"]: s for s in get_json(f"{API}/schools/")}
    # days[date_str][hall_id] -> list of meals
    days = {d.isoformat(): {} for d in wanted}
    failures = 0

    for hall_id, hall_name, slug in HALLS:
        school = schools.get(slug)
        if not school:
            print(f"warning: {slug} not found", file=sys.stderr)
            failures += 1
            continue
        for mt in school.get("active_menu_types", []):
            for ws in week_starts:
                url = f"{API}/weeks/school/{slug}/menu-type/{mt['slug']}/{ws.year}/{ws.month:02d}/{ws.day:02d}/"
                try:
                    week = get_json(url)
                except RuntimeError as e:
                    print(f"warning: {e}", file=sys.stderr)
                    failures += 1
                    continue
                for day in week.get("days", []):
                    if day.get("date") not in days:
                        continue
                    stations = parse_day(day.get("menu_items") or [])
                    if stations:
                        days[day["date"]].setdefault(hall_id, []).append(
                            {"id": mt["slug"], "name": mt["name"], "stations": stations})

    OUT.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(ZoneInfo("America/New_York")).isoformat(timespec="minutes")
    written = 0
    for d, halls in days.items():
        path = OUT / f"{d}.json"
        if not halls:
            continue  # nothing published (or fetch failed): keep any existing file
        if failures and path.exists():
            continue  # partial data this run: don't overwrite a complete earlier file
        out = {"date": d, "generated": generated, "halls": []}
        for hall_id, hall_name, _ in HALLS:
            meals = sorted(halls.get(hall_id, []), key=lambda m: meal_rank(m["name"]))
            if meals:
                out["halls"].append({"id": hall_id, "name": hall_name, "meals": meals})
        path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
        written += 1
        counts = ", ".join(f"{h['id']}:" + "/".join(f"{m['id']}={sum(len(s['items']) for s in m['stations'])}"
                                                      for m in h["meals"]) for h in out["halls"])
        print(f"{d}: {counts}")

    # prune old days
    cutoff = today - timedelta(days=KEEP_DAYS)
    for f in OUT.glob("*.json"):
        try:
            if date.fromisoformat(f.stem) < cutoff:
                f.unlink()
        except ValueError:
            pass

    print(f"wrote {written} day files, {failures} failed fetches")
    if written == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
