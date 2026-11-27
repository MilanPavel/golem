# A golem starter: your morning briefing.
# It reads the project folders, log files and feeds you list below, and leaves one short
# briefing in the Inbox and a copy in ~/.golem/briefings. It reads only what you list.
#
# BEFORE YOU RUN IT, fill in the three lists below: PROJECTS (git folders), LOGS (log files)
# and FEEDS (RSS or Atom addresses). A list you leave empty is skipped, and the briefing says
# at the end what it could not cover.
# To run it every morning, add a routine for it in Routines.
import json
import os
import re
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from golem.workflow import Run, workflow

PROJECTS: list[str] = []
"""Git folders to report on, for example ["~/code/app"]. Fill this in."""
LOGS = ["~/.golem/logs/golem.jsonl"]
"""Log files: JSON lines with ts/level/message, or plain text. Only warnings and errors count."""
FEEDS = ["https://hnrss.org/frontpage?points=200"]
"""RSS or Atom feeds."""

TAIL_BYTES = 5_000_000
"""How much of the end of each log is read."""
ITEMS = 8
"""Items kept from each feed."""
LOG_LINES = 8
"""Real lines kept from each log, errors first."""


def window_now() -> dict[str, str]:
    """Today, and the start of the window: yesterday morning, or Friday morning on a Monday.
    A step, so a run resumed later keeps its own day."""
    now = datetime.now().astimezone()
    since = now - timedelta(hours=72 if now.weekday() == 0 else 24)
    return {"since": since.astimezone(UTC).isoformat(), "day": now.date().isoformat()}


def listed(entries: list[str], what: str) -> list[str] | str:
    """The entries of one list at the top of the file, ~ opened, without repeats. An empty list
    gives the note "No <what> listed" instead of an empty list."""
    found = [os.path.expanduser(e) if e.startswith("~") else e for e in entries if e.strip()]
    found = list(dict.fromkeys(found))
    return found if found else f"No {what} listed"


def rows(found: list[str] | str) -> list[str]:
    """The entries of a listed() result: none when it is the note."""
    return [] if isinstance(found, str) else found


def git(folder: str, *args: str) -> str:
    done = subprocess.run(
        ["git", "-C", folder, *args], capture_output=True, text=True, timeout=30, check=False
    )
    return done.stdout.strip() if done.returncode == 0 else ""


def scan_project(folder: str, since: str) -> dict[str, Any]:
    """Commits in the window, the branch, files not committed, commits not pushed."""
    if not git(folder, "rev-parse", "--git-dir"):
        return {"folder": folder, "error": "not a git folder"}
    commits = git(folder, "log", "--all", f"--since={since}", "--pretty=%h %an: %s", "-n", "30")
    changed = git(folder, "status", "--porcelain")
    ahead = git(folder, "rev-list", "--count", "@{u}..HEAD")
    return {
        "folder": folder,
        "branch": git(folder, "branch", "--show-current"),
        "commits": commits.splitlines(),
        "uncommitted": len(changed.splitlines()),
        "unpushed": int(ahead) if ahead.isdigit() else None,
    }


def _shape(message: str) -> str:
    """The message with numbers and ids blanked, so repeats count as one."""
    return re.sub(r"[0-9a-f]{8,}|\d+", "#", message)[:200]


def scan_log(path: str, since: str) -> dict[str, Any]:
    """Warnings and errors in the window: the last real lines (errors first), and the messages
    grouped by shape with one real example each, most frequent first."""
    file = Path(path).expanduser()
    try:
        if datetime.fromtimestamp(file.stat().st_mtime, UTC).isoformat() < since:
            return {"log": path, "warnings": 0, "errors": 0, "lines": [], "top": []}
        with file.open("rb") as f:
            f.seek(max(0, file.stat().st_size - TAIL_BYTES))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError as exc:
        return {"log": path, "error": str(exc)}
    seen: dict[tuple[str, str], list[Any]] = {}
    last: dict[str, list[str]] = {"ERROR": [], "WARNING": []}
    for line in lines:
        try:
            row = json.loads(line)
            level, message = str(row.get("level", "")).upper(), str(row.get("message", ""))
            if str(row.get("ts", "")) < since:
                continue
        except (ValueError, AttributeError):
            found = re.search(r"\b(ERROR|CRITICAL|FATAL|WARN(?:ING)?|Traceback)\b", line)
            if found is None:
                continue
            level, message = found.group(1).upper(), line.strip()
        if level.startswith("WARN"):
            level = "WARNING"
        elif level != "WARNING":
            if level not in ("ERROR", "CRITICAL", "FATAL", "TRACEBACK"):
                continue
            level = "ERROR"
        entry = seen.setdefault((level, _shape(message)), [0, ""])
        entry[0] += 1
        entry[1] = message[:300]
        last[level].append(f"{level} {message[:300]}")
    errors = last["ERROR"][-LOG_LINES:]
    warnings = last["WARNING"][-(LOG_LINES - len(errors)) :] if len(errors) < LOG_LINES else []
    top = sorted(seen.items(), key=lambda kv: (kv[0][0] != "ERROR", -kv[1][0]))[:10]
    return {
        "log": path,
        "errors": sum(e[0] for (lvl, _), e in seen.items() if lvl == "ERROR"),
        "warnings": sum(e[0] for (lvl, _), e in seen.items() if lvl == "WARNING"),
        "lines": errors + warnings,
        "top": [
            {"level": lvl, "message": msg, "count": e[0], "example": e[1]} for (lvl, msg), e in top
        ],
    }


