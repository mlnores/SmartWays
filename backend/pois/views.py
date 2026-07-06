import json
from functools import lru_cache
from pathlib import Path

from django.contrib.gis.geos import GEOSGeometry, Polygon
from django.db import transaction
from django.http import JsonResponse
from django.db.models import Q
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ParseError, ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.response import Response

from .country_codes import alpha3_to_alpha2
from .models import Category, CategoryTranslation, Itinerary, ItineraryTranslation, POI, POIImage, POITranslation, Route, RouteStage, RouteTranslation
from .serializers import (
    CategorySerializer,
    CategoryTranslationSerializer,
    ItinerarySerializer,
    ItineraryTranslationSerializer,
    POIImageSerializer,
    POISerializer,
    POITranslationSerializer,
    RouteSerializer,
    RouteTranslationSerializer,
    select_translation,
)

COUNTRY_BOUNDARIES_PATH = Path(__file__).resolve().parent / "data" / "geoboundaries_adm0.geojson"
COUNTRY_CODE_PROPERTY_NAMES = (
    "ISO_A2",
    "iso_a2",
    "country_code",
    "COUNTRY_CODE",
    "code",
    "shapeISO",
    "shapeGroup",
    "ISO_A3",
    "iso_a3",
    "ADM0_A3",
)
COUNTRY_BOUNDS_OVERRIDES = {
    # Keep map previews focused on the regions users expect here, not overseas territories.
    "AU": [[-43.75, 112.90], [-10.00, 153.70]],
    "CL": [[-56.00, -75.75], [-17.50, -66.40]],
    "DK": [[54.45, 7.70], [57.85, 15.25]],
    "EC": [[-5.05, -81.10], [1.70, -75.10]],
    "GB": [[49.85, -8.65], [60.86, 1.78]],
    "FR": [[41.30, -5.15], [51.10, 9.57]],
    "NO": [[57.95, 4.50], [71.20, 31.20]],
}
FULL_COUNTRY_BOUNDS_OVERRIDES = {
    # geoBoundaries lists Greenland separately as GL; use the broader Danish realm only for fallback.
    "DK": [[54.45, -73.10], [83.65, 15.25]],
}


def country_code_from_boundary_properties(properties):
    for property_name in COUNTRY_CODE_PROPERTY_NAMES:
        value = (properties.get(property_name) or "").strip().upper()
        if len(value) == 2 and value.isalpha():
            return value
        if len(value) == 3:
            code = alpha3_to_alpha2(value)
            if code:
                return code
    return ""


@lru_cache(maxsize=1)
def country_bounds_by_code():
    if not COUNTRY_BOUNDARIES_PATH.exists():
        return {}

    with COUNTRY_BOUNDARIES_PATH.open(encoding="utf-8") as geojson_file:
        payload = json.load(geojson_file)

    raw_features = payload.get("features") if payload.get("type") == "FeatureCollection" else [payload]
    bounds = {}
    for feature in raw_features or []:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        country_code = country_code_from_boundary_properties(properties)
        if not country_code or not geometry:
            continue

        boundary = GEOSGeometry(json.dumps(geometry), srid=4326)
        if boundary.empty:
            continue

        min_lon, min_lat, max_lon, max_lat = boundary.extent
        bounds[country_code] = [[min_lat, min_lon], [max_lat, max_lon]]
    bounds.update(FULL_COUNTRY_BOUNDS_OVERRIDES)
    return bounds


def point_inside_bounds(latitude, longitude, bounds):
    (min_lat, min_lon), (max_lat, max_lon) = bounds
    return min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon


def focused_or_full_country_bounds(country_code, latitude=None, longitude=None):
    full_bounds = country_bounds_by_code().get(country_code)
    focused_bounds = COUNTRY_BOUNDS_OVERRIDES.get(country_code)
    if not full_bounds:
        return None
    if not focused_bounds:
        return full_bounds
    if latitude is not None and longitude is not None and not point_inside_bounds(latitude, longitude, focused_bounds):
        return full_bounds
    return focused_bounds


