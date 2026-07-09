# SmartWays

SmartWays is a Django + Angular application for managing routes, itineraries, and points of interest (POIs). The backend stores geospatial data and exposes a REST API. The frontend provides the operational UI for browsing, editing, importing, previewing, and publishing content.

## Main Features

### Frontend

- Angular application under `frontend/`.
- Route browser at `/routes`, with map previews and route-level actions.
- Route itinerary browser at `/route/:slug`, with stage ordering for draft routes.
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
- Default local database: SQLite + SpatiaLite.
- Optional production-style database: PostgreSQL + PostGIS.

## Repository Layout

```text
backend/                    Django backend and API
frontend/                   Angular frontend
POI_data/                   Local RurAllure SQL dump input, not required for normal runtime
routes_data/                Local route/GPX import inputs, ignored by git
interactive_itinerary_map.* Legacy static editor fallback
docker-compose.yml          Optional local PostGIS database
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
- For RurAllure country annotation, a geoBoundaries ADM0 GeoJSON file:

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

## Importing POIs

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

Include variants:

```bash
python manage.py rurallure_import_romea_strata_official --include-variants
```

Replace existing imported route content:

```bash
python manage.py rurallure_import_romea_strata_official --replace
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

## Verification

Backend checks:

```bash
cd backend
python manage.py check
python manage.py test pois
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
- The root `interactive_itinerary_map.html`, `.css`, and `.js` files are legacy fallback assets. The active editor is the Angular route.
- Large local route/POI datasets are development inputs and should stay out of git.
