# Data Import Scripts

This directory contains helpers for downloading the deployment datasets and importing route and POI data into SmartWays. Run the shell scripts from the repository root.

## Prepare Import Data

The helper script downloads these shared Google Drive files when local ZIPs are not already present:

- `POI_data.zip`
- `routes_data.zip`
- `geoboundaries_adm0.geojson`

Run:

```bash
./scripts/download_deployment_data.sh
```

This prepares:

```text
docker-data/POI_data/
docker-data/routes_data/
docker-data/geoboundaries_adm0.geojson
```

If the geoBoundaries file is missing, the provided import helper falls back to `--skip-country-annotation`.
The running backend also uses this file for live country lookup in the POI editor. Docker sets:

```text
COUNTRY_BOUNDARIES_PATH=/data/geoboundaries_adm0.geojson
```

If you deploy with a different mount path, update `COUNTRY_BOUNDARIES_PATH` accordingly.

On Docker startup, the backend imports the full-resolution boundary polygons into PostGIS when the
`pois_countryboundary` table is empty. Country lookup and map-bound calculations then use indexed
spatial database queries; web workers never load the 383 MB GeoJSON file. To rerun the import after
replacing the source file:

```bash
docker compose run --rm backend python manage.py import_country_boundaries \
  /data/geoboundaries_adm0.geojson
docker compose restart backend
```

Set `AUTO_IMPORT_COUNTRY_BOUNDARIES=0` only when boundary loading is managed separately.

## Import Deployment Data

The recommended import pipeline uses the most developed importers, in this order:

1. `rurallure_import_romea_strata_official_with_pois`
   Imports official Romea Strata GPX routes, creates itineraries from `<trkpt>` geometry, creates and links POIs from `<wpt>` elements, bootstraps categories, annotates countries, and merges GPX waypoint POIs up to 1.5 m apart.
2. `rurallure_import_via_francigena_official`
   Imports official Via Francigena GPX paths as one route with numbered itineraries. These GPX files are path-only in the current dataset, so no POIs or categories are created.
3. `import_rurallure_dump_near_itineraries`
   Imports RurAllure dump POIs near the itineraries created in the previous steps, discards placeholder first-title `...` entries, merges duplicate dump POIs into existing Romea Strata POIs, and imports the remaining nearby POIs with translations, categories, media, and country codes.

`MAX_DISTANCE_KM` defaults to `25`.

Run:

```bash
./scripts/import_deployment_data.sh
```

Override the POI distance threshold:

```bash
MAX_DISTANCE_KM=10 ./scripts/import_deployment_data.sh
```

Override paths if your ZIP extraction layout differs:

```bash
ROUTES_SOURCE_DIR=/data/routes_data/romea_strata_official \
VIA_FRANCIGENA_SOURCE_DIR=/data/routes_data/via_francigena_official \
POI_DUMP_PATH=/data/POI_data/dump-rurallure_db.sql \
COUNTRY_BOUNDARIES_PATH=/data/geoboundaries_adm0.geojson \
MAX_DISTANCE_KM=25 \
./scripts/import_deployment_data.sh
```

The helper imports Via Francigena only when `VIA_FRANCIGENA_SOURCE_DIR` exists in the backend container, so deployments with only the Romea Strata data keep working.

You can also run individual commands manually:

```bash
docker compose run --rm backend \
  python manage.py rurallure_import_romea_strata_official_with_pois \
  --source-dir /data/routes_data/romea_strata_official \
  --country-boundaries /data/geoboundaries_adm0.geojson \
  --include-variants

docker compose run --rm backend \
  python manage.py rurallure_import_via_francigena_official \
  --source-dir /data/routes_data/via_francigena_official \
  --include-variants

docker compose run --rm backend \
  python manage.py import_rurallure_dump_near_itineraries \
  /data/POI_data/dump-rurallure_db.sql \
  --country-boundaries /data/geoboundaries_adm0.geojson \
  --max-distance-km 25
```

## Importing POIs

### Recommended Import

For the current official GPX + RurAllure workflow, prefer the most developed importers and run them in
sequence:

1. Bootstrap routes, itineraries, and POIs from the official Romea Strata GPX files:

   ```bash
   cd backend
   python manage.py rurallure_import_romea_strata_official_with_pois \
     --source-dir /path/to/routes_data/romea_strata_official \
     --country-boundaries /path/to/geoboundaries_adm0.geojson \
     --include-variants
   ```

2. Import the official Via Francigena GPX files as route geometry:

   ```bash
   python manage.py rurallure_import_via_francigena_official \
     --source-dir /path/to/routes_data/via_francigena_official \
     --include-variants
   ```