def _when(text: str | None) -> str | None:
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).astimezone(UTC).isoformat()
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC).isoformat()
        except ValueError:
            return None


def read_feed(url: str, since: str) -> dict[str, Any]:
    """The feed's new items: title, link and date. A feed that cannot be read says why."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "golem-briefing"})
        with urllib.request.urlopen(request, timeout=20) as answer:
            root = ET.fromstring(answer.read())
    except (OSError, ET.ParseError) as exc:
        return {"feed": url, "error": str(exc)}
    atom = "{http://www.w3.org/2005/Atom}"
    items: list[dict[str, Any]] = []
    for node in root.iter():
        if node.tag == "item":
            link, date = node.findtext("link"), node.findtext("pubDate")
        elif node.tag == f"{atom}entry":
            found = node.find(f"{atom}link")
            link = None if found is None else found.get("href")
            date = node.findtext(f"{atom}updated") or node.findtext(f"{atom}published")
        else:
            continue
        title = node.findtext("title") or node.findtext(f"{atom}title") or ""
        when = _when(date)
        if when is None or when >= since:
            items.append({"title": title.strip(), "link": link, "date": when})
    return {"feed": url, "items": items[:ITEMS]}


def count_up(found: list[dict[str, Any]]) -> str:
    """One line for the run's list: what the facts add up to."""
    errors = sum(f.get("errors", 0) for f in found)
    saving = sum(1 for f in found if f.get("unpushed") or f.get("uncommitted"))
    reading = sum(len(f.get("items", [])) for f in found)
    return (
        f"{errors} error{'s' if errors != 1 else ''} in the logs, "
        f"{saving} project{'s' if saving != 1 else ''} with work to save, "
        f"{reading} new item{'s' if reading != 1 else ''} to read"
    )


def add_not_covered(brief: str, missing: list[str]) -> str:
    """The briefing with a closing line that says which parts had nothing listed."""
    if not missing:
        return brief.strip()
    what = ", ".join(missing)
    return f"{brief.strip()}\n\nNot covered: {what}. Fill in the lists at the top of the file."


def save(day: str, text: str) -> str:
    folder = Path("~/.golem/briefings").expanduser()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{day}.md"
    path.write_text(text + "\n")
    return str(path)


BRIEF = (
    "Write my morning briefing as markdown from the facts below. Start with a '## Needs you' "
    "section: at most three bullets about things to act on, such as errors in a log, work not "
    "committed or not pushed, a feed or folder that could not be read; write 'Nothing' if "
    "there are none. Then short sections '## Projects', '## Logs' and '## Reading'. In Logs, "
    "name the real errors, using the example and the last lines. In Reading, give each item as "
    "a markdown link. Skip a section with nothing in it. Short lines, no filler, only the "
    "facts below.\n\n"
)


@workflow(
    title="Morning briefing",
    description=(
        "Reads the project folders, logs and feeds you list since yesterday and leaves one "
        "short briefing in the Inbox."
    ),
)
async def morning_briefing(run: Run) -> str:
    window = await run.step("Work out the time window", window_now)
    since, day = window["since"], window["day"]
    folders = await run.step("List your project folders", listed, PROJECTS, "project folders")
    logs = await run.step("List your log files", listed, LOGS, "log files")
    feeds = await run.step("List your feeds", listed, FEEDS, "feeds")
    missing = [
        f"no {what} listed"
        for found, what in ((folders, "project folders"), (logs, "log files"), (feeds, "feeds"))
        if isinstance(found, str)
    ]
    found = await run.parallel(
        [run.step("Scan a project", scan_project, f, since, item=f) for f in rows(folders)]
        + [run.step("Scan a log", scan_log, p, since, item=p) for p in rows(logs)]
        + [run.step("Read a feed", read_feed, u, since, item=u) for u in rows(feeds)],
        title="Gather the facts",
    )
    brief = await run.llm(
        BRIEF
        + f"Facts gathered since {since[:16].replace('T', ' ')} UTC:\n"
        + json.dumps(found, indent=1)[:40_000],
        key="brief",
        title="Write the briefing",
    )
    brief = await run.step("Say what could not be covered", add_not_covered, brief, missing)
    summary = await run.step("Count what was found", count_up, found)
    path = await run.step("Save it as a file", save, day, brief, key=f"save {day}")
    await run.output(brief, title=f"Morning briefing, {day}", summary=summary)
    await run.output(path, title="Saved copy")
    await run.notify(f"{brief}\n\nSaved to {path}", title="Morning briefing")
    return brief
