"""How much memory this machine has, and whether a local model fits in it.

The fit is an estimate for unified memory on Apple silicon, where the GPU
can use most of RAM. It leaves room for the system, an IDE, and a browser.
"""

from __future__ import annotations

import os
import subprocess
from typing import Literal

Fit = Literal["fits", "tight", "too_big"]

# KV cache for a mid-size model at 16-bit, per 1024 tokens of context.
_KV_GB_PER_1K_TOKENS = 0.06
_DEFAULT_CTX = 8192
_OVERHEAD_GB = 1.0
_FITS_SHARE = 0.5
_TIGHT_SHARE = 0.75


def total_ram_gb() -> float | None:
    """Physical memory in GiB, or None when the OS does not say."""
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
    except (ValueError, OSError, AttributeError):
        pages = page_size = -1
    if pages > 0 and page_size > 0:
        return pages * page_size / 2**30
    try:
        out = subprocess.run(
            ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=2, check=True
        )
        return int(out.stdout.strip()) / 2**30
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def fit(size_gb: float, ram_gb: float, ctx: int | None = None) -> Fit:
    """``fits`` within half of RAM, ``tight`` within three quarters, else ``too_big``."""
    tokens = ctx if ctx is not None and ctx > 0 else _DEFAULT_CTX
    need = size_gb + tokens / 1024 * _KV_GB_PER_1K_TOKENS + _OVERHEAD_GB
    if need <= ram_gb * _FITS_SHARE:
        return "fits"
    if need <= ram_gb * _TIGHT_SHARE:
        return "tight"
    return "too_big"
