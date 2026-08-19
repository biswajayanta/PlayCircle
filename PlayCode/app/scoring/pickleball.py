from typing import Any

from app.scoring.base import ScoringEngine


class PickleballEngine(ScoringEngine):
    """Rally scoring within each set (every rally awards a point to
    whoever won it, the modern/casual convention rather than side-out
    scoring), but the match itself is a fixed sequence of sets — not one
    continuous score. Default: best of 3 sets, each to 11, win by 2. All
    num_sets sets are always played out (no early stop once one side has
    a majority), and the match winner is whoever won more sets.

    score['team_1']/['team_2'] represent SETS WON, not raw points — that's
    what determines the match, and it's what report/match-summary code
    generically reads across every sport. Live points within the set
    currently being played live in current_set_team_1/current_set_team_2.
    """

    def __init__(self, points_to_win: int = 11, win_by: int = 2, num_sets: int = 3):
        self.default_points_to_win = points_to_win
        self.default_win_by = win_by
        self.default_num_sets = num_sets

    def initial_score(self, config: dict[str, Any] | None = None) -> dict[str, Any]:
        config = config or {}
        return {
            "config": {
                "points_to_win": config.get("points_to_win", self.default_points_to_win),
                "win_by": config.get("win_by", self.default_win_by),
                "num_sets": config.get("num_sets", self.default_num_sets),
            },
            "sets": [],  # completed sets: [{"team_1":.., "team_2":.., "winner":1|2, "history":[...]}]
            "current_set_history": [],
            "current_set_team_1": 0,
            "current_set_team_2": 0,
            "team_1": 0,  # sets won
            "team_2": 0,  # sets won
        }

    def _default_config(self, score: dict[str, Any]) -> dict[str, Any]:
        return score.get(
            "config",
            {
                "points_to_win": self.default_points_to_win,
                "win_by": self.default_win_by,
                "num_sets": self.default_num_sets,
            },
        )

    def _set_complete(self, t1: int, t2: int, cfg: dict[str, Any]) -> bool:
        return max(t1, t2) >= cfg["points_to_win"] and abs(t1 - t2) >= cfg["win_by"]

    def apply_point(self, score: dict[str, Any], team: int, points: int = 1) -> dict[str, Any]:
        if points != 1:
            raise ValueError("Pickleball scoring is always 1 point per rally")
        if self.is_complete(score):
            raise ValueError("Match is already complete")
        if team not in (1, 2):
            raise ValueError("team must be 1 or 2")

        cfg = self._default_config(score)
        history = list(score.get("current_set_history", [])) + [team]
        t1 = history.count(1)
        t2 = history.count(2)

        sets = [dict(s) for s in score.get("sets", [])]
        sets_won_1 = score.get("team_1", 0)
        sets_won_2 = score.get("team_2", 0)

        if self._set_complete(t1, t2, cfg):
            set_winner = 1 if t1 > t2 else 2
            sets.append({"team_1": t1, "team_2": t2, "winner": set_winner, "history": history})
            if set_winner == 1:
                sets_won_1 += 1
            else:
                sets_won_2 += 1
            # Reset for the next set. If this was the last configured set,
            # is_complete() now reports True and no further points can be
            # applied regardless — this reset is harmless either way.
            history = []
            t1 = t2 = 0

        return {
            "config": cfg,
            "sets": sets,
            "current_set_history": history,
            "current_set_team_1": t1,
            "current_set_team_2": t2,
            "team_1": sets_won_1,
            "team_2": sets_won_2,
        }

    def undo_last_point(self, score: dict[str, Any]) -> dict[str, Any]:
        cfg = self._default_config(score)

        if score.get("current_set_history"):
            history = list(score["current_set_history"])
            history.pop()
            t1 = history.count(1)
            t2 = history.count(2)
            return {
                "config": cfg,
                "sets": score.get("sets", []),
                "current_set_history": history,
                "current_set_team_1": t1,
                "current_set_team_2": t2,
                "team_1": score.get("team_1", 0),
                "team_2": score.get("team_2", 0),
            }

        # Current set is empty — either nothing has happened yet, or we
        # just closed a set and need to reopen it.
        sets = [dict(s) for s in score.get("sets", [])]
        if not sets:
            raise ValueError("No points to undo")

        last_set = sets.pop()
        history = list(last_set["history"])
        history.pop()
        t1 = history.count(1)
        t2 = history.count(2)
        sets_won_1 = score.get("team_1", 0) - (1 if last_set["winner"] == 1 else 0)
        sets_won_2 = score.get("team_2", 0) - (1 if last_set["winner"] == 2 else 0)
        return {
            "config": cfg,
            "sets": sets,
            "current_set_history": history,
            "current_set_team_1": t1,
            "current_set_team_2": t2,
            "team_1": sets_won_1,
            "team_2": sets_won_2,
        }

    def is_complete(self, score: dict[str, Any]) -> bool:
        cfg = self._default_config(score)
        return len(score.get("sets", [])) >= cfg["num_sets"]

    def winner(self, score: dict[str, Any]) -> int | None:
        if not self.is_complete(score):
            return None
        t1 = score.get("team_1", 0)
        t2 = score.get("team_2", 0)
        if t1 == t2:
            return None  # possible only if num_sets is even — shouldn't
            # happen via the app's UI (1/3/5 only), but handled safely
            # rather than assuming a caller always sends an odd number.
        return 1 if t1 > t2 else 2
