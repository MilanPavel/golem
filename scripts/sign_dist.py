#!/usr/bin/env python3
"""Sign every Mach-O file in a built tree with one identity, or check that it is.

Standard library only. ``just dist`` runs ``sign`` on every build, and the
release runs ``check`` on the unpacked archive. ``bun build --compile`` leaves
``bin/golem`` with a signature that no longer matches it, so even a local build
is signed again, ad-hoc.

The identity is ``GOLEM_SIGN_IDENTITY``: a certificate name or its SHA-1 hash
in the keychain search list, or ``-`` (the default) for ad-hoc.
``GOLEM_SIGN_KEYCHAIN`` narrows the search to one keychain. The designated
requirement of a self-signed or Developer ID signature is the
identifier plus the certificate, so it is the same for every build: the
Keychain keeps trusting a daemon after an upgrade. An ad-hoc signature (``-``)
is a hash of the file, so it changes with every build.

There is no hardened runtime yet. It is needed only for notarization, and
with a certificate that has no team, library validation would refuse
PyInstaller's libraries.

    sign_dist.py sign <tree>
    sign_dist.py check <tree> [--identity-hash <sha1>]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# The two executables, with the identifier each signature carries.
EXECUTABLES = {
    Path("libexec/golem-daemon/golem-daemon"): "dev.golem.daemon",
    Path("bin/golem"): "dev.golem.cli",
}
_MACH_O = {
    b"\xcf\xfa\xed\xfe",  # 64-bit, little endian
    b"\xce\xfa\xed\xfe",  # 32-bit, little endian
    b"\xca\xfe\xba\xbe",  # universal
    b"\xbe\xba\xfe\xca",
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="sign_dist.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sign_cmd = sub.add_parser("sign", help="sign the tree with GOLEM_SIGN_IDENTITY, or ad-hoc")
    sign_cmd.add_argument("tree", type=Path)
    check_cmd = sub.add_parser("check", help="verify every signature in the tree")
    check_cmd.add_argument("tree", type=Path)
    check_cmd.add_argument(
        "--identity-hash",
        help="fail unless the executables are signed by the certificate with this SHA-1",
    )
    args = parser.parse_args(argv)
    tree: Path = args.tree.resolve()
    missing = [str(path) for path in EXECUTABLES if not (tree / path).is_file()]
    if missing:
        print(f"not a built tree, missing {', '.join(missing)}: {tree}", file=sys.stderr)
        return 1
    if args.command == "sign":
        identity = os.environ.get("GOLEM_SIGN_IDENTITY", "").strip() or "-"
        sign(tree, identity, os.environ.get("GOLEM_SIGN_KEYCHAIN", "").strip() or None)
    return check(tree, args.identity_hash if args.command == "check" else None)


def sign(tree: Path, identity: str, keychain: str | None) -> None:
    """Libraries first, then the executables, so each outer signature is the last change."""
    executables = {tree / path: identifier for path, identifier in EXECUTABLES.items()}
    libraries = [path for path in mach_o_files(tree) if path not in executables]
    for path in sorted(libraries, key=lambda item: (-len(item.parts), str(item))):
        _codesign(path, identity, keychain, None)
    for path, identifier in executables.items():
        _codesign(path, identity, keychain, identifier)
    shown = "ad-hoc" if identity == "-" else identity
    print(f"signed {len(libraries) + len(executables)} files, {shown}")


def check(tree: Path, identity_hash: str | None) -> int:
    """Every Mach-O file verifies, and each executable carries its identifier."""
    failed = 0
    for path in mach_o_files(tree):
        result = _run(["codesign", "--verify", "--strict", str(path)])
        if result.returncode != 0:
            print(f"{path.relative_to(tree)}: {result.stderr.strip()}", file=sys.stderr)
            failed += 1
    for relative, identifier in EXECUTABLES.items():
        details = _run(["codesign", "--display", "--verbose=2", "-r-", str(tree / relative)])
        text = details.stdout + details.stderr
        if f"Identifier={identifier}" not in text:
            print(f"{relative}: identifier is not {identifier}", file=sys.stderr)
            failed += 1
        if identity_hash and f'certificate leaf = h"{identity_hash}"'.lower() not in text.lower():
            print(f"{relative}: not signed by certificate {identity_hash}", file=sys.stderr)
            failed += 1
        authority = next(
            (line.split("=", 1)[1] for line in text.splitlines() if line.startswith("Authority=")),
            "ad-hoc",
        )
        print(f"{relative}: {identifier}, {authority}")
    if failed:
        print(f"{failed} signature problems", file=sys.stderr)
        return 1
    return 0


def mach_o_files(tree: Path) -> list[Path]:
    found: list[Path] = []
    for directory, _dirs, files in os.walk(tree):
        for name in files:
            path = Path(directory, name)
            if path.is_symlink():
                continue
            with path.open("rb") as handle:
                if handle.read(4) in _MACH_O:
                    found.append(path)
    return found


def _codesign(path: Path, identity: str, keychain: str | None, identifier: str | None) -> None:
    command = ["codesign", "--force", "--timestamp=none", "--sign", identity]
    if keychain is not None:
        command += ["--keychain", keychain]
    if identifier is not None:
        command += ["--identifier", identifier]
    result = _run([*command, str(path)])
    if result.returncode != 0:
        raise SystemExit(f"codesign failed for {path}: {result.stderr.strip()}")


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
