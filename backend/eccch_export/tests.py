from django.contrib.gis.geos import Point
from django.test import TestCase

from pois.models import Category, CategoryTranslation, Itinerary, ItineraryTranslation, POI, POITranslation, Route, RouteStage, RouteTranslation


class EccchExportApiTests(TestCase):
    def setUp(self):
        category = Category.objects.create(slug="chapel")
        CategoryTranslation.objects.create(category=category, language_code="en", name="Chapel")
        self.poi = POI.objects.create(enabled=True, country_code="ES", location=Point(-8.1, 42.1, srid=4326))
        self.poi.categories.add(category)
        POITranslation.objects.create(
            poi=self.poi,
            language_code="en",
            title="Test Chapel",
            description="A chapel near the route.",
            slug="test-chapel",
            is_reference=True,
        )
        self.itinerary = Itinerary.objects.create(
            enabled=True,
            itinerary_json={
                "points": [
                    {"type": "poi", "poiId": self.poi.id, "lat": 42.1, "lng": -8.1},
                    {"type": "waypoint", "lat": 42.2, "lng": -8.2},
                ],
                "segments": [
                    {
                        "selectedWalkingRoute": {
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [[-8.1, 42.1], [-8.2, 42.2]],
                            }
                        }
                    }
                ],
            },
        )
        ItineraryTranslation.objects.create(
            itinerary=self.itinerary,
            language_code="en",
            title="Test itinerary",
            description="A route stage.",
            slug="test-itinerary",
            is_reference=True,
        )
        self.route = Route.objects.create(enabled=True)
        RouteTranslation.objects.create(
            route=self.route,
            language_code="en",
            title="Test route",
            description="A full route.",
            slug="test-route",
            is_reference=True,
        )
        RouteStage.objects.create(route=self.route, itinerary=self.itinerary, stage_number=1)

    def test_poi_jsonld_endpoint(self):
        response = self.client.get(f"/api/eccch/pois/{self.poi.id}.jsonld")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/ld+json; charset=utf-8")
        payload = response.json()
        self.assertEqual(payload["@type"], ["crm:E53_Place", "schema:Place"])
        self.assertEqual(payload["schema:name"][0]["@value"], "Test Chapel")
        self.assertEqual(payload["geojson:geometry"]["coordinates"], [-8.1, 42.1])

    def test_routes_geojson_endpoint(self):
        response = self.client.get("/api/eccch/routes.geojson")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertEqual(len(payload["features"]), 1)
        self.assertEqual(payload["features"][0]["geometry"]["type"], "LineString")

