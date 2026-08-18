from typing import Any

from app.scoring.base import ScoringEngine


class CarromEngine(ScoringEngine):
    """Board-by-board scoring, not rally scoring: each call to apply_point
    represents one completed board, awarding that board's winning team
    however many points they scored on it (varies board to board — coins
    plus a covered queen, etc.), not a flat +1 the way pickleball works.

    A match ends when either team reaches points_to_win, OR when max_boards
    have been played, whichever comes first. If the board limit is reached
    with scores still tied, the match ends in a draw rather than continuing
    indefinitely — there's no "win by 2" style tiebreak for Carrom boards.

    Defaults (points_to_win=25, max_boards=None i.e. unlimited) apply when
    a match is started without per-match overrides; core.sports.scoring_config
    supplies the sport-wide default, and MatchCreate can override it per match.
    """

    def __init__(self, points_to_win: int = 25):
        self.default_points_to_win = points_to_win

    def initial_score(self, config: dict[str, Any] | None = None) -> dict[str, Any]:
        config = config or {}
        return {
            "config": {
                "points_to_win": config.get("points_to_win", self.default_points_to_win),
                "max_boards": config.get("max_boards"),  # None = unlimited
            },
            "history": [],  # list of {"team": 1|2, "points": int}, one per board
            "team_1": 0,
            "team_2": 0,
            "boards_played": 0,
        }

    def apply_point(self, score: dict[str, Any], team: int, points: int = 1) -> dict[str, Any]:
        if self.is_complete(score):
            raise ValueError("Match is already complete")
        if team not in (1, 2):
            raise ValueError("team must be 1 or 2")
        if points < 1:
            raise ValueError("A board's points must be at least 1")

        cfg = score.get("config", {"points_to_win": self.default_points_to_win, "max_boards": None})
        history = list(score.get("history", [])) + [{"team": team, "points": points}]
        t1 = score.get("team_1", 0) + (points if team == 1 else 0)
        t2 = score.get("team_2", 0) + (points if team == 2 else 0)
        return {
            "config": cfg,
            "history": history,
            "team_1": t1,
            "team_2": t2,
            "boards_played": score.get("boards_played", 0) + 1,
        }

    def undo_last_point(self, score: dict[str, Any]) -> dict[str, Any]:
        history = list(score.get("history", []))
        if not history:
            raise ValueError("No boards to undo")

        last = history.pop()
        t1 = score.get("team_1", 0) - (last["points"] if last["team"] == 1 else 0)
        t2 = score.get("team_2", 0) - (last["points"] if last["team"] == 2 else 0)
        return {
            "config": score.get("config", {"points_to_win": self.default_points_to_win, "max_boards": None}),
            "history": history,
            "team_1": t1,
            "team_2": t2,
            "boards_played": max(0, score.get("boards_played", 0) - 1),
        }

    def is_complete(self, score: dict[str, Any]) -> bool:
        cfg = score.get("config", {"points_to_win": self.default_points_to_win, "max_boards": None})
        t1 = score.get("team_1", 0)
        t2 = score.get("team_2", 0)
        if max(t1, t2) >= cfg["points_to_win"]:
            return True
        max_boards = cfg.get("max_boards")
        if max_boards is not None and score.get("boards_played", 0) >= max_boards:
            return True
        return False

    def winner(self, score: dict[str, Any]) -> int | None:
        if not self.is_complete(score):
            return None
        t1 = score.get("team_1", 0)
        t2 = score.get("team_2", 0)
        if t1 == t2:
            return None  # draw — board limit reached with scores tied
        return 1 if t1 > t2 else 2
