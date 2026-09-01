#!/usr/bin/env bash
set -euo pipefail

MAX_DISTANCE_KM="${MAX_DISTANCE_KM:-25}"
POI_DUMP_PATH="${POI_DUMP_PATH:-/data/POI_data/dump-rurallure_db.sql}"
COUNTRY_BOUNDARIES_PATH="${COUNTRY_BOUNDARIES_PATH:-/data/geoboundaries_adm0.geojson}"
ROUTES_SOURCE_DIR="${ROUTES_SOURCE_DIR:-/data/routes_data/romea_strata_official}"
VIA_FRANCIGENA_SOURCE_DIR="${VIA_FRANCIGENA_SOURCE_DIR:-/data/routes_data/via_francigena_official}"

if docker compose run --rm backend test -f "$COUNTRY_BOUNDARIES_PATH"; then
  COUNTRY_ARGS=(--country-boundaries "$COUNTRY_BOUNDARIES_PATH")
else
  echo "Country boundaries not found at $COUNTRY_BOUNDARIES_PATH; importing without country annotation."
  COUNTRY_ARGS=(--skip-country-annotation)
fi

echo "Importing official Romea Strata routes from $ROUTES_SOURCE_DIR"
docker compose run --rm backend \
  python manage.py rurallure_import_romea_strata_official_with_pois \
  --source-dir "$ROUTES_SOURCE_DIR" \
  --include-variants \
  "${COUNTRY_ARGS[@]}"

if docker compose run --rm backend test -d "$VIA_FRANCIGENA_SOURCE_DIR"; then
  echo "Importing official Via Francigena routes from $VIA_FRANCIGENA_SOURCE_DIR"
  docker compose run --rm backend \
    python manage.py rurallure_import_via_francigena_official \
    --source-dir "$VIA_FRANCIGENA_SOURCE_DIR" \
    --include-variants
else
  echo "Via Francigena source directory not found at $VIA_FRANCIGENA_SOURCE_DIR; skipping."
fi

echo "Importing POIs from $POI_DUMP_PATH within ${MAX_DISTANCE_KM} km of saved itineraries"
docker compose run --rm backend \
  python manage.py import_rurallure_dump_near_itineraries \
  "$POI_DUMP_PATH" \
  --max-distance-km "$MAX_DISTANCE_KM" \
  "${COUNTRY_ARGS[@]}"
