import random
import time
from urllib.parse import quote

from django.contrib.gis.geos import Polygon
from django.core.paginator import Paginator
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets
from rest_framework.exceptions import ParseError, ValidationError
from rest_framework.parsers import JSONParser

from .models import Category, CategoryTranslation, POI, POIImage, POITranslation
from .serializers import (
    CategorySerializer,
    CategoryTranslationSerializer,
    POIImageSerializer,
    POISerializer,
    POITranslationSerializer,
    select_translation,
)


MOCK_POI_IMAGE_SVG = (
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"144\" height=\"108\">"
    "<rect width=\"144\" height=\"108\" fill=\"#dcfce7\"/>"
    "<circle cx=\"72\" cy=\"44\" r=\"22\" fill=\"#16a34a\"/>"
    "<text x=\"72\" y=\"86\" text-anchor=\"middle\" font-family=\"Arial\" "
    "font-size=\"16\" font-weight=\"700\" fill=\"#166534\">POI</text>"
    "</svg>"
)


def cors_json_response(data, status=200):
    response = JsonResponse(data, status=status)
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def polygon_rings_from_geojson(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("Buffer geometry must be a GeoJSON object.")

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Feature":
        return polygon_rings_from_geojson(geometry.get("geometry"))

    if geometry_type == "Polygon" and coordinates:
        return coordinates[0]

    if geometry_type == "MultiPolygon" and coordinates and coordinates[0]:
        return coordinates[0][0]

    raise ValueError("Buffer geometry must be a Polygon or MultiPolygon.")


def point_in_ring(lng, lat, ring):
    inside = False
    previous_lng, previous_lat = ring[-1]

    for current_lng, current_lat in ring:
        crosses_latitude = (current_lat > lat) != (previous_lat > lat)
        if crosses_latitude:
            crossing_lng = (
                (previous_lng - current_lng)
                * (lat - current_lat)
                / (previous_lat - current_lat)
                + current_lng
            )
            if lng < crossing_lng:
                inside = not inside

        previous_lng, previous_lat = current_lng, current_lat

    return inside


def random_points_in_ring(ring, count):
    lngs = [coordinate[0] for coordinate in ring]
    lats = [coordinate[1] for coordinate in ring]
    min_lng, max_lng = min(lngs), max(lngs)
    min_lat, max_lat = min(lats), max(lats)
    points = []
    attempts = 0

    while len(points) < count and attempts < 300:
        lng = random.uniform(min_lng, max_lng)
        lat = random.uniform(min_lat, max_lat)
        if point_in_ring(lng, lat, ring):
            points.append((lat, lng))
        attempts += 1

    return points


@csrf_exempt
def mock_poi_lookup(request):
    if request.method == "OPTIONS":
        return cors_json_response({})

    if request.method != "POST":
        return cors_json_response({"detail": "Use POST."}, status=405)

    try:
        payload = JSONParser().parse(request)
        ring = polygon_rings_from_geojson(payload.get("buffer"))
        count = int(payload.get("count", 2))
        if count < 1 or count > 10:
            raise ValueError("Count must be between 1 and 10.")
        segment_index = payload.get("segmentIndex")
        points = random_points_in_ring(ring, count)
    except (ParseError, TypeError, ValueError) as error:
        return cors_json_response({"detail": str(error)}, status=400)

    if len(points) < count:
        return cors_json_response(
            {"detail": "Could not create random POIs inside this segment buffer."},
            status=422,
        )

    image_url = f"data:image/svg+xml,{quote(MOCK_POI_IMAGE_SVG)}"
    timestamp = int(time.time() * 1000)
    pois = [
        {
            "id": f"mock-poi-{timestamp}-{index + 1}",
            "label": f"Temporary POI {index + 1}",
            "snippet": (
                "Mock point of interest returned for the current buffer region"
                f"{f' near segment {segment_index + 1}' if isinstance(segment_index, int) else ''}."
            ),
            "imageUrl": image_url,
            "lat": lat,
            "lng": lng,
        }
        for index, (lat, lng) in enumerate(points)
    ]

    return cors_json_response({"results": pois})


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


def poi_display_title(poi, language_code):
    translation = select_translation(poi.translations.all(), language_code)
    return translation.title if translation else f"POI {poi.pk}"


def category_display_name(category, language_code):
    translation = select_translation(category.translations.all(), language_code)
    return translation.name if translation else category.slug


def poi_browser(request):
    language = request.GET.get("language") or request.GET.get("lang") or "en"
    query = (request.GET.get("q") or "").strip()
    selected_id = request.GET.get("poi")

    poi_queryset = POI.objects.prefetch_related("translations").order_by("id")
    if query:
        poi_queryset = poi_queryset.filter(translations__title__icontains=query).distinct()

    paginator = Paginator(poi_queryset, 100)
    page_obj = paginator.get_page(request.GET.get("page"))
    page_pois = list(page_obj.object_list)

    if selected_id:
        selected_poi = (
            POI.objects.prefetch_related(
                "translations",
                "images",
                "categories",
                "categories__translations",
            )
            .filter(pk=selected_id)
            .first()
        )
    else:
        selected_poi = page_pois[0] if page_pois else None
        if selected_poi:
            selected_poi = (
                POI.objects.prefetch_related(
                    "translations",
                    "images",
                    "categories",
                    "categories__translations",
                )
                .filter(pk=selected_poi.pk)
                .first()
            )

    selected_translation = select_translation(selected_poi.translations.all(), language) if selected_poi else None
    selected_categories = []
    if selected_poi:
        selected_categories = [
            {
                "slug": category.slug,
                "name": category_display_name(category, language),
            }
            for category in selected_poi.categories.all()
        ]

    context = {
        "language": language,
        "query": query,
        "page_obj": page_obj,
        "paginator": paginator,
        "page_pois": [
            {
                "id": poi.pk,
                "title": poi_display_title(poi, language),
                "latitude": poi.gps_latitude,
                "longitude": poi.gps_longitude,
                "enabled": poi.enabled,
            }
            for poi in page_pois
        ],
        "selected_poi": selected_poi,
        "selected_translation": selected_translation,
        "selected_categories": selected_categories,
        "selected_images": list(selected_poi.images.all()) if selected_poi else [],
        "selected_translations": list(selected_poi.translations.all()) if selected_poi else [],
    }
    return render(request, "pois/poi_browser.html", context)


class LanguageContextMixin:
    def get_language(self):
        return self.request.query_params.get("language") or self.request.query_params.get("lang")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["language"] = self.get_language()
        return context


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

        language = self.get_language()
        if language:
            queryset = queryset.filter(translations__language_code=language)

        category = self.request.query_params.get("category")
        if category:
            if category.isdigit():
                queryset = queryset.filter(categories__id=int(category))
            else:
                queryset = queryset.filter(categories__slug=category)

        bbox = self.request.query_params.get("bbox")
        if bbox:
            queryset = queryset.filter(location__within=parse_bbox(bbox))

        return queryset


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


class CategoryViewSet(LanguageContextMixin, viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.prefetch_related("translations").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.get_language()

        if language:
            queryset = queryset.filter(translations__language_code=language)

        return queryset.distinct()


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