3. Import RurAllure dump POIs near the itineraries created in steps 1 and 2:

   ```bash
   python manage.py import_rurallure_dump_near_itineraries \
     /path/to/dump-rurallure_db.sql \
     --country-boundaries /path/to/geoboundaries_adm0.geojson \
     --max-distance-km 25
   ```

Use dry runs before writing data:

```bash
python manage.py rurallure_import_romea_strata_official_with_pois \
  --source-dir /path/to/routes_data/romea_strata_official \
  --country-boundaries /path/to/geoboundaries_adm0.geojson \
  --include-variants \
  --dry-run \
  --language-report

python manage.py rurallure_import_via_francigena_official \
  --source-dir /path/to/routes_data/via_francigena_official \
  --include-variants \
  --dry-run

python manage.py import_rurallure_dump_near_itineraries \
  /path/to/dump-rurallure_db.sql \
  --country-boundaries /path/to/geoboundaries_adm0.geojson \
  --max-distance-km 25 \
  --dry-run
```

The Romea Strata GPX dry run reports route/stage counts, raw GPX waypoint count, unique waypoint POIs
after exact deduplication, unique waypoint POIs after the 1.5 m merge, distinct category labels,
country-boundary configuration, potential duplicate waypoint POI pairs within 2 m, 5 m, and 10 m, and
language-detection confidence/examples when `--language-report` is present. Override the duplicate
threshold report with `--poi-duplicate-distance-meters 2,5,10`.

The Via Francigena GPX dry run reports route/stage counts and skips waypoint/category import because the
official source files currently contain only path geometry.

The RurAllure near-itineraries dry run reports table counts after distance filtering, POIs matching the
itinerary-distance range, POIs skipped by the distance filter, existing-POI proximity counts at 2 m, 5 m,
and 10 m, discarded first-title `...` dump POIs, automatic metadata merges within 10 m, curated
beyond-10 m metadata merges, and any remaining potential coincidences within the largest configured
proximity threshold. Override the proximity report thresholds with `--existing-poi-distance-meters 2,5,10`.

Important options:

```bash
# Romea Strata GPX bootstrap importer
--source-dir /path/to/routes_data/romea_strata_official
--include-variants
--replace
--clear-pois
--poi-fallback-language it
--language-report
--country-boundaries /path/to/geoboundaries_adm0.geojson
--skip-country-annotation
--poi-duplicate-distance-meters 2,5,10
--dry-run

# Via Francigena official GPX path importer
--source-dir /path/to/routes_data/via_francigena_official
--include-variants
--replace
--dry-run

# RurAllure dump near-itineraries importer
--min-distance-km 0
--max-distance-km 25
--country-boundaries /path/to/geoboundaries_adm0.geojson
--skip-country-annotation
--image-base-url "https://example.com/images/"
--existing-poi-distance-meters 2,5,10
--dry-run
```

Do not use `--clear` with `import_rurallure_dump_near_itineraries` in this sequence, because that would
delete the Romea Strata POIs that the dump importer is meant to merge into and enrich.

The RurAllure POI importer reads the SQL dump under `POI_data/` and creates categories, POIs, translations, category assignments, media links, and country codes.

Place the country boundary file at:

```text
backend/pois/data/geoboundaries_adm0.geojson
```

Dry run:

```bash
cd backend
python manage.py import_rurallure_dump --dry-run
```

Import:

```bash
python manage.py import_rurallure_dump
```

Clear existing imported content first:

```bash
python manage.py import_rurallure_dump --clear
```

Useful options:

```bash
python manage.py import_rurallure_dump /path/to/dump-rurallure_db.sql
python manage.py import_rurallure_dump --country-boundaries /path/to/geoboundaries_adm0.geojson
python manage.py import_rurallure_dump --skip-country-annotation
python manage.py import_rurallure_dump --image-base-url "https://example.com/images/"
```

Disabled source POIs are skipped. Imported timestamps use the import time.

### Importing Only POIs Near Existing Itineraries

Use `import_rurallure_dump_near_itineraries` to import only POIs whose dump coordinates are within a distance range from any itinerary currently stored in the database.

The command uses saved walking-route geometries when available and falls back to straight lines between saved itinerary points. It filters POIs first, then imports only the matching POIs and their related translations, categories, category assignments, media links, and files.

Dry run for POIs within the default 25 km of any itinerary:

```bash
cd backend
python manage.py import_rurallure_dump_near_itineraries --dry-run
```

During dry-run, the command also reports how many filtered RurAllure dump POIs are close to POIs that
already exist in the database, using 2 m, 5 m, and 10 m thresholds by default. Override those thresholds
with:

