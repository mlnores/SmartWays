from django.urls import path

from . import views


urlpatterns = [
    path("dataset.jsonld", views.dataset, name="eccch-dataset"),
    path("graph.jsonld", views.graph, name="eccch-graph"),
    path("package.zip", views.package, name="eccch-package"),
    path("pois.geojson", views.pois_collection, name="eccch-pois-geojson"),
    path("itineraries.geojson", views.itineraries_collection, name="eccch-itineraries-geojson"),
    path("routes.geojson", views.routes_collection, name="eccch-routes-geojson"),
    path("pois/<int:pk>.jsonld", views.poi_detail, name="eccch-poi-jsonld"),
    path("itineraries/<int:pk>.jsonld", views.itinerary_detail, name="eccch-itinerary-jsonld"),
    path("routes/<int:pk>.jsonld", views.route_detail, name="eccch-route-jsonld"),
    path("pois/<int:pk>.geojson", views.poi_geojson, name="eccch-poi-geojson"),
    path("itineraries/<int:pk>.geojson", views.itinerary_geojson, name="eccch-itinerary-geojson"),
    path("routes/<int:pk>.geojson", views.route_geojson, name="eccch-route-geojson"),
]

