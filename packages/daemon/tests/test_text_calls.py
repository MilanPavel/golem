"""Tool calls written as text: recovered whole, for offered tools only."""

from __future__ import annotations

from golem.graphs.text_calls import recover, recover_json
from golem.tools import default_registry

SCHEMAS = default_registry().schemas()

READ = (
    "Now I'll look at the README.md file to understand what this project is about:\n\n"
    "<function=read_file>\n<parameter=path>\nREADME.md\n</parameter>\n</function>\n</tool_call>"
)
LIST = "…structure.\n\n<function=list_dir>\n</function>\n</tool_call>"


def _calls(text: str) -> list[tuple[str, dict[str, object]]] | None:
    found = recover(text, SCHEMAS)
    return None if found is None else [(c["name"], c["args"]) for c in found[1]]


def test_a_call_with_a_parameter_is_recovered() -> None:
    found = recover(READ, SCHEMAS)
    assert found is not None
    text, calls = found
    assert text == "Now I'll look at the README.md file to understand what this project is about:"
    assert [(c["name"], c["args"]) for c in calls] == [("read_file", {"path": "README.md"})]
    assert calls[0]["id"] is not None and calls[0]["id"].startswith("c_")


def test_a_call_without_parameters_is_recovered() -> None:
    found = recover(LIST, SCHEMAS)
    assert found is not None
    assert found[0] == "…structure."
    assert _calls(LIST) == [("list_dir", {})]


def test_the_tool_call_tags_are_optional_on_both_sides() -> None:
    body = "<function=read_file>\n<parameter=path>\na.txt\n</parameter>\n</function>"
    expected = [("read_file", {"path": "a.txt"})]
    assert _calls(body) == expected
    assert _calls(f"<tool_call>\n{body}\n</tool_call>") == expected
    assert _calls(f"<tool_call>\n{body}") == expected
    assert _calls(f"{body}\n</tool_call>") == expected
    found = recover(f"<tool_call>\n{body}\n</tool_call>", SCHEMAS)
    assert found is not None and found[0] == ""


def test_two_calls_in_one_reply() -> None:
    first = "<function=read_file>\n<parameter=path>\nREADME.md\n</parameter>\n</function>"
    text = f"First.\n\n{first}\n\n<tool_call>\n<function=list_dir>\n</function>\n</tool_call>"
    found = recover(text, SCHEMAS)
    assert found is not None
    assert found[0] == "First."
    assert [c["name"] for c in found[1]] == ["read_file", "list_dir"]
    assert found[1][0]["id"] != found[1][1]["id"]


def test_an_array_value_is_read_as_json() -> None:
    text = (
        "<function=todo_write>\n<parameter=todos>\n"
        '[{"id":"1","status":"in_progress","text":"Explore"}]\n'
        "</parameter>\n</function>\n</tool_call>"
    )
    assert _calls(text) == [
        ("todo_write", {"todos": [{"id": "1", "status": "in_progress", "text": "Explore"}]})
    ]


def test_an_integer_value_is_read_as_json() -> None:
    text = (
        "<function=read_file>\n<parameter=path>\na.txt\n</parameter>\n"
        "<parameter=limit>\n50\n</parameter>\n</function>"
    )
    assert _calls(text) == [("read_file", {"path": "a.txt", "limit": 50})]


def test_an_optional_integer_is_read_as_json() -> None:
    text = (
        "<function=shell>\n<parameter=command>\nls\n</parameter>\n"
        "<parameter=timeout_seconds>\n30\n</parameter>\n</function>"
    )
    assert _calls(text) == [("shell", {"command": "ls", "timeout_seconds": 30})]


def test_an_optional_string_stays_text() -> None:
    text = (
        "<function=grep>\n<parameter=pattern>\nTODO\n</parameter>\n"
        "<parameter=include>\n123\n</parameter>\n</function>"
    )
    assert _calls(text) == [("grep", {"pattern": "TODO", "include": "123"})]


def test_a_string_value_that_looks_like_json_stays_text() -> None:
    text = "<function=read_file>\n<parameter=path>\n123\n</parameter>\n</function>"
    assert _calls(text) == [("read_file", {"path": "123"})]


def test_an_unknown_tool_recovers_nothing() -> None:
    assert recover("<function=format_disk>\n</function>", SCHEMAS) is None


def test_an_unknown_key_recovers_nothing() -> None:
    text = "<function=read_file>\n<parameter=file>\na.txt\n</parameter>\n</function>"
    assert recover(text, SCHEMAS) is None


