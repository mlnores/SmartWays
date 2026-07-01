from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    buffer_poi_lookup,
    CategoryTranslationViewSet,
    CategoryViewSet,
    POIImageViewSet,
    POITranslationViewSet,
    POIViewSet,
    mock_poi_lookup,
)


router = DefaultRouter()
router.register("pois", POIViewSet, basename="poi")
router.register("poi-translations", POITranslationViewSet, basename="poi-translation")
router.register("categories", CategoryViewSet, basename="category")
router.register("category-translations", CategoryTranslationViewSet, basename="category-translation")
router.register("poi-images", POIImageViewSet, basename="poi-image")

urlpatterns = [
    path("buffer-pois/", buffer_poi_lookup, name="buffer-poi-lookup"),
    path("mock-pois/", mock_poi_lookup, name="mock-poi-lookup"),
    *router.urls,
]
