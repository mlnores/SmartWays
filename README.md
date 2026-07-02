# SmartWays POI Backend

This repository contains a static itinerary editor and a Django-based backend foundation for managing points of interest (POIs).

The backend is under `backend/` and uses Django, Django REST Framework, and GeoDjango with an SRID 4326 `PointField`. It defaults to SQLite with SpatiaLite for local development and can switch to PostGIS for production.

## Features

- POI CRUD API.
- GeoDjango coordinates stored as `location` with SRID 4326.
- API read/write coordinates as `gps_latitude` and `gps_longitude`.
- Multilingual POI titles, descriptions, and slugs.
- Multilingual category names.
- Link-based POI images.
- Many-to-many POI/category relationship.
- Filters for language, category, enabled state, and bounding box.
- One-shot RurAllure SQL dump import command.
- Server-rendered POI browser with selected POI details, map, and image carousel.
- Itinerary editor buffer lookups with clustered POI markers.
- Basic Django admin registration.

## Setup

### Recommended Conda Setup On Apple Silicon

On Apple Silicon, use a dedicated Conda environment so Python, GDAL, SQLite, and SpatiaLite all come from the same architecture. If your base Conda environment has plugin errors, create the environment with plugins disabled:

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

By default, the backend uses SQLite with SpatiaLite:

```bash
export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
```

Run migrations and start the API:

```bash
cd backend
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Open the Django admin panel at:

```text
http://127.0.0.1:8000/admin/
```

For local development, keep `DJANGO_DEBUG=1` when starting the server. Without it, Django will not serve admin static assets and the admin panel may appear unstyled.

The root backend page is available at:

```text
http://127.0.0.1:8000/
```

The POI browser page is available at:

```text
http://127.0.0.1:8000/pois/
```

### Alternative Virtualenv Setup

If you are not using Conda, create and activate a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

GeoDjango needs GDAL and the SpatiaLite shared library installed on your machine. If Django cannot find them automatically, set:

```bash
export GDAL_LIBRARY_PATH=/path/to/libgdal
export SPATIALITE_LIBRARY_PATH=/path/to/mod_spatialite
```

On macOS with Homebrew, this is often:

```bash
brew install gdal libspatialite
export GDAL_LIBRARY_PATH="$(brew --prefix gdal)/lib/libgdal.dylib"
export SPATIALITE_LIBRARY_PATH="$(brew --prefix libspatialite)/lib/mod_spatialite.dylib"
```

On Apple Silicon, make sure Python and GDAL use the same architecture. If you use ARM Python from Miniconda, prefer Conda packages:

```bash
conda install -c conda-forge gdal libspatialite geos proj
export GDAL_LIBRARY_PATH="$CONDA_PREFIX/lib/libgdal.dylib"
export SPATIALITE_LIBRARY_PATH="$CONDA_PREFIX/lib/mod_spatialite.dylib"
```

If Django reports an incompatible architecture for `/usr/local/opt/gdal/...`, unset old Intel Homebrew paths before retrying:

```bash
unset GDAL_LIBRARY_PATH
unset SPATIALITE_LIBRARY_PATH
```

## Optional PostGIS Setup

For production, use PostgreSQL with PostGIS. Example local database:

```bash
docker compose up -d db
```

Or create one manually:

```sql
CREATE DATABASE smartways;
\c smartways
CREATE EXTENSION postgis;
```

Configure the database with environment variables:

```bash
export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
export DATABASE_ENGINE=postgis
export POSTGRES_DB=smartways
export POSTGRES_USER=smartways
export POSTGRES_PASSWORD=smartways
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
```

Then run:

```bash
cd backend
python manage.py migrate
python manage.py runserver
```

## API Endpoints

Base URL:

```text
http://127.0.0.1:8000/api/
```

Endpoints:

- `GET|POST /api/pois/`
- `GET|PUT|PATCH|DELETE /api/pois/{id}/`
- `GET|POST /api/poi-translations/`
- `GET|POST /api/categories/`
- `GET|POST /api/category-translations/`
- `GET|POST /api/poi-images/`
- `GET|POST /api/itineraries/`
- `GET|PUT|PATCH|DELETE /api/itineraries/{id}/`
- `GET|POST /api/itinerary-translations/`
- `POST /api/buffer-pois/`

Server-rendered pages:

- `GET /`
- `GET /pois/`

The POI browser supports `q`, `language`, `page`, and `poi` query parameters. Example:

```text
http://127.0.0.1:8000/pois/?language=en&q=castle
```

## Itinerary Editor POI Lookup

The static itinerary editor in `interactive_itinerary_map.html` calls `POST /api/buffer-pois/` when a segment buffer is displayed or refreshed. Returned POIs are shown on the map and in the POI browser panel.

When a buffer contains many POIs, the editor clusters markers with `leaflet.markercluster`, loaded from the unpkg CDN alongside Leaflet and Turf.js. If the clustering plugin is unavailable, the editor falls back to plain Leaflet markers.

The editor's Save button opens a dialog with the current itinerary JSON, plus language, title, and description fields. Use `Save to server` to create an itinerary through `POST /api/itineraries/`; the JSON remains available for download from the same dialog.

## Create A POI

```bash
curl -X POST http://127.0.0.1:8000/api/pois/ \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "gps_latitude": 42.2406,
    "gps_longitude": -8.7207,
    "website": "https://example.com",
    "translations": [
      {
        "language_code": "en",
        "title": "Castle",
        "description": "A fortified place.",
        "slug": "castle"
      },
      {
        "language_code": "es",
        "title": "Castillo",
        "description": "Un lugar fortificado.",
        "slug": "castillo"
      }
    ],
    "images": [
      {
        "image_url": "https://example.com/castle.jpg",
        "position": 1,
        "is_primary": true
      }
    ]
  }'
