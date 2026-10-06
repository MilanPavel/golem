# Monorepo

One git repository holds the Python packages and the TypeScript package. uv owns the Python side. pnpm owns the TypeScript side. `just` is the single entry point that runs both. The two sides meet in `packages/protocol/gen`, where Python models are exported as TypeScript types.

## Layout

```
golem/
├─ pyproject.toml          # uv workspace root (not an installable package)
├─ uv.lock                 # one lockfile for every Python package
├─ package.json            # pnpm workspace root
├─ pnpm-lock.yaml          # one lockfile for every Node package
├─ pnpm-workspace.yaml
├─ justfile
└─ packages/
   ├─ protocol/            # Python: golem-protocol
   │  └─ gen/              # generated JSON Schema and TypeScript
   ├─ daemon/              # Python: golem
   └─ tui/                 # TypeScript: @golem/tui
```

Python 3.12 is pinned in `.python-version`. CI installs Node 24.

## Python

The root `pyproject.toml` is a uv workspace. `tool.uv.package` is false, so the root is not built or installed. Its members are `packages/protocol` and `packages/daemon`.

`uv sync --all-packages` creates one `.venv` at the repository root and installs every member into it, editable. `packages/daemon` depends on `golem-protocol` through `tool.uv.sources` with `workspace = true`, so that dependency resolves to the local package.

Each member is a Hatchling project and names its import package explicitly (`golem_protocol`, `golem`). Dev tools live in the root `dev` dependency group, which uv installs by default: pytest, pytest-asyncio, ruff, and pyright. Ruff, pyright, and pytest are configured in the root `pyproject.toml` and apply to both packages. Recipes unset `VIRTUAL_ENV` before calling uv, so an activated virtualenv from another project is ignored and uv uses this repository's `.venv`.

| Package name | Import | Role |
|---|---|---|
| `golem-protocol` | `golem_protocol` | Pydantic models and schema export |
| `golem` | `golem` | Paths, configuration, logging |

## TypeScript

`pnpm-workspace.yaml` includes `packages/tui` only. The root `package.json` is private and sets `packageManager` to `pnpm@10.29.3`. Its only dependency is `json-schema-to-typescript`, used by `just gen`.

`@golem/tui` carries its own TypeScript, ESLint, and `typescript-eslint` devDependencies. Its `tsconfig.json` includes `src/**/*.ts` and `../protocol/gen/**/*.ts`, so the compiler sees the generated types. Imports use the relative path `../../protocol/gen/ping.js` (NodeNext resolves that to `ping.ts`). There is no npm package for the protocol.

## The crossing point

`just gen` runs in this order:

1. `uv run python -m golem_protocol.codegen` writes `packages/protocol/gen/*.schema.json` from the Pydantic models.
2. `pnpm exec json2ts` writes the matching `*.ts` files next to those schemas.

The generated files are committed. `just check` copies `packages/protocol/gen`, runs `just gen`, and diffs the result. A drift fails the check.

## Commands

| Command | What it runs |
|---|---|
| `just` | List the recipes below |
| `uv sync --all-packages` | Install Python packages and the dev group into `.venv` |
| `pnpm install` | Install the root tool and `@golem/tui` |
| `just gen` | Regenerate JSON Schema and TypeScript |
| `just lint` | `ruff check`, `ruff format --check`, `eslint` in `@golem/tui` |
| `just fmt` | `ruff format` and `ruff check --fix` |
| `just typecheck` | `pyright` (strict) and `tsc --noEmit` in `@golem/tui` |
| `just test` | `pytest` |
| `just check` | `gen`, then lint, typecheck, and test; fails if `gen/` drifted |

CI runs `uv sync --all-packages --frozen`, `pnpm install --frozen-lockfile`, then `just check`. Both lockfiles are committed, so CI installs the same versions as a local sync.
