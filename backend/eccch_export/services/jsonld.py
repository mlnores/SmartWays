from pois.models import Category, Itinerary, POI, Route

from .common import annotations_for, mapping_terms, media_items, reference_translation, translations_as_language_map
from .geometry import itinerary_coordinates, line_geometry, point_coordinates, route_coordinates
from .identifiers import api_uri, entity_uri, media_uri


JSONLD_CONTEXT = {
    "crm": "http://www.cidoc-crm.org/cidoc-crm/",
    "dcat": "http://www.w3.org/ns/dcat#",
    "dcterms": "http://purl.org/dc/terms/",
    "geojson": "https://purl.org/geojson/vocab#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "schema": "https://schema.org/",
    "skos": "http://www.w3.org/2004/02/skos/core#",
    "smartways": "https://smartways.example.org/ns#",
}


def compact_translated_entity(obj, kind, request=None):
    reference = reference_translation(obj)
    return {
        "@id": entity_uri(kind, obj.id, request),
        "schema:name": reference.title if reference else str(obj),
    }


def category_jsonld(category, request=None):
    names = translations_as_language_map(category.translations, "name")
    data = {
        "@context": JSONLD_CONTEXT,
        "@id": entity_uri("category", category.slug, request),
        "@type": "skos:Concept",
        "skos:prefLabel": names,
        "smartways:localId": category.id,
        "smartways:slug": category.slug,
        "skos:mappingRelation": mapping_terms("category", category.id),
        "smartways:semanticAnnotation": annotations_for("category", category.id),
    }
    return data


def poi_jsonld(poi, request=None):
    coordinates = point_coordinates(poi.location)
    categories = [
        {
            "@id": entity_uri("category", category.slug, request),
            "skos:prefLabel": translations_as_language_map(category.translations, "name"),
            "skos:mappingRelation": mapping_terms("category", category.id),
        }
        for category in poi.categories.all()
    ]
    media = media_items(poi.media, lambda item: media_uri("poi", item.id, request))
    data = {
        "@context": JSONLD_CONTEXT,
        "@id": entity_uri("poi", poi.id, request),
        "@type": ["crm:E53_Place", "schema:Place"],
        "smartways:localId": poi.id,
        "smartways:publicationState": "public" if poi.enabled else "draft",
        "schema:name": translations_as_language_map(poi.translations, "title"),
        "schema:description": translations_as_language_map(poi.translations, "description"),
        "schema:url": poi.website,
        "schema:telephone": poi.phone,
        "schema:email": poi.email,
        "schema:addressCountry": poi.country_code,
        "schema:geo": {
            "@type": "schema:GeoCoordinates",
            "schema:longitude": coordinates[0] if coordinates else None,
            "schema:latitude": coordinates[1] if coordinates else None,
        },
        "geojson:geometry": {"type": "Point", "coordinates": coordinates} if coordinates else None,
        "dcterms:type": categories,
        "schema:associatedMedia": media,
        "smartways:vocabularyMapping": mapping_terms("poi", poi.id),
        "smartways:semanticAnnotation": annotations_for("poi", poi.id),
        "dcterms:created": poi.created_at.isoformat() if poi.created_at else None,
        "dcterms:modified": poi.updated_at.isoformat() if poi.updated_at else None,
    }
    return drop_empty(data)


def itinerary_jsonld(itinerary, request=None):
    coordinates = itinerary_coordinates(itinerary)
    geometry = line_geometry(coordinates)
    stages = [
        {
            "@id": entity_uri("route-stage", stage.id, request),
            "smartways:stageNumber": stage.stage_number,
            "smartways:route": compact_translated_entity(stage.route, "route", request),
        }
        for stage in itinerary.route_stages.select_related("route").prefetch_related("route__translations")
    ]
    points = []
    for point in itinerary.itinerary_json.get("points", []) if isinstance(itinerary.itinerary_json, dict) else []:
        if isinstance(point, dict) and point.get("type") == "poi" and point.get("poiId"):
            points.append({"@id": entity_uri("poi", point["poiId"], request)})
    data = {
        "@context": JSONLD_CONTEXT,
        "@id": entity_uri("itinerary", itinerary.id, request),
        "@type": ["crm:E73_Information_Object", "schema:Trip"],
        "smartways:localId": itinerary.id,
        "smartways:publicationState": "public" if itinerary.enabled else "draft",
        "schema:name": translations_as_language_map(itinerary.translations, "title"),
        "schema:description": translations_as_language_map(itinerary.translations, "description"),
        "geojson:geometry": geometry,
        "smartways:routeMembership": stages,
        "smartways:includedPOI": points,
        "schema:associatedMedia": media_items(itinerary.media, lambda item: media_uri("itinerary", item.id, request)),
        "smartways:vocabularyMapping": mapping_terms("itinerary", itinerary.id),
        "smartways:semanticAnnotation": annotations_for("itinerary", itinerary.id),
        "dcterms:created": itinerary.created_at.isoformat() if itinerary.created_at else None,
        "dcterms:modified": itinerary.updated_at.isoformat() if itinerary.updated_at else None,
    }
    return drop_empty(data)


