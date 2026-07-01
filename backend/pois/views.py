from django.contrib.gis.geos import Polygon
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from .models import Category, CategoryTranslation, POI, POIImage, POITranslation
from .serializers import (
    CategorySerializer,
    CategoryTranslationSerializer,
    POIImageSerializer,
    POISerializer,
    POITranslationSerializer,
)


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
