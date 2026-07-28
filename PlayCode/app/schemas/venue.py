from pydantic import BaseModel


class Venue(BaseModel):
    id: int
    sport_id: int
    name: str
    address: str | None
    city: str | None
    latitude: float | None
    longitude: float | None
    is_active: bool