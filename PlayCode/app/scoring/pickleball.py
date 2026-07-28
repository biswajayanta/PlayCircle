from typing import Any

from app.scoring.base import ScoringEngine


class PickleballEngine(ScoringEngine):
    """Rally scoring: every rally awards a point to whoever won it, regardless
    of who served (this is the modern/casual convention, distinct from the
    older side-out scoring where only the serving team could score). First to
    11, win by 2."""

    def __init__(self, points_to_win: int = 11, win_by: int = 2):
        self.points_to_win = points_to_win
        self.win_by = win_by

    def initial_score(self) -> dict[str, Any]:
        return {"history": [], "team_1": 0, "team_2": 0}

    def _counts_from_history(self, history: list[int]) -> tuple[int, int]:
        return history.count(1), history.count(2)

    def apply_point(self, score: dict[str, Any], team: int) -> dict[str, Any]:
        if self.is_complete(score):
            raise ValueError("Match is already complete")
        if team not in (1, 2):
            raise ValueError("team must be 1 or 2")

        history = list(score.get("history", [])) + [team]
        t1, t2 = self._counts_from_history(history)
        return {"history": history, "team_1": t1, "team_2": t2}

    def undo_last_point(self, score: dict[str, Any]) -> dict[str, Any]:
        history = list(score.get("history", []))
        if not history:
            raise ValueError("No points to undo")

        history.pop()
        t1, t2 = self._counts_from_history(history)
        return {"history": history, "team_1": t1, "team_2": t2}

    def is_complete(self, score: dict[str, Any]) -> bool:
        t1 = score.get("team_1", 0)
        t2 = score.get("team_2", 0)
        return max(t1, t2) >= self.points_to_win and abs(t1 - t2) >= self.win_by

    def winner(self, score: dict[str, Any]) -> int | None:
        if not self.is_complete(score):
            return None
        return 1 if score.get("team_1", 0) > score.get("team_2", 0) else 2
