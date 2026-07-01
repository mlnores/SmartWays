from rest_framework.routers import DefaultRouter

from .views import (
    CategoryTranslationViewSet,
    CategoryViewSet,
    POIImageViewSet,
    POITranslationViewSet,
    POIViewSet,
)


router = DefaultRouter()
router.register("pois", POIViewSet, basename="poi")
router.register("poi-translations", POITranslationViewSet, basename="poi-translation")
router.register("categories", CategoryViewSet, basename="category")
router.register("category-translations", CategoryTranslationViewSet, basename="category-translation")
router.register("poi-images", POIImageViewSet, basename="poi-image")

urlpatterns = router.urls
