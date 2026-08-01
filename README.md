# SmartWays

SmartWays is a Django + Angular application for managing routes, itineraries, and points of interest (POIs). The backend stores geospatial data and exposes a REST API. The frontend provides the operational UI for browsing, editing, importing, previewing, and publishing content.

## Main Features

### Frontend

- Angular application under `frontend/`.
- Route browser at `/routes`, with map previews and route-level actions.
- Route itinerary browser at `/route/:slug`, with stage ordering for draft routes and tools to add or import existing itineraries into a draft route.
- Itinerary browser at `/itineraries`, including route memberships, map previews, selection, sorting, and filtering to the visible map area.
- Itinerary editor at `/itineraries/:id/edit`, with Leaflet map editing, waypoint and POI workflows, route/path lookup, buffer POI lookup, undo/redo, and direct save.
- POI browser at `/pois`, with category/country/map filters, map preview, sorting, pagination via `Load more`, category management, and viewer/editor navigation.
- POI viewer/editor at `/pois/:id/edit` and `/pois/new`, with basic info, translations, media, category selection, publication state, geocoding-assisted titles, and map-based location picking.
- Draft/public publication workflow:
  - Public content is read-only.
  - Draft content can be edited or deleted.
  - Publishing routes cascades to their draft itineraries and draft POIs.
  - Turning POIs or itineraries to draft cascades to affected parent content.

### Backend

- Django REST API under `backend/`.
- GeoDjango storage for POI coordinates using SRID 4326.
- Spatial queries for POIs inside route-buffer polygons.
- POI categories, translations, country codes, and linked media.
- Routes composed of ordered itinerary stages. The same itinerary can belong to multiple routes.
- Itineraries stored as editor export JSON, including waypoint and POI coordinates.
- Draft/public mutation rules enforced at the API layer.
- Django admin for direct inspection and maintenance.
- Import commands for RurAllure POIs and route/GPX datasets.
- ECCCH export layer for JSON-LD, GeoJSON, ZIP packages, semantic annotations, and vocabulary mappings.
- Default local database: SQLite + SpatiaLite.
- Optional production-style database: PostgreSQL + PostGIS.

## Repository Layout

```text
backend/                    Django backend and API
frontend/                   Angular frontend
docker-compose.yml          Docker deployment stack: PostGIS, backend, frontend
requirements.txt            Minimal pip requirements for Django/DRF
```

## Requirements

### Backend

- Python 3.12 recommended.
- Django 5 and Django REST Framework.
- GeoDjango native dependencies:
  - GDAL
  - GEOS
  - PROJ
  - SQLite with SpatiaLite for local development, or PostgreSQL with PostGIS.
- For country annotation, a geoBoundaries ADM0 GeoJSON file:

```text
backend/pois/data/geoboundaries_adm0.geojson
```

### Frontend

- Node.js compatible with Angular 18, preferably Node 20+.
- npm.
- The frontend expects the backend API at:

```text
http://127.0.0.1:8000/api/
```

The Angular app also loads Leaflet, Leaflet MarkerCluster, and Turf from CDN links in `frontend/src/index.html`.

## Backend Setup

### Recommended Conda Setup On Apple Silicon

Use one Conda environment so Python, GDAL, SQLite, and SpatiaLite use the same architecture:

```bash
unset DYLD_LIBRARY_PATH
unset GDAL_LIBRARY_PATH
unset SPATIALITE_LIBRARY_PATH
unset GDAL_DRIVER_PATH

CONDA_NO_PLUGINS=true conda create -n smartways -c conda-forge \
  python=3.12 django djangorestframework gdal libspatialite geos proj sqlite

conda activate smartways
export GDAL_LIBRARY_PATH="$CONDA_PREFIX/lib/libgdal.dylib"
export SPATIALITE_LIBRARY_PATH="$CONDA_PREFIX/lib/mod_spatialite.dylib"
```

Then configure Django for local development:

```bash
export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
```

Run migrations and start the backend:

```bash
cd backend
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Useful URLs:

```text
http://127.0.0.1:8000/        Backend API index
http://127.0.0.1:8000/admin/  Django admin
http://127.0.0.1:8000/api/    REST API
```

Keep `DJANGO_DEBUG=1` during local development so Django serves admin static files.

### Alternative Virtualenv Setup

If GDAL and SpatiaLite are installed outside Python:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
export GDAL_LIBRARY_PATH=/path/to/libgdal
export SPATIALITE_LIBRARY_PATH=/path/to/mod_spatialite

cd backend
python manage.py migrate
python manage.py runserver
```