def cors_json_response(data, status=200):
    response = JsonResponse(data, status=status)
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def buffer_geometry_from_geojson(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("Buffer geometry must be a GeoJSON object.")

    if geometry.get("type") == "Feature":
        geometry = geometry.get("geometry")

    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Buffer geometry must be a Polygon or MultiPolygon.")

    buffer_geometry = GEOSGeometry(json.dumps(geometry), srid=4326)
    if buffer_geometry.empty:
        raise ValueError("Buffer geometry must not be empty.")
    return buffer_geometry


@csrf_exempt
def buffer_poi_lookup(request):
    if request.method == "OPTIONS":
        return cors_json_response({})

    if request.method != "POST":
        return cors_json_response({"detail": "Use POST."}, status=405)

    try:
        payload = JSONParser().parse(request)
        buffer_geometry = buffer_geometry_from_geojson(payload.get("buffer"))
        language = payload.get("language") or payload.get("lang")
        limit = int(payload.get("limit") or payload.get("count") or 100)
        if limit < 1 or limit > 200:
            raise ValueError("Limit must be between 1 and 200.")
    except (ParseError, TypeError, ValueError) as error:
        return cors_json_response({"detail": str(error)}, status=400)

    queryset = (
        POI.objects.filter(enabled=True, location__within=buffer_geometry)
        .prefetch_related("translations", "images", "categories", "categories__translations")
        .order_by("id")[:limit]
    )
    pois = [poi_for_buffer_response(poi, language) for poi in queryset]
    return cors_json_response({"results": pois})


mock_poi_lookup = buffer_poi_lookup


def poi_for_buffer_response(poi, language_code):
    translation = select_translation(poi.translations.all(), language_code)
    images = list(poi.images.all())
    categories = list(poi.categories.all())
    primary_image = next((image for image in images if image.is_primary), None)
    image = primary_image or (images[0] if images else None)
    image_urls = [image.image_url for image in images]

    return {
        "id": str(poi.pk),
        "label": translation.title if translation else f"POI {poi.pk}",
        "snippet": translation.description if translation else "",
        "imageUrl": image.image_url if image else "",
        "imageUrls": image_urls,
        "lat": poi.gps_latitude,
        "lng": poi.gps_longitude,
        "website": poi.website,
        "categories": [
            {
                "slug": category.slug,
                "name": category_display_name(category, language_code),
            }
            for category in categories
        ],
    }


def parse_bbox(value):
    try:
        min_lon, min_lat, max_lon, max_lat = [float(part) for part in value.split(",")]
    except (TypeError, ValueError):
        raise ValidationError({"bbox": "Use bbox=min_lon,min_lat,max_lon,max_lat."})

    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValidationError({"bbox": "Minimum coordinates must be lower than maximum coordinates."})
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise ValidationError({"bbox": "Longitude values must be between -180 and 180."})
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise ValidationError({"bbox": "Latitude values must be between -90 and 90."})

    return Polygon.from_bbox((min_lon, min_lat, max_lon, max_lat))


def category_display_name(category, language_code):
    translation = select_translation(category.translations.all(), language_code)
    return translation.name if translation else category.slug


class LanguageContextMixin:
    def get_language(self):
        return self.request.query_params.get("language") or self.request.query_params.get("lang")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["language"] = self.get_language()
        return context

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type"
        return response


class POIViewSet(LanguageContextMixin, viewsets.ModelViewSet):
    serializer_class = POISerializer

    def get_queryset(self):
        queryset = (
            POI.objects.all()
            .prefetch_related(
                "translations",
                "images",
                "categories",
                "categories__translations",
            )
            .distinct()
        )

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        country = (self.request.query_params.get("country") or self.request.query_params.get("country_code") or "").strip()
        if country:
            if len(country) != 2 or not country.isalpha():
                raise ValidationError({"country": "Use a two-letter ISO 3166-1 alpha-2 country code."})
            queryset = queryset.filter(country_code=country.upper())

        ids = (self.request.query_params.get("ids") or "").strip()
        if ids:
            try:
                poi_ids = [int(value) for value in ids.split(",") if value.strip()]
            except ValueError:
                raise ValidationError({"ids": "Use a comma-separated list of POI ids."})
            queryset = queryset.filter(id__in=poi_ids)

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        category = self.request.query_params.get("category")
        if category:
            if category.isdigit():
                queryset = queryset.filter(categories__id=int(category))
            else:
                queryset = queryset.filter(categories__slug=category)

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(categories__slug__icontains=query)
                | Q(categories__translations__name__icontains=query)
            )

        bbox = self.request.query_params.get("bbox")
        if bbox:
            queryset = queryset.filter(location__within=parse_bbox(bbox))

        return queryset.distinct()

    @action(detail=False, methods=["get"])
    def countries(self, request):
        country_codes = (
            POI.objects.exclude(country_code="")
            .order_by("country_code")
            .values_list("country_code", flat=True)
            .distinct()
        )
        return Response({"results": list(country_codes)})

    @action(detail=False, methods=["get"], url_path="country-bounds")
    def country_bounds(self, request):
        country = (request.query_params.get("country") or request.query_params.get("country_code") or "").strip().upper()
        if len(country) != 2 or not country.isalpha():
            raise ValidationError({"country": "Use a two-letter ISO 3166-1 alpha-2 country code."})

        latitude = None
        longitude = None
        lat_value = request.query_params.get("lat")
        lng_value = request.query_params.get("lng")
        if lat_value is not None or lng_value is not None:
            try:
                latitude = float(lat_value)
                longitude = float(lng_value)
            except (TypeError, ValueError):
                raise ValidationError({"coordinates": "Use numeric lat and lng query parameters."})

            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValidationError({"coordinates": "Latitude must be between -90 and 90; longitude between -180 and 180."})

        bounds = focused_or_full_country_bounds(country, latitude, longitude)
        if not bounds:
            raise ValidationError({"country": f"No country bounds are available for {country}."})

        return Response({"country": country, "bounds": bounds})


