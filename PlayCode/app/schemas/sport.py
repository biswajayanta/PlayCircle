"""
Pydantic models define the *shape* of API responses. FastAPI uses these to:
  1. Validate/serialize what goes out over the wire
  2. Auto-generate the OpenAPI docs at /docs
This is the "shared contract" that stands in for the shared-TypeScript-types
convenience Node would've given us — the frontend can always check /docs
or /openapi.json to see exactly what a Sport object looks like.
"""

from pydantic import BaseModel


class Sport(BaseModel):
    id: int
    code: str
    name: str
    indoor_outdoor: str
    min_players: int
    max_players: int
    scoring_config: dict
    calorie_coefficient: float
    is_active: bool