On macOS with Homebrew this is often:

```bash
brew install gdal libspatialite
export GDAL_LIBRARY_PATH="$(brew --prefix gdal)/lib/libgdal.dylib"
export SPATIALITE_LIBRARY_PATH="$(brew --prefix libspatialite)/lib/mod_spatialite.dylib"
```

On Apple Silicon, avoid mixing ARM Python with Intel Homebrew libraries.

### Optional PostGIS Setup

Start the bundled database:

```bash
docker compose up -d db
```

Configure Django:

```bash
export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
export DATABASE_ENGINE=postgis
export POSTGRES_DB=smartways
export POSTGRES_USER=smartways
export POSTGRES_PASSWORD=smartways
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432

cd backend
python manage.py migrate
python manage.py runserver
```

## Frontend Setup

Install dependencies and start the Angular development server:

```bash
cd frontend
npm install
npm start
```

Open:

```text
http://localhost:4200/
```

Build the frontend:

```bash
cd frontend
npm run build
```

Run the Angular type check used during development:

```bash
cd frontend
npm exec tsc -- --noEmit --project tsconfig.app.json
```

## Docker Deployment

The Docker setup keeps large import datasets outside the application images. The images contain only the backend, frontend, and management commands. RurAllure data is downloaded or mounted into `docker-data/`, which is ignored by git and mounted into the backend container at `/data`.

### Configure

Create a local environment file:

```bash
cp .env.example .env
```

For a real deployment, change at least:

```text
DJANGO_SECRET_KEY
POSTGRES_PASSWORD
SMARTWAYS_MEDIA_SECRET_KEY
DJANGO_ALLOWED_HOSTS
DJANGO_CSRF_TRUSTED_ORIGINS
```

If the app is served directly from a server IP address, `DJANGO_ALLOWED_HOSTS` must include that IP address. If using the Django admin or API through the frontend proxy, add the frontend origin to `DJANGO_CSRF_TRUSTED_ORIGINS`, for example:

```text
DJANGO_ALLOWED_HOSTS=203.0.113.10,localhost,127.0.0.1,backend
DJANGO_CSRF_TRUSTED_ORIGINS=http://203.0.113.10:4200
```

If the app is served from a public domain, `DJANGO_ALLOWED_HOSTS` must include that domain:

```text
DJANGO_ALLOWED_HOSTS=smartways.example.org,backend
DJANGO_CSRF_TRUSTED_ORIGINS=https://smartways.example.org
```

### Prepare Import Data

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

### Build And Start

```bash
docker compose up -d --build
```

The backend container runs migrations and collects static files on startup. The frontend is served by Nginx and proxies `/api/`, `/admin/`, and `/static/` to the backend container.

Default local URLs:

```text
http://localhost:4200/        Angular frontend
http://localhost:8000/api/    Backend API exposed directly
http://localhost:4200/admin/  Django admin through frontend Nginx
http://localhost:9000/        MinIO S3-compatible media API
http://localhost:9001/        MinIO admin console
```

### POI Media Storage

The Docker deployment includes MinIO, an S3-compatible object storage service, for files uploaded through the POI editor. Django stores media metadata in PostgreSQL and uploads the actual files to the MinIO bucket.

The relevant `.env` settings are:

```text
SMARTWAYS_MEDIA_STORAGE=s3
SMARTWAYS_MEDIA_BUCKET=smartways-media
SMARTWAYS_MEDIA_ENDPOINT=http://minio:9000
SMARTWAYS_MEDIA_PUBLIC_URL=http://localhost:9000/smartways-media
SMARTWAYS_MEDIA_ACCESS_KEY=smartways
SMARTWAYS_MEDIA_SECRET_KEY=change-this
```

`SMARTWAYS_MEDIA_ENDPOINT` is the internal URL used by the backend container. `SMARTWAYS_MEDIA_PUBLIC_URL` is the URL browsers use to load uploaded media. If MinIO runs on another machine, point `SMARTWAYS_MEDIA_ENDPOINT` to that server from Docker and set `SMARTWAYS_MEDIA_PUBLIC_URL` to the public media URL.

The Docker MinIO service uses `SMARTWAYS_MEDIA_ACCESS_KEY`, `SMARTWAYS_MEDIA_SECRET_KEY`, and `SMARTWAYS_MEDIA_BUCKET` to create the local object-storage bucket. Use the same access key and secret to log into the MinIO console.

