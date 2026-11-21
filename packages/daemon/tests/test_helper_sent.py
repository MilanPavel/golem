"""What the paid question of a helper says is sent (ADR-059, section 5): a pure function."""

from __future__ import annotations

from pathlib import Path

from golem.sessions.helpers import LINE_MAX, LINES_MAX, PATHS_SHOWN, paths_in, what_is_sent
from golem_protocol.events import AgentSnapshot


def _agent(*tools: str) -> AgentSnapshot:
    return AgentSnapshot(name="reviewer", source="bundled", tools=list(tools), wish="same")


def _tree(root: Path, count: int = 1) -> None:
    for number in range(count):
        (root / f"m{number}.py").write_text("x = 1\n", encoding="utf-8")


def test_two_existing_files_and_one_that_does_not_exist(tmp_path: Path) -> None:
    _tree(tmp_path, 2)
    sent, not_sent = what_is_sent(
        _agent("read_file"), "Check m0.py and m1.py, then ghost.py.", str(tmp_path)
    )
    assert sent == (
        "the brief, 6 words",
        "the instructions of the reviewer agent",
        "named in the brief: m0.py",
        "named in the brief: m1.py",
        "what it reads with its tools, as it works",
    )
    assert not_sent == ("this chat", "your memory")


def test_a_long_brief_is_counted_in_words(tmp_path: Path) -> None:
    sent, _ = what_is_sent(_agent(), " ".join(["word"] * 212), str(tmp_path))
    assert sent[0] == "the brief, 212 words"


def test_many_paths_are_capped_with_a_count(tmp_path: Path) -> None:
    _tree(tmp_path, 9)
    brief = " ".join(f"m{n}.py" for n in range(9))
    sent, _ = what_is_sent(_agent("grep"), brief, str(tmp_path))
    assert sum(line.startswith("named in the brief") for line in sent) == PATHS_SHOWN
    assert "and 5 more paths named in the brief" in sent
    assert len(sent) <= LINES_MAX


def test_a_long_path_is_cut_in_the_middle_and_every_line_fits(tmp_path: Path) -> None:
    deep = tmp_path.joinpath(*["d" * 30] * 6)
    deep.mkdir(parents=True)
    (deep / "f.py").write_text("", encoding="utf-8")
    name = "/".join(["d" * 30] * 6) + "/f.py"
    sent, not_sent = what_is_sent(_agent("read_file"), f"see {name}", str(tmp_path))
    long_line = next(line for line in sent if line.startswith("named in the brief"))
    assert "…" in long_line and long_line.endswith("f.py")
    assert all(len(line) <= LINE_MAX for line in (*sent, *not_sent))


def test_no_reading_tools_no_line_about_them(tmp_path: Path) -> None:
    sent, _ = what_is_sent(_agent(), "look", str(tmp_path))
    assert not any("tools" in line for line in sent)
    sent, _ = what_is_sent(_agent("write_file"), "look", str(tmp_path))
    assert not any("tools" in line for line in sent)


def test_paths_outside_the_folder_or_without_a_folder_are_not_named(tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (tmp_path / "secret.txt").write_text("", encoding="utf-8")
    assert paths_in("read ../secret.txt", str(root)) == []
    assert paths_in("read m0.py", None) == []
    assert paths_in("a.b is the end.", str(root)) == []
