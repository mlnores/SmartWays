# ECCCH Export App

`eccch_export` is a separate Django app that publishes SmartWays data for the ECCCH ecosystem. It deliberately does not replace or complicate the operational editor models in `pois`.

The app exports:

- routes
- itineraries
- POIs
- categories
- translations
- linked media and captions
- route-stage memberships
- geometry
- curated vocabulary mappings
- semantic annotations

## Design Principle

SmartWays remains the editorial system. `eccch_export` is the publication boundary.

That means:

- editor models stay practical and operational;
- export services translate them into interoperable forms;
- CIDOC-CRM/SKOS/DCAT semantics are represented at export time;
- inferred annotations are stored separately from curated content.

## Models

### `VocabularyMapping`

Stores curated mappings from local SmartWays entities to external vocabularies.

Important fields:

```text
source_type      route, itinerary, poi, category, media
source_id        local model id
vocabulary       cidoc-crm, getty-aat, wikidata, geonames, etc.
target_uri       external concept/entity URI
target_label     human label
relation         exactMatch, closeMatch, broadMatch, narrowMatch, relatedMatch
confidence       0.0 to 1.0
reviewed         whether a human reviewed the mapping
```

Typical first use: map POI categories to CIDOC-CRM-compatible or Getty AAT concepts.

### `SemanticAnnotation`

Stores semantic statements derived from mappings, text, media, or manual review.

Important fields:

```text
subject_type     route, itinerary, poi, category, media
subject_id       local model id
predicate        e.g. dcterms:type, schema:about, crm:P2_has_type
object_uri       external URI
object_label     human label
source_field     e.g. title.en, description.es, category:chapel
method           manual, category_mapping, ner, image_ai, etc.
confidence       0.0 to 1.0
review_status    candidate, accepted, rejected
payload          optional structured details
```

By default, only accepted annotations are included in JSON-LD exports.

## API Endpoints

Mounted under:

```text
/api/eccch/
```

Dataset-level endpoints:

```text
GET /api/eccch/dataset.jsonld
GET /api/eccch/graph.jsonld
GET /api/eccch/package.zip
```

GeoJSON endpoints:

```text
GET /api/eccch/routes.geojson
GET /api/eccch/itineraries.geojson
GET /api/eccch/pois.geojson
GET /api/eccch/routes/{id}.geojson
GET /api/eccch/itineraries/{id}.geojson
GET /api/eccch/pois/{id}.geojson
```

JSON-LD entity endpoints:

```text
GET /api/eccch/routes/{id}.jsonld
GET /api/eccch/itineraries/{id}.jsonld
GET /api/eccch/pois/{id}.jsonld
```

By default, endpoints expose only public content. Add:

```text
?include_drafts=true
```

to include draft routes, itineraries, and POIs in internal exports.

## JSON-LD Profile

The export uses a pragmatic JSON-LD context combining:

- CIDOC CRM: `crm`
- SKOS: `skos`
- DCAT: `dcat`
- Dublin Core Terms: `dcterms`
- Schema.org: `schema`
- GeoJSON vocabulary: `geojson`
- SmartWays extension terms: `smartways`

Examples of exported concepts:

```text
POI              crm:E53_Place, schema:Place
Category         skos:Concept
Route            crm:E73_Information_Object, schema:TouristTrip
Itinerary        crm:E73_Information_Object, schema:Trip
Media            crm:E73_Information_Object, schema:MediaObject
```

The mapping is intentionally conservative. More precise CIDOC-CRM specialization can be added through reviewed vocabulary mappings and semantic annotations.

## Geometry Export

Geometry is extracted from `Itinerary.itinerary_json`.

Priority:

1. `segments[].selectedWalkingRoute.geometry`
2. fallback straight line through saved itinerary points

Routes concatenate the geometries of their ordered stages.

GeoJSON exports are suitable for map preview and downstream spatial indexing. JSON-LD exports also include GeoJSON vocabulary geometry.

## Stable URIs

Exported entities receive generated URIs:

```text
{SMARTWAYS_PUBLIC_BASE_URL}/id/route/{id}
{SMARTWAYS_PUBLIC_BASE_URL}/id/itinerary/{id}
{SMARTWAYS_PUBLIC_BASE_URL}/id/poi/{id}
{SMARTWAYS_PUBLIC_BASE_URL}/id/category/{slug}
```

Configure:

```bash
export SMARTWAYS_PUBLIC_BASE_URL="https://smartways.example.org"
```

If unset:

- API responses use request-based absolute URLs.
- management commands fall back to `http://localhost:8000`.

## Management Commands

Build a ZIP package:

```bash
python manage.py export_eccch_dataset --output /tmp/smartways-eccch-export.zip
```

Include drafts:

```bash
python manage.py export_eccch_dataset --include-drafts --output /tmp/smartways-eccch-export.zip
```

The ZIP contains:

```text
dataset.jsonld
pois.geojson
itineraries.geojson
routes.geojson
```

Generate baseline semantic annotations:

```bash
python manage.py generate_semantic_annotations
```

Regenerate category-mapping annotations:

```bash
python manage.py generate_semantic_annotations --clear
```

The current baseline generator:

- derives POI `dcterms:type` annotations from category vocabulary mappings;
- mirrors direct mappings for routes, itineraries, and categories;
- marks annotations as accepted only when the source mapping is reviewed.

## Admin Workflow

Use Django admin to curate:

- category-to-vocabulary mappings;
- direct route/itinerary/POI mappings;
- candidate semantic annotations;
- review status and confidence.

Recommended workflow:

1. Create or import categories.
2. Add reviewed mappings from categories to known vocabularies.
3. Run `generate_semantic_annotations`.
4. Review candidate annotations.
5. Export with `export_eccch_dataset` or `/api/eccch/package.zip`.

## Tests

```bash
cd backend
python manage.py test eccch_export
```

Run with core tests before deployment:

```bash
python manage.py test pois eccch_export
python manage.py check
```

