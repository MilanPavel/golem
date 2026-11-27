"""Checking a workflow file without importing it or asking a model (3.11.1, #1867)."""

from __future__ import annotations

from golem.workflows.check import TRIGGER_UNUSED, CheckEnv, Problem, check

HEAD = "from golem.workflow import workflow, Run, schedule, on_file\n\n\n"


def _flow(body: str, deco: str = "@workflow()") -> str:
    indented = "".join(f"    {line}\n" for line in body.splitlines())
    return f"{HEAD}{deco}\nasync def flow(run: Run):\n{indented}"


AGENTS = {"explorer": "cheapest", "worker": "same", "advisor": "frontier"}


def _env(*, local_only: bool = False, paid: tuple[str, ...] = ("stronger", "frontier")) -> CheckEnv:
    return CheckEnv(
        agents=lambda folder: AGENTS,
        local_only=lambda folder: local_only,
        tier_of_wish=lambda wish, local: "cloud" if wish in paid else "local",
    )


def _errors(problems: list[Problem]) -> Problem:
    """The one error among the problems; the trigger= note is checked on its own."""
    return _one([p for p in problems if p.severity == "error"])


def _one(problems: list[Problem]) -> Problem:
    assert len(problems) == 1, problems
    return problems[0]


def test_a_clean_file_has_no_problems() -> None:
    code = _flow(
        'await run.agent("explorer", "look", model="cheapest", budget="$0.50")\n'
        'await run.llm("hi", model="local")\n'
        'await run.notify("done")'
    )
    assert check(code, "/p", _env()) == []


def test_a_syntax_error_is_an_error_on_its_line() -> None:
    found = _one(check("x = 1\ndef (:\n"))
    assert (found.severity, found.line) == ("error", 2)


def test_an_unknown_keyword_is_an_error_with_the_close_name_as_fix() -> None:
    code = _flow('await run.agent("explorer", "look", modle="local")')
    found = _one(check(code, "/p", _env()))
    assert found.severity == "error" and "no argument modle=" in found.message
    assert found.fix == "model="
    assert found.line == 6 and found.step_id is not None


def test_a_tool_takes_any_keyword() -> None:
    assert check(_flow('await run.tool("read_file", path="a")')) == []


def test_unknown_run_method_is_an_error() -> None:
    found = _one(check(_flow("await run.fly()")))
    assert "run has no fly" in found.message


def test_budget_must_be_money_text() -> None:
    bad = _one(check(_flow('await run.agent("explorer", "x", budget="lots")'), "/p", _env()))
    assert bad.severity == "error" and bad.fix == '"$0.50"'
    zero = _one(check(_flow('await run.agent("explorer", "x", budget="$0")'), "/p", _env()))
    assert "more than $0" in zero.message
    assert check(_flow('await run.agent("explorer", "x", budget="$1.5")'), "/p", _env()) == []


def test_a_model_name_is_an_error_a_wish_is_not() -> None:
    found = _one(check(_flow('await run.llm("hi", model="gpt-5")')))
    assert found.severity == "error" and "do not name models" in found.message
    assert check(_flow('await run.llm("hi", model="stronger")')) == []


def test_unknown_agent_lists_the_known_ones() -> None:
    found = _one(check(_flow('await run.agent("explorr", "x")'), "/p", _env()))
    assert found.severity == "error"
    assert "explorer, worker, advisor" in found.message
    assert found.fix == "explorer"


def test_agent_checks_are_skipped_without_a_registry() -> None:
    assert check(_flow('await run.agent("whatever", "x")')) == []


def test_a_paid_wish_in_a_local_only_folder_is_a_warning() -> None:
    code = _flow('await run.llm("hi", model="stronger")')
    found = _one(check(code, "/p", _env(local_only=True)))
    assert found.severity == "warning" and "would stop at this step" in found.message
    assert found.step_id is not None


def test_a_paid_wish_in_a_cloud_folder_is_fine() -> None:
    code = _flow('await run.llm("hi", model="stronger")')
    assert check(code, "/p", _env(local_only=False)) == []


def test_a_local_wish_in_a_local_only_folder_is_fine() -> None:
    code = _flow('await run.llm("hi", model="local")')
    assert check(code, "/p", _env(local_only=True)) == []


def test_an_agent_with_a_paid_own_wish_warns_in_a_local_only_folder() -> None:
    code = _flow('await run.agent("advisor", "x")')
    assert _one(check(code, "/p", _env(local_only=True))).severity == "warning"
    assert check(code, "/p", _env(local_only=False)) == []


def test_a_wish_that_cannot_resolve_is_a_warning() -> None:
    def broken(wish: str, local: bool) -> str | None:
        raise RuntimeError("no model")

    env = CheckEnv(tier_of_wish=broken)
    found = _one(check(_flow('await run.llm("hi", model="local")'), "/p", env))
    assert found.severity == "warning" and "does not resolve" in found.message


def test_triggers() -> None:
    bad = _errors(check(_flow("pass", '@workflow(trigger=schedule("whenever"))')))
    assert bad.severity == "error" and bad.step_id is None
    empty = _errors(check(_flow("pass", '@workflow(trigger=on_file(""))')))
    assert "on_file" in empty.message
    watch = _errors(check(_flow("pass", '@workflow(trigger=watch("a.txt"))')))
    assert watch.fix == "on_file"


def test_trigger_is_not_used_and_says_so_on_its_line() -> None:
    code = _flow("pass", '@workflow(trigger=schedule("weekly mon 06:00"))')
    found = _one(check(code))
    assert found.severity == "warning" and found.step_id is None
    assert found.message == TRIGGER_UNUSED
    assert "trigger=" in code.splitlines()[found.line - 1]
    assert check(_flow("pass", "@workflow")) == []


def test_check_never_imports_the_file() -> None:
    code = "raise SystemExit(3)\n" + _flow('await run.notify("x")')
    assert check(code) == []
