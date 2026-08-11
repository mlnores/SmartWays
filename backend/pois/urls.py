from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    buffer_poi_lookup,
    CategoryTranslationViewSet,
    CategoryViewSet,
    csrf_token,
    change_password_view,
    current_user_view,
    ItineraryTranslationViewSet,
    ItineraryMediaViewSet,
    ItineraryViewSet,
    login_view,
    logout_view,
    POIMediaViewSet,
    POITranslationViewSet,
    POIViewSet,
    RouteTranslationViewSet,
    RouteMediaViewSet,
    RouteViewSet,
    UserViewSet,
    mock_poi_lookup,
)


router = DefaultRouter()
router.register("pois", POIViewSet, basename="poi")
router.register("poi-translations", POITranslationViewSet, basename="poi-translation")
router.register("categories", CategoryViewSet, basename="category")
router.register("category-translations", CategoryTranslationViewSet, basename="category-translation")
router.register("poi-media", POIMediaViewSet, basename="poi-media")
router.register("poi-images", POIMediaViewSet, basename="poi-image")
router.register("routes", RouteViewSet, basename="route")
router.register("route-media", RouteMediaViewSet, basename="route-media")
router.register("route-translations", RouteTranslationViewSet, basename="route-translation")
router.register("itineraries", ItineraryViewSet, basename="itinerary")
router.register("itinerary-media", ItineraryMediaViewSet, basename="itinerary-media")
router.register("itinerary-translations", ItineraryTranslationViewSet, basename="itinerary-translation")
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/csrf/", csrf_token, name="auth-csrf"),
    path("auth/login/", login_view, name="auth-login"),
    path("auth/logout/", logout_view, name="auth-logout"),
    path("auth/me/", current_user_view, name="auth-me"),
    path("auth/change-password/", change_password_view, name="auth-change-password"),
    path("buffer-pois/", buffer_poi_lookup, name="buffer-poi-lookup"),
    path("mock-pois/", mock_poi_lookup, name="mock-poi-lookup"),
    *router.urls,
]