Uploaded media is stored in the Docker volume `smartways_minio_data`, so it survives container rebuilds. Remove that volume only when you intentionally want to delete uploaded files.

### Create An Admin User

```bash
docker compose run --rm backend python manage.py createsuperuser
```

### Import Deployment Data

The recommended import pipeline uses the two most developed importers, in this order:

1. `rurallure_import_romea_strata_official_with_pois`
   Imports official Romea Strata GPX routes, creates itineraries from `<trkpt>` geometry, creates and links POIs from `<wpt>` elements, bootstraps categories, annotates countries, and merges GPX waypoint POIs up to 1.5 m apart.
2. `import_rurallure_dump_near_itineraries`
   Imports RurAllure dump POIs near the itineraries created in step 1, discards placeholder first-title `...` entries, merges duplicate dump POIs into existing Romea Strata POIs, and imports the remaining nearby POIs with translations, categories, media, and country codes.

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
POI_DUMP_PATH=/data/POI_data/dump-rurallure_db.sql \
COUNTRY_BOUNDARIES_PATH=/data/geoboundaries_adm0.geojson \
MAX_DISTANCE_KM=25 \
./scripts/import_deployment_data.sh
```

You can also run individual commands manually:

```bash
docker compose run --rm backend \
  python manage.py rurallure_import_romea_strata_official_with_pois \
  --source-dir /data/routes_data/romea_strata_official \
  --country-boundaries /data/geoboundaries_adm0.geojson \
  --include-variants

docker compose run --rm backend \
  python manage.py import_rurallure_dump_near_itineraries \
  /data/POI_data/dump-rurallure_db.sql \
  --country-boundaries /data/geoboundaries_adm0.geojson \
  --max-distance-km 25
```

### Operational Notes

- `POI_data/`, `routes_data/`, `POI_data.zip`, `routes_data.zip`, and `docker-data/` should stay out of git.
- The Docker backend uses PostgreSQL/PostGIS, not the local SpatiaLite database.
- The frontend runtime API base URL is generated from `SMARTWAYS_API_BASE_URL`; Docker defaults it to `/api`.
- The app images do not contain import datasets, so rebuilding images does not duplicate large data.

## Main Frontend Routes

```text
/routes                    Browse routes
/route/:slug               Browse the itineraries/stages of a route
/itineraries               Browse itineraries
/itineraries/new           New itinerary editor
/itineraries/:id/edit      Edit a draft itinerary
/itineraries/:id/pois      Browse POIs included in an itinerary
/pois                      Browse POIs
/pois/new                  Create a draft POI
/pois/:id/edit             View/edit POI metadata, translations, and media
```

### Building Draft Routes

The route itinerary page at `/route/:slug` is the main UI for composing a route from existing itineraries.

For draft routes, the toolbar next to the search box includes:

- `Add`: opens a simplified searchable itinerary picker. It omits the map preview, route-inclusion badges, and draft column from the main itinerary list so the user can quickly select one or more itineraries.
- `Import from other routes`: opens a two-lane picker. The left lane lists other routes plus `Unassigned itineraries`; the right lane lists the itineraries available from the selected source.

Both dialogs allow inserting the selected itineraries:

- at the beginning of the current route,
- at the end,
- before an existing itinerary,
- after an existing itinerary.

After insertion, the list scrolls to the first newly added itinerary and keeps all newly added itineraries selected. Public routes are read-only, so these buttons are not shown for public routes.

## API Overview

Base URL:

```text
http://127.0.0.1:8000/api/
```

Core endpoints:

```text
GET|POST              /api/pois/
GET|PUT|PATCH|DELETE  /api/pois/{id}/
GET|POST              /api/poi-translations/
GET|POST              /api/poi-media/
GET|POST              /api/categories/
GET|POST              /api/category-translations/

GET|POST              /api/routes/
GET|PUT|PATCH|DELETE  /api/routes/{id}/
POST                  /api/routes/{id}/add-itineraries/
POST                  /api/routes/{id}/remove-itinerary/
POST                  /api/routes/{id}/reorder-itineraries/
GET|POST              /api/route-translations/

GET|POST              /api/itineraries/
GET|PUT|PATCH|DELETE  /api/itineraries/{id}/
GET|POST              /api/itinerary-translations/

POST                  /api/buffer-pois/