```

## Filtering

Localized response:

```bash
curl "http://127.0.0.1:8000/api/pois/?language=es"
```

Filter by category slug or id:

```bash
curl "http://127.0.0.1:8000/api/pois/?category=heritage"
```

Filter by bounding box:

```bash
curl "http://127.0.0.1:8000/api/pois/?bbox=-9,42,-8,43"
```

The `bbox` parameter uses:

```text
min_lon,min_lat,max_lon,max_lat
```

Filter enabled POIs:

```bash
curl "http://127.0.0.1:8000/api/pois/?enabled=true"
```

Find POIs inside a GeoJSON buffer region:

```bash
curl -X POST http://127.0.0.1:8000/api/buffer-pois/ \
  -H "Content-Type: application/json" \
  -d '{
    "language": "en",
    "limit": 100,
    "buffer": {
      "type": "Polygon",
      "coordinates": [[[-9,42],[-8,42],[-8,43],[-9,43],[-9,42]]]
    }
  }'
```

## Create An Itinerary

Itineraries store the editor export JSON as `itinerary_json`, with localized title and description rows in `translations`:

```bash
curl -X POST http://127.0.0.1:8000/api/itineraries/ \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "itinerary_json": {
      "savedAt": "2026-07-02T09:00:00Z",
      "points": [
        {"type": "waypoint", "label": "Start", "coordinates": {"lat": 42.24, "lng": -8.72}},
        {"type": "poi", "id": "1"}
      ],
      "segments": []
    },
    "translations": [
      {
        "language_code": "en",
        "title": "Castle walk",
        "description": "A short itinerary around the castle."
      }
    ]
  }'
```

## Import RurAllure POIs

The repository includes a RurAllure PostgreSQL dump under `POI_data/`. Import it into the current Django schema with:

```bash
cd backend
python manage.py import_rurallure_dump
```

The importer reads only the relevant `COPY` sections from `POI_data/dump-rurallure_db.sql` and creates:

- categories and category translations
- POIs with SRID 4326 point locations
- POI translations
- POI/category relations
- linked POI images

Disabled source POIs are skipped. Imported `created_at` and `updated_at` values use the current import time, not the original dump timestamps.

Dry-run the parser without writing rows:

```bash
python manage.py import_rurallure_dump --dry-run
```

Clear existing POI data and import again:

```bash
python manage.py import_rurallure_dump --clear
```

Use a custom dump path or image base URL:

```bash
python manage.py import_rurallure_dump /path/to/dump-rurallure_db.sql
python manage.py import_rurallure_dump --image-base-url "https://example.com/images/"
```

## Tests

Tests require a configured spatial database, either the default SQLite/SpatiaLite setup or PostGIS:

```bash
cd backend
python manage.py test
```
