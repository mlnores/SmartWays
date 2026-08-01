# SmartWays Backend

The backend is a Django 5 + Django REST Framework + GeoDjango service. It stores routes, itineraries, POIs, translations, media metadata, publication state, and ECCCH export metadata.

The Django project is `config`. The main domain apps are:

- `pois`: operational API for routes, itineraries, POIs, categories, media, imports, and draft/public rules.
- `eccch_export`: publication layer for JSON-LD, GeoJSON, semantic mappings, and ECCCH export packages.

## Runtime Responsibilities

The backend provides:

- REST API under `/api/`.
- Django admin under `/admin/`.
- GeoDjango storage and spatial queries.
- Draft/public state enforcement.
- Media upload metadata and storage integration.
- RurAllure route and POI import commands.
- ECCCH JSON-LD, GeoJSON, and ZIP exports.

The backend does not serve the Angular application in local development. In Docker, Nginx serves the frontend and proxies `/api/` to this service.

## Important Files

```text
manage.py                         Django management entry point
config/settings.py                Django settings
config/urls.py                    Root URL configuration
pois/                             Core SmartWays domain app
eccch_export/                     ECCCH publication/export app
```

## Local Environment

Python 3.12 is recommended. GeoDjango requires native GIS libraries:

- GDAL
- GEOS
- PROJ
- SpatiaLite for local SQLite development, or PostGIS for PostgreSQL deployments

Typical Conda setup on macOS:

```bash
CONDA_NO_PLUGINS=true conda create -n smartways -c conda-forge \
  python=3.12 django djangorestframework gdal libspatialite geos proj sqlite

conda activate smartways
export DJANGO_SECRET_KEY="change-me"
export DJANGO_DEBUG=1
export GDAL_LIBRARY_PATH="$CONDA_PREFIX/lib/libgdal.dylib"
export SPATIALITE_LIBRARY_PATH="$CONDA_PREFIX/lib/mod_spatialite.dylib"
```

For pip-based setup:

```bash
pip install -r ../requirements.txt
```

You still need GDAL/GEOS/PROJ/SpatiaLite installed by the OS, Conda, or Homebrew.

## Database Configuration

The backend defaults to SpatiaLite:

```bash
export DATABASE_ENGINE=spatialite
export SQLITE_NAME=/path/to/db.sqlite3
```

For PostGIS:

```bash
export DATABASE_ENGINE=postgis
export POSTGRES_DB=smartways
export POSTGRES_USER=smartways
export POSTGRES_PASSWORD=smartways
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
```

Run migrations:

```bash
python manage.py migrate
```

Create an admin user:

```bash
python manage.py createsuperuser
```

## Running Locally

```bash
cd backend
python manage.py runserver
```

Useful URLs:

```text
http://127.0.0.1:8000/        Backend index
http://127.0.0.1:8000/admin/  Django admin
http://127.0.0.1:8000/api/    REST API
```

Keep `DJANGO_DEBUG=1` during local development so Django serves admin static assets.

## Media Storage

Local development defaults to filesystem media storage:

```text
MEDIA_ROOT = backend/media
MEDIA_URL = /media/
```

Docker deployment can use MinIO through the S3-compatible Django storage backend:

```bash
export SMARTWAYS_MEDIA_STORAGE=s3
export SMARTWAYS_MEDIA_BUCKET=smartways-media
export SMARTWAYS_MEDIA_ENDPOINT=http://minio:9000
export SMARTWAYS_MEDIA_PUBLIC_URL=http://localhost:9000/smartways-media
export SMARTWAYS_MEDIA_ACCESS_KEY=...
export SMARTWAYS_MEDIA_SECRET_KEY=...
```

The model stores both remote URLs and uploaded files. Uploaded files expose their public URL through the serializers.

## API Structure

The operational API is mounted at:

```text
/api/
```

Main resources:

```text
/api/routes/
/api/route-translations/
/api/route-media/

/api/itineraries/
/api/itinerary-translations/
/api/itinerary-media/

/api/pois/
/api/poi-translations/
/api/poi-media/

/api/categories/
/api/category-translations/
/api/buffer-pois/
```

