#!/bin/bash
set -e

# Azure App Service (Linux, Python) deploys code to /home/site/wwwroot and
# runs this script from there as the container's entrypoint.

echo "Running database migrations..."
python -m alembic upgrade head

echo "Starting server..."
exec gunicorn app.main:app \
    --workers 2 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind=0.0.0.0:8000 \
    --timeout 120
