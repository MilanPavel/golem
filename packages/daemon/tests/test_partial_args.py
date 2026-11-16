import json

from golem.graphs.partial_args import partial_field, partial_string


def test_a_complete_object_gives_the_value() -> None:
    text = '{"path": "a.py", "content": "x = 1\\n"}'
    assert partial_string(text, "path") == "a.py"
    assert partial_string(text, "content") == "x = 1\n"


def test_a_key_cut_in_the_middle_has_not_started() -> None:
    assert partial_string('{"pa', "path") is None
    assert partial_string('{"path', "path") is None
    assert partial_string('{"path"', "path") is None
    assert partial_string('{"path":', "path") is None
    assert partial_string('{"path": ', "path") is None


def test_a_value_cut_in_the_middle_comes_back_as_far_as_it_got() -> None:
    assert partial_string('{"path": "src/ma', "path") == "src/ma"
    assert partial_string('{"path": "', "path") == ""


def test_the_flag_says_whether_the_closing_quote_was_seen() -> None:
    assert partial_field('{"path": "src/ma', "path") == ("src/ma", False)
    assert partial_field('{"path": "src/main.py", "con', "path") == ("src/main.py", True)


def test_json_escapes_are_decoded() -> None:
    text = r'{"content": "a\nb \"q\" c\\d é \/ \t"}'
    assert partial_string(text, "content") == 'a\nb "q" c\\d é / \t'


def test_an_escaped_pair_is_decoded() -> None:
    text = '{"content": ' + json.dumps("go \U0001f600 on")
    assert partial_string(text, "content") == "go \U0001f600 on"


def test_a_cut_off_escape_at_the_end_is_dropped() -> None:
    assert partial_string('{"content": "ab\\', "content") == "ab"
    assert partial_string('{"content": "ab\\u00', "content") == "ab"
    assert partial_string('{"content": "ab\\u00e', "content") == "ab"
    assert partial_string('{"content": "ab\\ud83d', "content") == "ab"
    assert partial_string('{"content": "ab\\ud83d\\ude', "content") == "ab"


def test_a_cut_at_every_point_never_fails_and_only_grows() -> None:
    text = json.dumps({"path": "a/b.py", "content": 'line "one"\nline é two \U0001f600'})
    seen = ""
    for end in range(len(text) + 1):
        value = partial_string(text[:end], "content")
        if value is not None:
            assert value.startswith(seen)
            seen = value
    assert seen == 'line "one"\nline é two \U0001f600'


def test_the_key_inside_a_nested_object_is_ignored() -> None:
    text = '{"meta": {"path": "inner"}, "list": [{"path": "x"}], "path": "outer"}'
    assert partial_string(text, "path") == "outer"
    assert partial_string('{"meta": {"path": "inner"}}', "path") is None


def test_a_value_that_holds_the_key_as_text_is_not_a_key() -> None:
    assert partial_string('{"content": "\\"path\\": \\"x\\"", "path": "real"}', "path") == "real"
    assert partial_string('{"content": ", \\"path\\": \\"x\\""}', "path") is None


def test_a_missing_key_or_a_value_that_is_not_a_string_gives_none() -> None:
    assert partial_string('{"a": "b"}', "path") is None
    assert partial_string('{"path": 3}', "path") is None
    assert partial_string("", "path") is None
    assert partial_string("[", "path") is None
