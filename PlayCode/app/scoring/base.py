from abc import ABC, abstractmethod
from typing import Any


class ScoringEngine(ABC):
    """
    Common interface every sport's scoring engine implements. Adding a new
    sport means writing a new subclass and registering it in registry.py —
    nothing else in the app needs to change.

    Score state is stored as a plain JSON-serializable dict in
    social.matches.score. The only convention imposed here is a "history"
    list of team numbers (one entry per point scored, in order), which makes
    undo trivial and correct: replay history minus the last point.
    """

    @abstractmethod
    def initial_score(self) -> dict[str, Any]:
        """The score dict for a freshly started match."""
        ...

    @abstractmethod
    def apply_point(self, score: dict[str, Any], team: int) -> dict[str, Any]:
        """Return a new score dict with one point awarded to `team`.
        Must not mutate the input dict. Should raise ValueError if the match
        is already complete (no more points can be scored)."""
        ...

    @abstractmethod
    def undo_last_point(self, score: dict[str, Any]) -> dict[str, Any]:
        """Return a new score dict with the most recent point removed.
        Should raise ValueError if there's no history to undo."""
        ...

    @abstractmethod
    def is_complete(self, score: dict[str, Any]) -> bool:
        """Whether the match has been won under this sport's rules."""
        ...

    @abstractmethod
    def winner(self, score: dict[str, Any]) -> int | None:
        """1 or 2 if the match is complete and has a winner, else None."""
        ...
