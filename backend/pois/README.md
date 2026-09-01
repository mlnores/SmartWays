# POIs App

`pois` is the core SmartWays domain app. It manages points of interest, categories, itineraries, routes, translations, linked media, draft/public state, spatial lookup, and import commands.

## Domain Model

Main models:

```text
POI
POITranslation
POIMedia
POIMediaTranslation

Category
CategoryTranslation

Itinerary
ItineraryTranslation
ItineraryMedia
ItineraryMediaTranslation

Route
RouteTranslation
RouteMedia
RouteMediaTranslation
RouteStage
```

Key relationships:

- A `POI` has one GeoDjango point location, optional country code, categories, translations, and media.
- A `Category` groups POIs and has translatable labels.
- An `Itinerary` stores the itinerary editor export JSON in `itinerary_json`.
- A `Route` is composed of itineraries through `RouteStage`.
- The same itinerary can belong to multiple routes with different stage numbers.
- Media records can point to remote URLs or uploaded files.
- Media captions are translatable through media translation models.

## Publication State

The boolean field `enabled` means public:

```text
enabled=True   Public, read-only through the API
enabled=False  Draft, editable
```

The UI labels this as `Draft?`:

```text
enabled=True   Draft? No
enabled=False  Draft? Yes
```

Server-side rules:

- Only draft routes, itineraries, and POIs can be edited or deleted.
- Only draft routes can have stages added, removed, or reordered.
- Publishing a route publishes its draft itineraries and draft POIs.
- Turning an itinerary to draft turns affected routes to draft.
- Turning a POI to draft turns affected itineraries and routes to draft.

## REST API

Registered under `/api/`:

```text
/api/pois/
/api/poi-translations/
/api/poi-media/
/api/poi-images/              Compatibility alias for poi-media

/api/categories/
/api/category-translations/

/api/routes/
/api/route-translations/
/api/route-media/

/api/itineraries/
/api/itinerary-translations/
/api/itinerary-media/

/api/buffer-pois/
/api/mock-pois/
```

Useful route actions:

```text
POST /api/routes/{id}/add-itineraries/
POST /api/routes/{id}/remove-itinerary/
POST /api/routes/{id}/reorder-itineraries/
```

Useful POI actions:

```text
GET /api/pois/countries/
GET /api/pois/country-bounds/
GET /api/pois/country-at/
```

Common list filters:

```text
?language=en
?q=church
?enabled=true
?category=chapel
?country=ES
?bbox=min_lon,min_lat,max_lon,max_lat
```

## Itinerary JSON

`Itinerary.itinerary_json` stores the editor state. It normally contains:

```json
{
  "points": [
    {
      "type": "waypoint",
      "lat": 42.1,
      "lng": -8.1,
      "coordinates": { "lat": 42.1, "lng": -8.1 }
    },
    {
      "type": "poi",
      "poiId": 123,
      "lat": 42.2,
      "lng": -8.2
    }
  ],
  "segments": [
    {
      "fromPoint": 1,
      "toPoint": 2,
      "bufferDistanceMeters": 1000,
      "selectedWalkingRoute": {
        "geometry": {
          "type": "LineString",
          "coordinates": [[-8.1, 42.1], [-8.2, 42.2]]
        },
        "distanceMeters": 12345
      }
    }
  ]
}
```

Importers and exports prefer `selectedWalkingRoute.geometry` and fall back to straight lines between points when needed.

## Spatial POI Lookup

`POST /api/buffer-pois/` accepts a GeoJSON polygon or multipolygon and returns POIs inside it.

This powers the itinerary editor’s “POIs for path X -> Y” panel. The frontend can filter results by category and remove already-added POIs from the addable candidates.

## Media

Media exists for POIs, routes, and itineraries.

Each media record stores:

- media type: image, video, audio, document, link, other
- remote URL or uploaded file
- original filename, content type, and size for uploads
- position
- primary flag
- translated captions

Uploaded files use Django’s configured storage backend. Docker deployments use MinIO through S3-compatible storage.

## Country Codes

POIs have an ISO 3166-1 alpha-2 `country_code`.

Importers can annotate countries by checking POI coordinates against a geoBoundaries ADM0 GeoJSON file. The expected local development path is:

```text
backend/pois/data/geoboundaries_adm0.geojson
```

The file is intentionally not committed.

The runtime lookup endpoint used by the POI editor also reads this boundary file. The path is configurable:

```bash
export COUNTRY_BOUNDARIES_PATH=/path/to/geoboundaries_adm0.geojson
```

If unset, the backend falls back to:

```text
backend/pois/data/geoboundaries_adm0.geojson
```

Docker deployments set:

```text
COUNTRY_BOUNDARIES_PATH=/data/geoboundaries_adm0.geojson
```

## Import Commands

### Full RurAllure POI Dump

```bash
python manage.py import_rurallure_dump
```

Useful options:

```bash
python manage.py import_rurallure_dump --dry-run
python manage.py import_rurallure_dump --clear
python manage.py import_rurallure_dump /path/to/dump-rurallure_db.sql
python manage.py import_rurallure_dump --country-boundaries /path/to/geoboundaries_adm0.geojson
python manage.py import_rurallure_dump --skip-country-annotation
python manage.py import_rurallure_dump --image-base-url "https://example.com/images/"
```

Importer behavior:

- Skips disabled source POIs.
- Skips translations whose title is blank or `...`.
- Skips POIs with no valid translation title.
- Creates categories and translations.
- Creates POI media records for imported image links.
- Uses the current import moment for created/updated timestamps.

### RurAllure POIs Near Existing Itineraries

```bash
python manage.py import_rurallure_dump_near_itineraries
```

Default maximum distance is 25 km.

Useful options:

```bash
python manage.py import_rurallure_dump_near_itineraries --dry-run
python manage.py import_rurallure_dump_near_itineraries --clear
python manage.py import_rurallure_dump_near_itineraries --min-distance-km 1 --max-distance-km 25
python manage.py import_rurallure_dump_near_itineraries --country-boundaries /path/to/geoboundaries_adm0.geojson
```

The database must already contain itineraries with usable coordinates.

### Route Import Commands

GeoJSON route commands:

```bash
python manage.py rurallure_import_romea_strata
python manage.py rurallure_import_via_francigena
python manage.py rurallure_import_via_francigena_per_alps
python manage.py rurallure_import_via_romea_del_santo
```

Official Romea Strata GPX import:

```bash
python manage.py rurallure_import_romea_strata_official --dry-run
python manage.py rurallure_import_romea_strata_official --include-variants
python manage.py rurallure_import_romea_strata_official --replace
```

The official importer reuses matching itinerary stages where possible, allowing the same itinerary to belong to several routes.

Official Via Francigena GPX path import:

```bash
python manage.py rurallure_import_via_francigena_official --dry-run
python manage.py rurallure_import_via_francigena_official --include-variants
python manage.py rurallure_import_via_francigena_official --replace
```

The Via Francigena importer reads path-only GPX files from `routes_data/via_francigena_official`, creates
one route, and creates one numbered itinerary per imported GPX stage.

## Admin

The Django admin exposes:

- routes and route stages
- itineraries
- POIs
- categories
- translations
- media and media captions

Keep `DJANGO_DEBUG=1` locally if admin CSS is missing.

## Tests

```bash
cd backend
python manage.py test pois
```
