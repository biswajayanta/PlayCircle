"""
A health check endpoint is the first thing worth having in any API —
it's what a load balancer, a deploy pipeline, or you-at-2am pings to
answer "is this thing actually up?" before debugging anything deeper.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {"status": "ok"}