def test_a_bad_json_value_recovers_nothing() -> None:
    text = (
        "<function=read_file>\n<parameter=path>\na.txt\n</parameter>\n"
        "<parameter=limit>\nmany\n</parameter>\n</function>"
    )
    assert recover(text, SCHEMAS) is None


def test_one_bad_block_recovers_none_of_the_reply() -> None:
    assert recover(f"{READ}\n<function=format_disk>\n</function>", SCHEMAS) is None


def test_an_unclosed_block_recovers_nothing() -> None:
    assert recover("<function=list_dir>\n", SCHEMAS) is None
    assert recover("<function=read_file>\n<parameter=path>\na.txt\n</function>", SCHEMAS) is None


def test_text_without_markup_recovers_nothing() -> None:
    assert recover("The README explains the project.", SCHEMAS) is None
    assert recover("", SCHEMAS) is None


def test_no_offered_tools_recovers_nothing() -> None:
    assert recover(LIST, []) is None


READ_JSON = '{"name": "read_file", "parameters": {"path": "a.txt"}}'
FENCE = "`" * 3


def _json(text: str) -> list[tuple[str, dict[str, object]]] | str | None:
    found = recover_json(text, SCHEMAS)
    if found is None or isinstance(found, str):
        return found
    return [(c["name"], c["args"]) for c in found]


def test_the_function_shape_is_recovered() -> None:
    text = '{"type":"function","function":{"name":"read_file","parameters":{"path":"a.txt"}}}'
    assert _json(text) == [("read_file", {"path": "a.txt"})]


def test_the_name_and_parameters_shape_is_recovered() -> None:
    assert _json(READ_JSON) == [("read_file", {"path": "a.txt"})]
    found = recover_json(READ_JSON, SCHEMAS)
    assert isinstance(found, list) and found[0]["id"]


def test_the_name_and_arguments_shape_is_recovered() -> None:
    assert _json('{"name": "list_dir", "arguments": {}}') == [("list_dir", {})]


def test_a_fenced_call_is_recovered() -> None:
    assert _json(f"{FENCE}json\n{READ_JSON}\n{FENCE}\n") == [("read_file", {"path": "a.txt"})]


def test_two_objects_in_a_row_are_two_calls() -> None:
    text = f'{READ_JSON}\n{{"name": "list_dir", "parameters": {{}}}}'
    assert _json(text) == [("read_file", {"path": "a.txt"}), ("list_dir", {})]


def test_arguments_as_a_string_are_parsed() -> None:
    text = '{"name": "read_file", "arguments": "{\\"path\\": \\"a.txt\\"}"}'
    assert _json(text) == [("read_file", {"path": "a.txt"})]


def test_a_json_call_to_an_unknown_tool_is_unreadable() -> None:
    assert _json('{"name": "format_disk", "parameters": {}}') == "unread"


def test_a_json_call_with_an_unknown_key_is_unreadable() -> None:
    assert _json('{"name": "read_file", "parameters": {"file": "a.txt"}}') == "unread"


def test_one_bad_json_call_makes_the_whole_reply_unreadable() -> None:
    assert _json(f'{READ_JSON}\n{{"name": "format_disk", "parameters": {{}}}}') == "unread"


def test_json_that_is_not_a_call_is_no_call() -> None:
    assert _json('{"answer": 42}') is None
    assert _json('{"name": "read_file"}') is None
    assert _json('[{"name": "read_file", "parameters": {}}]') is None
    assert _json("42") is None
    assert _json("") is None


def test_prose_with_json_inside_is_no_call() -> None:
    assert _json(f"I will call it now: {READ_JSON}") is None
    assert _json(f"{READ_JSON}\nThat reads the file.") is None
    assert _json(f"{FENCE}json\n{READ_JSON}\n{FENCE}\nDone.") is None


def test_a_call_that_leaves_out_its_last_braces_is_read() -> None:
    text = '{"type":"function","function":{"name":"read_file","parameters":{"path":"a.txt"}}'
    assert _json(text) == [("read_file", {"path": "a.txt"})]
    assert _json('{"name": "read_file", "parameters": {"path": "a.txt"') == [
        ("read_file", {"path": "a.txt"})
    ]


def test_a_call_cut_in_the_middle_is_unreadable() -> None:
    assert _json('{"type":"function","function":{"name":"read_file","parameters":{"pa') == "unread"
    assert _json('{"name": "read_file", "parameters": {"path": ') == "unread"


def test_broken_json_that_does_not_open_like_a_call_is_no_call() -> None:
    assert _json('{"answer": 42') is None