```bash
python manage.py import_rurallure_dump_near_itineraries --dry-run --existing-poi-distance-meters 2,5,10
```

Dry-run output also identifies dump POIs discarded because the first dump translation title is the
placeholder `...`. On a real import, those dump POIs are ignored entirely: they are not created, merged,
categorized, or used for media.

Non-placeholder dump POIs within 10 m of an existing POI are treated as the same POI. On real import,
the existing POI is updated with the dump coordinates and dump translations, the first dump translation
is marked as the reference translation, and dump media/category links are attached. A curated list of
additional beyond-10 m dump/existing pairs is handled with the same dump-metadata merge behavior.

Import POIs from 0 to the default 25 km away:

```bash
python manage.py import_rurallure_dump_near_itineraries
```

Import POIs from 1 to 25 km away:

```bash
python manage.py import_rurallure_dump_near_itineraries --min-distance-km 1 --max-distance-km 25
```

Clear existing POI/category data before importing the filtered subset:

```bash
python manage.py import_rurallure_dump_near_itineraries --clear
```

The command accepts the same dump, country-boundary, media-base-url, clear, and dry-run options as `import_rurallure_dump`:

```bash
python manage.py import_rurallure_dump_near_itineraries /path/to/dump-rurallure_db.sql
python manage.py import_rurallure_dump_near_itineraries --country-boundaries /path/to/geoboundaries_adm0.geojson
python manage.py import_rurallure_dump_near_itineraries --skip-country-annotation
python manage.py import_rurallure_dump_near_itineraries --image-base-url "https://example.com/images/"
```

The database must already contain itineraries with usable coordinates before running this command.

## Importing Routes

The route import commands read local route data and create routes, itineraries, and route-stage memberships.

GeoJSON route commands:

```bash
cd backend
python manage.py rurallure_import_romea_strata
python manage.py rurallure_import_via_francigena
python manage.py rurallure_import_via_francigena_per_alps
python manage.py rurallure_import_via_romea_del_santo
```

Official GPX path commands:

```bash
python manage.py rurallure_import_romea_strata_official --dry-run
python manage.py rurallure_import_romea_strata_official
python manage.py rurallure_import_via_francigena_official --dry-run
python manage.py rurallure_import_via_francigena_official
```

The Via Francigena official importer reads the path-only GPX files under
`routes_data/via_francigena_official`, creates one route, and creates one numbered itinerary per imported
GPX stage.

Official Romea Strata GPX bootstrap command, including POIs from `<wpt>` elements:

```bash
python manage.py rurallure_import_romea_strata_official_with_pois --dry-run --language-report
python manage.py rurallure_import_romea_strata_official_with_pois
```

This command keeps GPX `<trkpt>` elements as itinerary route geometry and creates POIs from GPX `<wpt>`
elements. It also creates initial categories from the GPX `<type>` values, storing those labels as Italian
category translations so they can be refined later in the category management dialogs.
The imported `<wpt>` POIs are kept as available POIs near the routes; they are not written into itinerary
`poiIds`, because only actual itinerary stops/waypoints should be direct itinerary POI references.
When a `<wpt>` falls on its stage track within 15 m, the importer adds it as a direct itinerary POI point
and splits the saved route geometry around it. Override the threshold with
`--on-track-poi-distance-meters 15`.
POIs are annotated with country codes using `backend/pois/data/geoboundaries_adm0.geojson` by default.
In Docker, pass `--country-boundaries /data/geoboundaries_adm0.geojson` when using the mounted deployment
copy of the boundary file.
During dry-run, the command also reports potential duplicate unique GPX waypoint POI pairs within
2 m, 5 m, and 10 m. Override those thresholds with
`--poi-duplicate-distance-meters 2,5,10`.
When importing, unique GPX waypoint POIs up to 1.5 m apart are merged into one POI using the first
encountered name and coordinates, all categories, and the longest description. Pairs beyond 1.5 m are
kept as separate POIs.

Include variants:

```bash
python manage.py rurallure_import_romea_strata_official --include-variants
python manage.py rurallure_import_romea_strata_official_with_pois --include-variants
python manage.py rurallure_import_via_francigena_official --include-variants
```

Replace existing imported route content:

```bash
python manage.py rurallure_import_romea_strata_official --replace
python manage.py rurallure_import_romea_strata_official_with_pois --replace
python manage.py rurallure_import_via_francigena_official --replace
```

Clear existing POIs and categories before re-running the POI bootstrap command:

```bash
python manage.py rurallure_import_romea_strata_official_with_pois --clear-pois
```
