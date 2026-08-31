from pois.models import Itinerary, POI, Route

from .common import reference_translation
from .geometry import geometry_as_geojson, itinerary_coordinates, line_geometry, point_coordinates, route_coordinates
from .identifiers import entity_uri
from .jsonld import filtered_queryset


def poi_feature(poi, request=None):
    coordinates = point_coordinates(poi.location)
    if not coordinates:
        return None
    translation = reference_translation(poi)
    footprint = geometry_as_geojson(poi.footprint)
    return {
        "type": "Feature",
        "id": entity_uri("poi", poi.id, request),
        "geometry": {"type": "Point", "coordinates": coordinates},
        "properties": {
            "id": poi.id,
            "title": translation.title if translation else str(poi),
            "description": translation.description if translation else "",
            "country_code": poi.country_code,
            "enabled": poi.enabled,
            "categories": [category.slug for category in poi.categories.all()],
            "footprint": footprint,
        },
    }


def itinerary_feature(itinerary, request=None):
    geometry = line_geometry(itinerary_coordinates(itinerary))
    if not geometry:
        return None
    translation = reference_translation(itinerary)
    return {
        "type": "Feature",
        "id": entity_uri("itinerary", itinerary.id, request),
        "geometry": geometry,
        "properties": {
            "id": itinerary.id,
            "title": translation.title if translation else str(itinerary),
            "description": translation.description if translation else "",
            "enabled": itinerary.enabled,
        },
    }


def route_feature(route, request=None):
    geometry = line_geometry(route_coordinates(route))
    if not geometry:
        return None
    translation = reference_translation(route)
    return {
        "type": "Feature",
        "id": entity_uri("route", route.id, request),
        "geometry": geometry,
        "properties": {
            "id": route.id,
            "title": translation.title if translation else str(route),
            "description": translation.description if translation else "",
            "enabled": route.enabled,
            "stage_count": route.stages.count(),
        },
    }


def feature_collection(features):
    return {
        "type": "FeatureCollection",
        "features": [feature for feature in features if feature],
    }


def pois_geojson(request=None, include_drafts=False):
    queryset = filtered_queryset(POI, include_drafts).prefetch_related("translations", "categories")
    return feature_collection(poi_feature(poi, request) for poi in queryset)


def itineraries_geojson(request=None, include_drafts=False):
    queryset = filtered_queryset(Itinerary, include_drafts).prefetch_related("translations")
    return feature_collection(itinerary_feature(itinerary, request) for itinerary in queryset)


def routes_geojson(request=None, include_drafts=False):
    queryset = filtered_queryset(Route, include_drafts).prefetch_related("translations", "stages", "stages__itinerary")
    return feature_collection(route_feature(route, request) for route in queryset)
