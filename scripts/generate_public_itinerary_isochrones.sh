#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python backend/manage.py generate_itinerary_isochrones \
  --minutes "${ISOCHRONE_MINUTES:-10,20,30}" \
  --sample-distance-meters "${ISOCHRONE_SAMPLE_DISTANCE_METERS:-1000}" \
  --batch-size "${ISOCHRONE_BATCH_SIZE:-5}" \
  "$@"
