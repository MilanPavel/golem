# -*- mode: python ; coding: utf-8 -*-
"""One-folder PyInstaller build of the golem daemon.

Run from the repository: ``just dist``. ``golem/_build.py`` must already exist
so the frozen binary reports the git tag.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

daemon_root = Path(SPECPATH)

hidden = ["golem._build"]
packages = [
    "langchain_core",
    "langchain_anthropic",
    "langchain_ollama",
    "langchain_openai",
    "langgraph",
    "langgraph.checkpoint.sqlite",
    "pydantic",
]
if sys.platform == "darwin":
    packages.append("keyring.backends.macOS")
for package in packages:
    hidden += collect_submodules(package)

datas = collect_data_files("golem.models")
for distribution in (
    "golem",
    "golem-protocol",
    "langchain-core",
    "langchain-anthropic",
    "langchain-ollama",
    "langchain-openai",
    "langgraph",
    "langgraph-checkpoint",
    "langgraph-checkpoint-sqlite",
    "langsmith",
    "pydantic",
    "pydantic-settings",
    "keyring",
    "openai",
):
    datas += copy_metadata(distribution)

a = Analysis(
    [str(daemon_root / "golem" / "__main__.py")],
    pathex=[str(daemon_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "pyinstaller"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="golem-daemon",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="golem-daemon",
)
