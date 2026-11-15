"""The speed book: medians, filters, the cap, and the file."""

from __future__ import annotations

from pathlib import Path

from golem.models.speed import KEEP, SpeedBook

REF = "ollama/qwen3:8b"


def _read(book: SpeedBook, tokens: int, ms: int) -> None:
    book.note(REF, prompt_tokens=tokens, prompt_ms=ms)


def test_a_ref_without_samples_has_no_speed() -> None:
    book = SpeedBook(None)
    assert book.speed(REF) is None
    assert book.first_token_ms(REF, 35_000) is None
    assert book.note(REF) is None


def test_the_figure_is_the_median() -> None:
    book = SpeedBook(None)
    for ms in (1000, 500, 2000):  # 1000, 2000 and 500 tokens per second of 1000 tokens
        _read(book, 1000, ms)
    speed = book.speed(REF)
    assert speed is not None
    assert (speed.prompt_tps, speed.reply_tps, speed.load_ms, speed.samples) == (
        1000.0,
        None,
        None,
        3,
    )
    book.note(REF, reply_tokens=100, reply_ms=2000)
    book.note(REF, reply_tokens=100, reply_ms=1000)
    final = book.speed(REF)
    assert final is not None and final.reply_tps == 75.0


def test_a_cached_prompt_and_a_short_reply_are_not_counted() -> None:
    book = SpeedBook(None)
    book.note(REF, prompt_tokens=199, prompt_ms=100, reply_tokens=19, reply_ms=100)
    book.note(REF, prompt_tokens=5000, prompt_ms=49)
    assert book.speed(REF) is None
    book.note(REF, prompt_tokens=200, prompt_ms=50, reply_tokens=20, reply_ms=500)
    speed = book.speed(REF)
    assert speed is not None
    assert (speed.prompt_tps, speed.reply_tps) == (4000.0, 40.0)


def test_a_warm_load_is_not_counted() -> None:
    book = SpeedBook(None)
    book.note(REF, load_ms=500)
    book.note(REF, load_ms=12)
    assert book.speed(REF) is None
    book.note(REF, load_ms=8000)
    speed = book.speed(REF)
    assert speed is not None and speed.load_ms == 8000


def test_first_token_is_the_worst_case_warm_and_cold() -> None:
    book = SpeedBook(None)
    book.note(REF, prompt_tokens=1000, prompt_ms=500, load_ms=8000)
    assert book.first_token_ms(REF, 35_000) == 17_500
    assert book.first_token_ms(REF, 35_000, cold=True) == 25_500
    only_load = SpeedBook(None)
    only_load.note(REF, load_ms=8000)
    assert only_load.first_token_ms(REF, 1000) is None


def test_only_the_last_twenty_samples_count() -> None:
    book = SpeedBook(None)
    for _ in range(KEEP):
        book.note(REF, reply_tokens=100, reply_ms=1000)  # 100 tok/s
    for _ in range(KEEP):
        book.note(REF, reply_tokens=50, reply_ms=1000)  # 50 tok/s
    speed = book.speed(REF)
    assert speed is not None
    assert (speed.reply_tps, speed.samples) == (50.0, KEEP)


def test_the_book_is_saved_and_loaded(tmp_path: Path) -> None:
    book = SpeedBook(tmp_path / "cache")
    book.note(REF, prompt_tokens=1000, prompt_ms=500, reply_tokens=100, reply_ms=2000)
    book.save()
    again = SpeedBook(tmp_path / "cache")
    assert again.speed(REF) == book.speed(REF)


def test_saving_waits_thirty_seconds_unless_asked(tmp_path: Path) -> None:
    now = [100.0]
    book = SpeedBook(tmp_path, clock=lambda: now[0])
    book.note(REF, reply_tokens=100, reply_ms=1000)  # the first note is written
    book.note(REF, reply_tokens=100, reply_ms=500)
    assert SpeedBook(tmp_path).speed(REF) is not None
    assert SpeedBook(tmp_path).speed(REF).samples == 1  # type: ignore[union-attr]
    now[0] += 31
    book.note(REF, reply_tokens=100, reply_ms=500)
    assert SpeedBook(tmp_path).speed(REF).samples == 3  # type: ignore[union-attr]
    now[0] += 1
    book.note(REF, reply_tokens=100, reply_ms=500)
    book.save()
    assert SpeedBook(tmp_path).speed(REF).samples == 4  # type: ignore[union-attr]


def test_a_broken_file_is_ignored(tmp_path: Path) -> None:
    (tmp_path / "speed.json").write_text("{not json", encoding="utf-8")
    assert SpeedBook(tmp_path).speed(REF) is None
    (tmp_path / "speed.json").write_text('{"a": 1, "b": {"reply_tps": ["x", -1, true]}}')
    assert SpeedBook(tmp_path).speed("b") is None
    (tmp_path / "speed.json").write_text("[1]")
    assert SpeedBook(tmp_path).speed(REF) is None