class POITranslationViewSet(viewsets.ModelViewSet):
    serializer_class = POITranslationSerializer
    queryset = POITranslation.objects.select_related("poi").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        poi_id = self.request.query_params.get("poi")

        if language:
            queryset = queryset.filter(language_code=language)
        if poi_id:
            queryset = queryset.filter(poi_id=poi_id)

        return queryset


class ItineraryViewSet(LanguageContextMixin, viewsets.ModelViewSet):
    serializer_class = ItinerarySerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        route = self.request.query_params.get("route")
        if route and route.isdigit():
            context["route_id"] = int(route)
        return context

    def get_queryset(self):
        queryset = Itinerary.objects.prefetch_related(
            "translations",
            "route_stages",
            "route_stages__route",
            "route_stages__route__translations",
        ).distinct()

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        route = self.request.query_params.get("route")
        if route:
            if route.lower() in {"none", "null", "unassigned"}:
                queryset = queryset.filter(route_stages__isnull=True)
            elif route.isdigit():
                queryset = queryset.filter(route_stages__route_id=int(route)).order_by("route_stages__stage_number", "id")
            else:
                raise ValidationError({"route": "Use a route id or null."})

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(translations__description__icontains=query)
                | Q(translations__slug__icontains=query)
            )

        return queryset.distinct()


