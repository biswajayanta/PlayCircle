from app.scoring.base import ScoringEngine
from app.scoring.pickleball import PickleballEngine

# Add a new sport by writing an engine module and registering it here.
_ENGINES: dict[str, ScoringEngine] = {
    "pickleball": PickleballEngine(),
}


def get_engine(sport_name: str) -> ScoringEngine:
    # Sport names in the database aren't guaranteed to match this registry's
    # casing exactly (e.g. "Pickleball" vs "pickleball") — normalize so that
    # doesn't matter.
    engine = _ENGINES.get(sport_name.strip().lower())
    if engine is None:
        raise ValueError(f"No scoring engine registered for sport '{sport_name}'")
    return engine