def route_jsonld(route, request=None):
    coordinates = route_coordinates(route)
    geometry = line_geometry(coordinates)
    stages = []
    for stage in route.stages.select_related("itinerary").prefetch_related("itinerary__translations").order_by("stage_number", "id"):
        stages.append(
            {
                "@id": entity_uri("route-stage", stage.id, request),
                "smartways:stageNumber": stage.stage_number,
                "smartways:itinerary": compact_translated_entity(stage.itinerary, "itinerary", request),
            }
        )
    data = {
        "@context": JSONLD_CONTEXT,
        "@id": entity_uri("route", route.id, request),
        "@type": ["crm:E73_Information_Object", "schema:TouristTrip"],
        "smartways:localId": route.id,
        "smartways:publicationState": "public" if route.enabled else "draft",
        "schema:name": translations_as_language_map(route.translations, "title"),
        "schema:description": translations_as_language_map(route.translations, "description"),
        "geojson:geometry": geometry,
        "smartways:stage": stages,
        "schema:associatedMedia": media_items(route.media, lambda item: media_uri("route", item.id, request)),
        "smartways:vocabularyMapping": mapping_terms("route", route.id),
        "smartways:semanticAnnotation": annotations_for("route", route.id),
        "dcterms:created": route.created_at.isoformat() if route.created_at else None,
        "dcterms:modified": route.updated_at.isoformat() if route.updated_at else None,
    }
    return drop_empty(data)


def dataset_jsonld(request=None, include_drafts=False):
    suffix = "all" if include_drafts else "public"
    return {
        "@context": JSONLD_CONTEXT,
        "@id": entity_uri("dataset", f"smartways-eccch-{suffix}", request),
        "@type": "dcat:Dataset",
        "dcterms:title": "SmartWays ECCCH export",
        "dcterms:description": "Routes, itineraries, points of interest, media, and semantic mappings exported from SmartWays.",
        "dcat:distribution": [
            {
                "@type": "dcat:Distribution",
                "dcterms:format": "application/ld+json",
                "dcat:accessURL": api_uri("/api/eccch/dataset.jsonld", request),
            },
            {
                "@type": "dcat:Distribution",
                "dcterms:format": "application/geo+json",
                "dcat:accessURL": api_uri("/api/eccch/pois.geojson", request),
            },
            {
                "@type": "dcat:Distribution",
                "dcterms:format": "application/zip",
                "dcat:accessURL": api_uri("/api/eccch/package.zip", request),
            },
        ],
        "smartways:routeCount": filtered_queryset(Route, include_drafts).count(),
        "smartways:itineraryCount": filtered_queryset(Itinerary, include_drafts).count(),
        "smartways:poiCount": filtered_queryset(POI, include_drafts).count(),
        "smartways:categoryCount": Category.objects.count(),
    }


def graph_jsonld(request=None, include_drafts=False):
    return {
        "@context": JSONLD_CONTEXT,
        "@graph": [
            dataset_jsonld(request, include_drafts),
            *[category_jsonld(category, request) for category in Category.objects.prefetch_related("translations")],
            *[poi_jsonld(poi, request) for poi in filtered_queryset(POI, include_drafts).prefetch_related("translations", "categories", "categories__translations", "media", "media__translations")],
            *[itinerary_jsonld(itinerary, request) for itinerary in filtered_queryset(Itinerary, include_drafts).prefetch_related("translations", "media", "media__translations", "route_stages", "route_stages__route", "route_stages__route__translations")],
            *[route_jsonld(route, request) for route in filtered_queryset(Route, include_drafts).prefetch_related("translations", "media", "media__translations", "stages", "stages__itinerary", "stages__itinerary__translations")],
        ],
    }


def filtered_queryset(model, include_drafts=False):
    queryset = model.objects.all()
    if not include_drafts and hasattr(model, "enabled"):
        queryset = queryset.filter(enabled=True)
    return queryset


def drop_empty(value):
    if isinstance(value, dict):
        return {
            key: drop_empty(item)
            for key, item in value.items()
            if item not in (None, "", [], {})
        }
    if isinstance(value, list):
        return [drop_empty(item) for item in value if item not in (None, "", [], {})]
    return value