ECCCH export endpoints are mounted at:

```text
/api/eccch/
```

See `pois/README.md` and `eccch_export/README.md` for app-specific details.

## Draft/Public Rules

The backend treats `enabled=True` as public and `enabled=False` as draft.

Rules enforced by the API:

- Public routes, itineraries, and POIs are read-only.
- Draft content may be edited and deleted.
- Publishing a route cascades to its draft itineraries and draft POIs.
- Turning a POI to draft cascades to affected itineraries and routes.
- Turning an itinerary to draft cascades to affected routes.
- Route membership and stage order may be changed only on draft routes.

These rules are enforced server-side; frontend controls are convenience only.

## Management Commands

Core checks:

```bash
python manage.py check
python manage.py test pois eccch_export
```

Clear content:

```bash
python manage.py clear_content_data --dry-run
python manage.py clear_content_data --yes
python manage.py clear_content_data --yes --keep-categories
```

Import routes:

```bash
python manage.py rurallure_import_romea_strata
python manage.py rurallure_import_via_francigena
python manage.py rurallure_import_via_francigena_per_alps
python manage.py rurallure_import_via_romea_del_santo
python manage.py rurallure_import_romea_strata_official --include-variants
python manage.py rurallure_import_romea_strata_official_with_pois --dry-run --language-report
python manage.py rurallure_import_romea_strata_official_with_pois --include-variants
```

The `rurallure_import_romea_strata_official_with_pois` command is the bootstrap variant for an empty
database. It keeps GPX `<trkpt>` elements as itinerary route geometry, creates POIs from `<wpt>` elements,
and creates initial categories from GPX `<type>` values with Italian translations.
The imported `<wpt>` POIs remain available near the routes but are not written into itinerary `poiIds`;
direct itinerary POI references are reserved for actual stops/waypoints.
If a `<wpt>` is within 15 m of its stage track, it is written as a direct itinerary POI point and the
saved route geometry is split around it. Override this with `--on-track-poi-distance-meters 15`.
It also annotates imported POIs with country codes using geoBoundaries ADM0 polygons; use
`--country-boundaries /data/geoboundaries_adm0.geojson` in Docker deployments.
During dry-run, it reports potential duplicate unique GPX waypoint POI pairs within 2 m, 5 m, and
10 m. Override those thresholds with `--poi-duplicate-distance-meters 2,5,10`.
When importing, unique GPX waypoint POIs up to 1.5 m apart are merged into one POI using the first
encountered name and coordinates, all categories, and the longest description. Pairs beyond 1.5 m remain
separate POIs.

Import POIs:

```bash
python manage.py import_rurallure_dump
python manage.py import_rurallure_dump_near_itineraries
```

`import_rurallure_dump_near_itineraries --dry-run` also reports how many filtered dump POIs are within
2 m, 5 m, and 10 m of existing database POIs. Override those thresholds with
`--existing-poi-distance-meters 2,5,10`.

The near-itineraries importer discards dump POIs whose first dump translation title is the placeholder
`...`. Dry-run reports those IDs and coordinates. Real imports ignore them entirely: they are not
created, merged, categorized, or used for media.

Non-placeholder dump POIs within 10 m of an existing POI are merged into the existing POI using dump
coordinates, dump translations, dump categories, and dump media. The first dump translation becomes the
reference translation. A curated list of additional beyond-10 m pairs is merged the same way.

ECCCH export:

```bash
python manage.py generate_semantic_annotations
python manage.py export_eccch_dataset --output /tmp/smartways-eccch-export.zip
```

## Deployment Notes

The root `docker-compose.yml` is the preferred deployment entry point. Important backend environment variables:

```text
DJANGO_SECRET_KEY
DJANGO_DEBUG
DJANGO_ALLOWED_HOSTS
DJANGO_CSRF_TRUSTED_ORIGINS
DATABASE_ENGINE
POSTGRES_*
SMARTWAYS_MEDIA_*
SMARTWAYS_PUBLIC_BASE_URL
COUNTRY_BOUNDARIES_PATH
```

When deployed behind an IP address or domain, include that host in `DJANGO_ALLOWED_HOSTS`.
