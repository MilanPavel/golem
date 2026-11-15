"""The match ladder: strict rungs, no picks, and the nearest lines on a miss."""

from __future__ import annotations

import random

import pytest

from golem.tools.match import Found, Span, find, nearest, reindent


def test_exact_once():
    found = find("a\nfoo()\nb\n", "foo()")
    assert found == Found("exact", (Span(2, 7, "", ""),))


def test_exact_twice_gives_two_spans():
    found = find("x = 1\ny\nx = 1\n", "x = 1")
    assert found is not None and found.rung == "exact"
    assert [(s.start, s.end) for s in found.spans] == [(0, 5), (8, 13)]


def test_not_there():
    assert find("alpha\nbeta\n", "gamma delta") is None


@pytest.mark.parametrize("old", ["", "   ", "\n\t\n"])
def test_blank_old_is_none(old: str):
    assert find("a\n\nb\n", old) is None


def test_trailing_spaces_in_file_only():
    text = "def f():  \n    return 1\t\nnext\n"
    found = find(text, "def f():\n    return 1")
    assert found is not None and found.rung == "trailing_space"
    assert text[found.spans[0].start : found.spans[0].end] == "def f():  \n    return 1\t"


def test_trailing_spaces_in_old_only():
    text = "def f():\n    return 1\nnext\n"
    found = find(text, "def f():   \n    return 1  ")
    assert found is not None and found.rung == "trailing_space"
    assert text[found.spans[0].start : found.spans[0].end] == "def f():\n    return 1"


def test_crlf_file_lf_old():
    text = "one\r\ntwo\r\nthree\r\n"
    found = find(text, "one\ntwo")
    assert found is not None and found.rung == "trailing_space"
    assert text[found.spans[0].start : found.spans[0].end] == "one\r\ntwo"


def test_old_ending_in_newline_takes_the_break():
    text = "one\r\ntwo\r\nthree\r\n"
    found = find(text, "one\ntwo\n")
    assert found is not None
    assert text[found.spans[0].start : found.spans[0].end] == "one\r\ntwo\r\n"


def test_old_indented_4_file_indented_8():
    text = "class A:\n        if x:\n            go()\n"
    found = find(text, "    if x:\n        go()")
    assert found is not None and found.rung == "indent"
    span = found.spans[0]
    assert (span.remove, span.add) == ("    ", "        ")
    assert text[span.start : span.end] == "        if x:\n            go()"


def test_old_not_indented_file_has_tab():
    text = "f:\n\tif x:\n\t\tgo()\n"
    found = find(text, "if x:\n\tgo()")
    assert found is not None and found.rung == "indent"
    span = found.spans[0]
    assert (span.remove, span.add) == ("", "\t")
    assert reindent("if y:\n\tgo()\n", span.remove, span.add) == "\tif y:\n\t\tgo()\n"


def test_mixed_inner_indentation_stays_relative():
    found = find("  aaa\n  \t  bbb\n  ccc\n", "aaa\n\t  bbb\nccc")
    assert found is not None and found.rung == "indent"
    assert found.spans[0].add == "  "


def test_inner_indentation_difference_is_no_match():
    assert find("    a\n        b\n", "a\n    b\n    c") is None
    assert find("    a\n        b\n", "a\n  b") is None


def test_blank_lines_match_blank_lines():
    found = find("  a = 1\n\n  b = 2\n", "a = 1\n\nb = 2")
    assert found is not None and found.rung == "indent"
    assert find("  a = 1\n  x\n  b = 2\n", "a = 1\n\nb = 2") is None


def test_two_windows_on_indent_rung():
    text = "  foo()\n  bar()\nmid\n\tfoo()\n\tbar()\n"
    found = find(text, "    foo()\n    bar()")
    assert found is not None and found.rung == "indent"
    assert [(s.remove, s.add) for s in found.spans] == [("    ", "  "), ("    ", "\t")]
    assert found.spans[0].end <= found.spans[1].start


def test_lone_brace_does_not_fuzzy_match():
    assert find("if x {\n    y\n    }  \n", "}\n") is None
    assert find("a\n  }\n", "\t}") is None


def test_short_lines_never_fuzzy():
    assert find("  ab\n  cd\n", "ab\ncd") is None


def test_reindent_adds():
    assert reindent("a\n  b\n", "", "    ") == "    a\n      b\n"


def test_reindent_removes():
    assert reindent("    a\n      b\n", "    ", "") == "a\n  b\n"


def test_reindent_leaves_blank_lines():
    assert reindent("a\n\n   \nb", "", "\t") == "\ta\n\n   \n\tb"


def test_reindent_keeps_crlf():
    assert reindent("a\r\n  b\r\n", "", "  ") == "  a\r\n    b\r\n"


def test_reindent_line_without_prefix_only_gains():
    assert reindent("  a\nb\n", "    ", "\t") == "\t  a\n\tb\n"


def test_edit_arithmetic_with_found_span():
    text = "x\n    foo()\ny\n"
    found = find(text, "foo()")
    assert found is not None
    span = found.spans[0]
    assert text[: span.start] + "bar()" + text[span.end :] == "x\n    bar()\ny\n"


def test_nearest_one_changed_word():
    text = "import os\n\ndef run(a):\n    total = a + 1\n    return total\n\nprint('x')\n"
    near = nearest(text, "def run(a):\n    total = a + 2\n    return totl")
    assert near is not None
    assert (near.first_line, near.last_line) == (3, 5)
    assert near.text == "def run(a):\n    total = a + 1\n    return total"
    assert 0.5 < near.ratio < 1


def test_nearest_unrelated_is_none():
    assert nearest("alpha beta\ngamma\n", "zzzzzz qqqq\nxxxxxxxx") is None


def test_nearest_edges():
    assert nearest("", "a") is None
    assert nearest("a\n", "a\nb\nc") is None
    assert nearest("a\n", "") is None


def test_nearest_big_file_uses_the_prefilter():
    lines = [f"filler line number {i}" for i in range(6000)]
    lines[4000] = "def compute_total(items):"
    lines[4001] = "    return sum(items)"
    text = "\n".join(lines) + "\n"
    near = nearest(text, "def compute_total(item):\n    return sum(items)")
    assert near is not None and near.first_line == 4001
    assert nearest(text, "zz\nyy") is None


def test_property_a_window_of_the_file_is_found_exactly():
    rng = random.Random(957)
    alphabet = "ab \t{}()x=\n"
    checked = 0
    for _ in range(200):
        text = "".join(rng.choice(alphabet) for _ in range(rng.randint(5, 60)))
        a = rng.randrange(len(text))
        b = rng.randrange(a + 1, len(text) + 1)
        window = text[a:b]
        if not window.strip():
            continue
        found = find(text, window)
        assert found is not None and found.rung == "exact"
        assert all(text[s.start : s.end] == window for s in found.spans)
        checked += 1
    assert checked > 100