GET                   /api/eccch/dataset.jsonld
GET                   /api/eccch/graph.jsonld
GET                   /api/eccch/package.zip
GET                   /api/eccch/routes.geojson
GET                   /api/eccch/itineraries.geojson
GET                   /api/eccch/pois.geojson
GET                   /api/eccch/routes/{id}.jsonld
GET                   /api/eccch/itineraries/{id}.jsonld
GET                   /api/eccch/pois/{id}.jsonld
```

Common POI filters:

```text
?language=en
?q=castle
?category=heritage
?country=ES
?enabled=true
?bbox=min_lon,min_lat,max_lon,max_lat
```

The `POST /api/buffer-pois/` endpoint accepts a GeoJSON Polygon or MultiPolygon and returns POIs inside that buffer.

### ECCCH Export

The `eccch_export` Django app is a publication layer for the broader ECCCH ecosystem. It does not change the editor data model. Instead, it serializes existing SmartWays routes, itineraries, POIs, categories, translations, media, and geometry as interoperable JSON-LD and GeoJSON.

By default, ECCCH export endpoints include only public content. Add `?include_drafts=true` when an internal export must include drafts:

```text
http://127.0.0.1:8000/api/eccch/graph.jsonld?include_drafts=true
```

The JSON-LD context uses a pragmatic mix of CIDOC CRM, SKOS, DCAT, Dublin Core, Schema.org, GeoJSON vocabulary, and SmartWays-specific extension terms. Category-to-vocabulary mappings and semantic annotations are stored separately in the Django admin under `ECCCH export`.

For stable generated URIs, configure the public base URL:

```bash
export SMARTWAYS_PUBLIC_BASE_URL="https://smartways.example.org"
```

If unset, request-based URLs are used for API responses, and management commands fall back to `http://localhost:8000`.

## Importing POIs

### Recommended Two-Step Import

For the current Romea Strata + RurAllure workflow, prefer the two most developed importers and run them
in sequence:

1. Bootstrap routes, itineraries, and POIs from the official Romea Strata GPX files:

   ```bash
   cd backend
   python manage.py rurallure_import_romea_strata_official_with_pois \
     --source-dir /path/to/routes_data/romea_strata_official \
     --country-boundaries /path/to/geoboundaries_adm0.geojson \
     --include-variants
   ```

2. Import RurAllure dump POIs near the itineraries created in step 1:

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

Official Romea Strata GPX command:

```bash
python manage.py rurallure_import_romea_strata_official --dry-run
python manage.py rurallure_import_romea_strata_official
```

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
```

Replace existing imported route content:

```bash
python manage.py rurallure_import_romea_strata_official --replace
python manage.py rurallure_import_romea_strata_official_with_pois --replace
```

Clear existing POIs and categories before re-running the POI bootstrap command:

```bash
python manage.py rurallure_import_romea_strata_official_with_pois --clear-pois
```

## Clearing Content

Preview what would be deleted:

```bash
cd backend
python manage.py clear_content_data --dry-run
```

Delete POIs, itineraries, routes, and dependent translations/media:

```bash
python manage.py clear_content_data --yes
```

Keep categories:

```bash
python manage.py clear_content_data --yes --keep-categories
```

## ECCCH Export Commands

Generate a ZIP package containing JSON-LD and GeoJSON exports:

```bash
cd backend
python manage.py export_eccch_dataset --output /path/to/smartways-eccch-export.zip
```

Include draft routes, itineraries, and POIs:

```bash
python manage.py export_eccch_dataset --include-drafts --output /path/to/smartways-eccch-export.zip
```

Generate baseline semantic annotations from curated vocabulary mappings:

```bash
python manage.py generate_semantic_annotations
```

Regenerate category-mapping annotations from scratch:

```bash
python manage.py generate_semantic_annotations --clear
```

The baseline annotation command currently derives POI type annotations from category vocabulary mappings and mirrors direct mappings for routes, itineraries, and categories. More advanced NLP or media-derived annotations should be added as separate reviewed pipelines.

## Verification

Backend checks:

```bash
cd backend
python manage.py check
python manage.py test pois eccch_export
```

Frontend checks:

```bash
cd frontend
npm exec tsc -- --noEmit --project tsconfig.app.json
npm run build
```

## Development Notes

- The backend defaults to `DATABASE_ENGINE=spatialite`; set `DATABASE_ENGINE=postgis` for PostGIS.
- Draft/public state is enforced by the backend, not only by the UI.
- The Angular app uses the local backend URL in `frontend/src/app/api.service.ts`.
- The active itinerary editor is the Angular route at `/itineraries/:id/edit`.
- Large local route/POI datasets are development inputs and should stay out of git.