class RouteViewSet(LanguageContextMixin, viewsets.ModelViewSet):
    serializer_class = RouteSerializer

    def get_queryset(self):
        queryset = Route.objects.prefetch_related(
            "translations",
            "stages",
            "stages__itinerary",
            "stages__itinerary__translations",
        ).distinct()

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(translations__description__icontains=query)
                | Q(translations__slug__icontains=query)
            )

        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="reorder-itineraries")
    def reorder_itineraries(self, request, pk=None):
        route = self.get_object()
        raw_items = request.data.get("itineraries")
        if not isinstance(raw_items, list) or not raw_items:
            raise ValidationError({"itineraries": "Provide a non-empty list of itinerary stage assignments."})

        assignments = []
        seen_ids = set()
        seen_stages = set()
        for item in raw_items:
            if not isinstance(item, dict):
                raise ValidationError({"itineraries": "Each assignment must be an object."})
            itinerary_id = item.get("id")
            stage_number = item.get("stage_number")
            if not isinstance(itinerary_id, int) or not isinstance(stage_number, int):
                raise ValidationError({"itineraries": "Each assignment needs integer id and stage_number values."})
            if stage_number < 1:
                raise ValidationError({"stage_number": "Stage numbers must be positive."})
            if itinerary_id in seen_ids:
                raise ValidationError({"itineraries": "Itinerary ids must not repeat."})
            if stage_number in seen_stages:
                raise ValidationError({"stage_number": "Stage numbers must not repeat."})
            seen_ids.add(itinerary_id)
            seen_stages.add(stage_number)
            assignments.append((itinerary_id, stage_number))

        with transaction.atomic():
            route_stages = {
                stage.itinerary_id: stage
                for stage in route.stages.select_for_update().filter(itinerary_id__in=seen_ids)
            }
            missing_ids = seen_ids - set(route_stages)
            if missing_ids:
                raise ValidationError({"itineraries": "All itineraries must belong to this route."})

            temporary_offset = 1000000
            for index, (itinerary_id, _) in enumerate(assignments, start=1):
                stage = route_stages[itinerary_id]
                stage.stage_number = temporary_offset + index
                stage.save(update_fields=["stage_number", "updated_at"])

            for itinerary_id, stage_number in assignments:
                stage = route_stages[itinerary_id]
                stage.stage_number = stage_number
                stage.save(update_fields=["stage_number", "updated_at"])

        queryset = (
            Itinerary.objects.filter(route_stages__route=route)
            .prefetch_related("translations", "route_stages", "route_stages__route", "route_stages__route__translations")
            .order_by("route_stages__stage_number", "id")
        )
        context = self.get_serializer_context()
        context["route_id"] = route.id
        serializer = ItinerarySerializer(queryset, many=True, context=context)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="remove-itinerary")
    def remove_itinerary(self, request, pk=None):
        route = self.get_object()
        itinerary_id = request.data.get("itinerary")
        if not isinstance(itinerary_id, int):
            raise ValidationError({"itinerary": "Provide an itinerary id."})

        with transaction.atomic():
            route_stage = route.stages.select_for_update().select_related("itinerary").filter(itinerary_id=itinerary_id).first()
            if route_stage is None:
                raise ValidationError({"itinerary": "Itinerary does not belong to this route."})

            itinerary = route_stage.itinerary
            route_stage.delete()

            remaining_stages = list(
                route.stages.select_for_update()
                .order_by("stage_number", "id")
            )
            temporary_offset = 1000000
            for index, remaining in enumerate(remaining_stages, start=1):
                remaining.stage_number = temporary_offset + index
                remaining.save(update_fields=["stage_number", "updated_at"])

            for index, remaining in enumerate(remaining_stages, start=1):
                remaining.stage_number = index
                remaining.save(update_fields=["stage_number", "updated_at"])

        serializer = ItinerarySerializer(itinerary, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)


class RouteTranslationViewSet(viewsets.ModelViewSet):
    serializer_class = RouteTranslationSerializer
    queryset = RouteTranslation.objects.select_related("route").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        route_id = self.request.query_params.get("route")

        if language:
            queryset = queryset.filter(language_code=language)
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        return queryset


class ItineraryTranslationViewSet(viewsets.ModelViewSet):
    serializer_class = ItineraryTranslationSerializer
    queryset = ItineraryTranslation.objects.select_related("itinerary").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        itinerary_id = self.request.query_params.get("itinerary")

        if language:
            queryset = queryset.filter(language_code=language)
        if itinerary_id:
            queryset = queryset.filter(itinerary_id=itinerary_id)

        return queryset


class CategoryViewSet(LanguageContextMixin, viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.prefetch_related("translations").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.get_language()

        if language:
            queryset = queryset.filter(translations__language_code=language)

        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        source = self.get_object()
        target_id = request.data.get("target")
        if not target_id:
            raise ValidationError({"target": "Select the category to merge into."})

        try:
            target = Category.objects.get(pk=target_id)
        except Category.DoesNotExist as exc:
            raise ValidationError({"target": "Target category does not exist."}) from exc

        if source.pk == target.pk:
            raise ValidationError({"target": "Choose a different target category."})

        with transaction.atomic():
            for poi in source.pois.all():
                poi.categories.add(target)
            source.delete()

        serializer = self.get_serializer(target)
        return Response(serializer.data)


class CategoryTranslationViewSet(viewsets.ModelViewSet):
    serializer_class = CategoryTranslationSerializer
    queryset = CategoryTranslation.objects.select_related("category").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        category_id = self.request.query_params.get("category")

        if language:
            queryset = queryset.filter(language_code=language)
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        return queryset


class POIImageViewSet(viewsets.ModelViewSet):
    serializer_class = POIImageSerializer
    queryset = POIImage.objects.select_related("poi").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        poi_id = self.request.query_params.get("poi")

        if poi_id:
            queryset = queryset.filter(poi_id=poi_id)

        return queryset
