from typing import Any

from app.scoring.base import ScoringEngine


class CarromEngine(ScoringEngine):
    """Point race: first team to reach the target score wins outright, no
    win-by-margin requirement (unlike pickleball's rally scoring). Casual
    play commonly races to 25 — configurable here since serious/tournament
    carrom sometimes uses other targets."""

    def __init__(self, points_to_win: int = 25):
        self.points_to_win = points_to_win

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
        return max(t1, t2) >= self.points_to_win

    def winner(self, score: dict[str, Any]) -> int | None:
        if not self.is_complete(score):
            return None
        return 1 if score.get("team_1", 0) > score.get("team_2", 0) else 2
