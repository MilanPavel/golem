# Notes for coding agents

golem is a Python daemon and a TypeScript terminal app in one repository. [README.md](README.md) says what it is, [docs/architecture.md](docs/architecture.md) how it is built, and [docs/sre.md](docs/sre.md) how it is set up, built, and released. [docs/plan.md](docs/plan.md) lists the next steps.

## Skills

The skills for this repository are in `.agents/skills/`, in the Agent Skills format (`SKILL.md`). `.claude/skills` is a link to the same folder.

| Skill | What it does |
|---|---|
| `setup` | Makes a fresh checkout ready: tools, packages, and git hooks |
| `ship` | Takes local changes to an open pull request that follows the rules in CONTRIBUTING.md |

Skills are thin. They run scripts and `just` recipes, so an agent without skill support can do the same:

- **Setup:** run `scripts/setup.sh`. Ask before running `scripts/setup.sh --install`, which installs tools.
- **Check:** run `just check`. It is what CI runs.
- **Ship:** follow `.agents/skills/ship/SKILL.md` step by step.

## Rules

- Commit messages and PR titles follow [CONTRIBUTING.md](CONTRIBUTING.md). `.githooks/commit-msg` checks them.
- Changes reach `main` only through a pull request, merged by a person.
- After a change to the protocol models, run `just gen` and commit the generated files.
- A non-obvious choice gets an ADR in `docs/adr/`.
