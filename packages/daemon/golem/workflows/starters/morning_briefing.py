# A golem starter. Every weekday morning it reads your project folders, your logs and your
# feeds, and leaves one short briefing in the Inbox and in ~/.golem/briefings.
# Everything is gathered by plain Python steps; one model call writes the briefing.
# Edit the three lists below, and the schedule in @workflow.
import contextlib
import json
import re
import subprocess
import tomllib
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from golem.workflow import Run, schedule, workflow

PROJECTS: list[str] = []
"""Git folders to report on. The trusted_projects of ~/.golem/config.toml are added."""
LOGS = ["~/.golem/logs/golem.jsonl"]
"""Log files: JSON lines with ts/level/message, or plain text. Only warnings and errors count."""
FEEDS = ["https://hnrss.org/frontpage?points=200"]
"""RSS or Atom feeds."""

TAIL_BYTES = 5_000_000
"""How much of the end of each log is read."""
ITEMS = 8
"""Items kept from each feed."""


def window_now() -> dict[str, str]:
    """Today, and the start of the window: yesterday morning, or Friday morning on a Monday.
    A step, so a run resumed later keeps its own day."""
    now = datetime.now().astimezone()
    since = now - timedelta(hours=72 if now.weekday() == 0 else 24)
    return {"since": since.astimezone(UTC).isoformat(), "day": now.date().isoformat()}


def projects() -> list[str]:
    folders = list(PROJECTS)
    config = Path("~/.golem/config.toml").expanduser()
    with contextlib.suppress(OSError, tomllib.TOMLDecodeError):
        folders += tomllib.loads(config.read_text()).get("trusted_projects", [])
    return list(dict.fromkeys(str(Path(f).expanduser()) for f in folders))


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
    """Warnings and errors in the window, grouped by message, most frequent first."""
    file = Path(path).expanduser()
    try:
        if datetime.fromtimestamp(file.stat().st_mtime, UTC).isoformat() < since:
            return {"log": path, "warnings": 0, "errors": 0, "top": []}
        with file.open("rb") as f:
            f.seek(max(0, file.stat().st_size - TAIL_BYTES))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError as exc:
        return {"log": path, "error": str(exc)}
    seen: dict[tuple[str, str], int] = {}
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
        seen[(level, _shape(message))] = seen.get((level, _shape(message)), 0) + 1
    top = sorted(seen.items(), key=lambda kv: (kv[0][0] != "ERROR", -kv[1]))[:10]
    return {
        "log": path,
        "errors": sum(n for (lvl, _), n in seen.items() if lvl == "ERROR"),
        "warnings": sum(n for (lvl, _), n in seen.items() if lvl == "WARNING"),
        "top": [{"level": lvl, "message": msg, "count": n} for (lvl, msg), n in top],
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


def save(day: str, text: str) -> str:
    folder = Path("~/.golem/briefings").expanduser()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{day}.md"
    path.write_text(text + "\n")
    return str(path)


@workflow(
    trigger=schedule("weekdays 07:30"),
    description=(
        "Every weekday at 07:30, reads your project folders, logs and feeds since yesterday "
        "and leaves one short briefing in the Inbox."
    ),
)
async def morning_briefing(run: Run) -> str:
    window = await run.step("window", window_now)
    since, day = window["since"], window["day"]
    folders = await run.step("projects", projects)
    found = await run.parallel(
        [run.step(f"project {f}", scan_project, f, since) for f in folders]
        + [run.step(f"log {p}", scan_log, p, since) for p in LOGS]
        + [run.step(f"feed {u}", read_feed, u, since) for u in FEEDS]
    )

    brief = await run.llm(
        "Write my morning briefing from these facts, gathered since "
        f"{since[:16].replace('T', ' ')} UTC. Start with 'Needs you': at most three things to "
        "act on, such as errors in a log, work not committed or not pushed, a feed or folder "
        "that could not be read. Write 'Nothing' if there are none. Then one short section "
        "each for Projects, Logs and Reading (feed items as links). Skip a section with "
        "nothing in it. Short lines, no filler, only the facts below.\n\n"
        + json.dumps(found, indent=1)[:40_000],
        model="cheapest",
        key="brief",
    )
    path = await run.step("save", save, day, brief, key=f"save {day}")
    await run.notify(f"{brief}\n\nSaved to {path}", title=f"Morning briefing, {day}")
    return brief
