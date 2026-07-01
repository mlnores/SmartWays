import json

from django.contrib.gis.geos import GEOSGeometry, Polygon
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
        .prefetch_related("translations", "images")
        .order_by("id")[:limit]
    )
    pois = [poi_for_buffer_response(poi, language) for poi in queryset]
    return cors_json_response({"results": pois})


mock_poi_lookup = buffer_poi_lookup


def poi_for_buffer_response(poi, language_code):
    translation = select_translation(poi.translations.all(), language_code)
    images = list(poi.images.all())
    primary_image = next((image for image in images if image.is_primary), None)
    image = primary_image or (images[0] if images else None)

    return {
        "id": str(poi.pk),
        "label": translation.title if translation else f"POI {poi.pk}",
        "snippet": translation.description if translation else "",
        "imageUrl": image.image_url if image else "",
        "lat": poi.gps_latitude,
        "lng": poi.gps_longitude,
        "website": poi.website,
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
