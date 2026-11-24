"""Small filesystem helpers shared by services (downloads, characters)."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def remove_quietly(path: Path) -> None:
    """Delete a file if it exists; a failure is logged, never raised (cleanup paths must not mask errors)."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not delete %s", path, exc_info=True)
