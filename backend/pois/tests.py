import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from django.contrib.gis.geos import Point
from django.utils import timezone
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .management.commands.import_rurallure_dump import Command, CountryBoundaryLookup
from .models import Category, CategoryTranslation, Itinerary, POI, POIImage, POITranslation, Route


class POIAPITests(APITestCase):
    def setUp(self):
        self.category = Category.objects.create(slug="heritage")
        CategoryTranslation.objects.create(
            category=self.category,
            language_code="en",
            name="Heritage",
        )
        CategoryTranslation.objects.create(
            category=self.category,
            language_code="es",
            name="Patrimonio",
        )

        self.poi = POI.objects.create(
            enabled=True,
            country_code="ES",
            location=Point(-8.7207, 42.2406, srid=4326),
            website="https://example.com/poi",
        )
        self.poi.categories.add(self.category)
        POITranslation.objects.create(
            poi=self.poi,
            language_code="en",
            title="Castle",
            description="A fortified place.",
            slug="castle",
        )
        POITranslation.objects.create(
            poi=self.poi,
            language_code="es",
            title="Castillo",
            description="Un lugar fortificado.",
            slug="castillo",
        )
        POIImage.objects.create(
            poi=self.poi,
            image_url="https://example.com/castle.jpg",
            position=1,
            is_primary=True,
        )

    def test_poi_list_returns_localized_content(self):
        response = self.client.get(reverse("poi-list"), {"language": "es"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        result = response.data["results"][0]
        self.assertEqual(result["title"], "Castillo")
        self.assertEqual(result["description"], "Un lugar fortificado.")
        self.assertEqual(result["slug"], "castillo")
        self.assertEqual(result["categories"][0]["name"], "Patrimonio")

    def test_poi_list_filters_by_category(self):
        response = self.client.get(reverse("poi-list"), {"category": "heritage"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_poi_list_searches_titles_and_categories(self):
        title_response = self.client.get(reverse("poi-list"), {"q": "cast"})
        category_response = self.client.get(reverse("poi-list"), {"q": "heritage"})

        self.assertEqual(title_response.status_code, status.HTTP_200_OK)
        self.assertEqual(title_response.data["count"], 1)
        self.assertEqual(title_response["Access-Control-Allow-Origin"], "*")
        self.assertEqual(category_response.status_code, status.HTTP_200_OK)
        self.assertEqual(category_response.data["count"], 1)

    def test_poi_list_filters_by_bbox(self):
        response = self.client.get(reverse("poi-list"), {"bbox": "-9,42,-8,43"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_poi_list_filters_by_country(self):
        response = self.client.get(reverse("poi-list"), {"country": "es"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["country_code"], "ES")

    def test_poi_countries_returns_distinct_country_codes(self):
        POI.objects.create(
            enabled=True,
            country_code="PT",
            location=Point(-8.6000, 42.1000, srid=4326),
        )
        POI.objects.create(
            enabled=True,
            country_code="",
            location=Point(-8.5000, 42.0000, srid=4326),
        )

        response = self.client.get(reverse("poi-countries"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], ["ES", "PT"])

    def test_poi_list_filters_by_ids(self):
        other_poi = POI.objects.create(
            enabled=True,
            location=Point(-8.6000, 42.1000, srid=4326),
        )
        POITranslation.objects.create(
            poi=other_poi,
            language_code="en",
            title="Other POI",
            description="Not requested.",
            slug="other-poi",
        )

        response = self.client.get(reverse("poi-list"), {"ids": str(self.poi.id)})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], self.poi.id)

    def test_buffer_poi_lookup_returns_enabled_pois_inside_buffer(self):
        disabled_poi = POI.objects.create(
            enabled=False,
            location=Point(-8.7100, 42.2500, srid=4326),
        )
        POITranslation.objects.create(
            poi=disabled_poi,
            language_code="en",
            title="Disabled POI",
            description="Should not be returned.",
            slug="disabled-poi",
        )
        outside_poi = POI.objects.create(
            enabled=True,
            location=Point(-7.5000, 43.0000, srid=4326),
        )
        POITranslation.objects.create(
            poi=outside_poi,
            language_code="en",
            title="Outside POI",
            description="Outside the buffer.",
            slug="outside-poi",
        )

        response = self.client.post(
            reverse("buffer-poi-lookup"),
            {
                "language": "en",
                "buffer": {
                    "type": "Polygon",
                    "coordinates": [[[-9, 42], [-8, 42], [-8, 43], [-9, 43], [-9, 42]]],
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()["results"]), 1)
        result = response.json()["results"][0]
        self.assertEqual(result["id"], str(self.poi.id))
        self.assertEqual(result["label"], "Castle")
        self.assertEqual(result["snippet"], "A fortified place.")
        self.assertEqual(result["imageUrl"], "https://example.com/castle.jpg")
        self.assertEqual(result["imageUrls"], ["https://example.com/castle.jpg"])
        self.assertEqual(result["lat"], self.poi.gps_latitude)
        self.assertEqual(result["lng"], self.poi.gps_longitude)
        self.assertEqual(result["categories"], [{"slug": "heritage", "name": "Heritage"}])

    def test_poi_create_accepts_coordinates_and_nested_content(self):
        payload = {
            "enabled": True,
            "country_code": "pt",
            "gps_latitude": 42.1,
            "gps_longitude": -8.6,
            "website": "https://example.com/new",
            "category_ids": [self.category.id],
            "translations": [
                {
                    "language_code": "en",
                    "title": "Viewpoint",
                    "description": "Open landscape views.",
                    "slug": "viewpoint",
                }
            ],
            "images": [
                {
                    "image_url": "https://example.com/viewpoint.jpg",
                    "position": 1,
                    "is_primary": True,
                }
            ],
        }

        response = self.client.post(reverse("poi-list"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        poi = POI.objects.get(id=response.data["id"])
        self.assertEqual(poi.country_code, "PT")
        self.assertEqual(poi.gps_latitude, 42.1)
        self.assertEqual(poi.gps_longitude, -8.6)
        self.assertEqual(poi.translations.count(), 1)
        self.assertEqual(poi.images.count(), 1)
        self.assertTrue(poi.translations.get(language_code="en").is_reference)

    def test_poi_create_rejects_multiple_reference_translations(self):
        response = self.client.post(
            reverse("poi-list"),
            {
                "enabled": True,
                "gps_latitude": 42.1,
                "gps_longitude": -8.6,
                "translations": [
                    {
                        "language_code": "en",
                        "title": "Viewpoint",
                        "description": "Open landscape views.",
                        "slug": "viewpoint",
                        "is_reference": True,
                    },
                    {
                        "language_code": "es",
                        "title": "Mirador",
                        "description": "Vistas abiertas.",
                        "slug": "mirador",
                        "is_reference": True,
                    },
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_country_boundary_lookup_uses_geojson_polygon(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"shapeName": "Spain"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-10, 35], [5, 35], [5, 45], [-10, 45], [-10, 35]]],
                    },
                }
            ],
        }
        with NamedTemporaryFile("w+", suffix=".geojson") as geojson_file:
            json.dump(payload, geojson_file)
            geojson_file.flush()
            lookup = CountryBoundaryLookup.from_geojson(
                Path(geojson_file.name),
                {"spain": "ES"},
            )

        self.assertEqual(lookup.country_code_for_point(Point(-8.7, 42.2, srid=4326)), "ES")

    def test_rurallure_import_merges_duplicate_categories_by_english_name(self):
        command = Command()
        categories_by_source_id, stats = command.import_categories(
            [{"id": "source-1"}, {"id": "source-2"}],
            [
                {"category_id": "source-1", "language_id": "lang-en", "description": "Castle"},
                {"category_id": "source-1", "language_id": "lang-es", "description": "Castillo"},
                {"category_id": "source-2", "language_id": "lang-en", "description": "Castle"},
                {"category_id": "source-2", "language_id": "lang-es", "description": "Castillo"},
            ],
            {"lang-en": "en", "lang-es": "es"},
            timezone.now(),
        )

        self.assertEqual(Category.objects.count(), 2)
        self.assertEqual(stats["categories_created"], 1)
        self.assertEqual(stats["categories_merged"], 1)
        self.assertEqual(categories_by_source_id["source-1"].pk, categories_by_source_id["source-2"].pk)
        self.assertEqual(
            set(CategoryTranslation.objects.filter(category=categories_by_source_id["source-1"]).values_list("language_code", "name")),
            {("en", "Castle"), ("es", "Castillo")},
        )

    def test_itinerary_create_accepts_json_and_translations(self):
        payload = {
            "enabled": True,
            "itinerary_json": {
                "savedAt": "2026-07-02T09:00:00Z",
                "points": [{"type": "poi", "id": str(self.poi.id)}],
                "segments": [],
            },
            "translations": [
                {
                    "language_code": "en",
                    "title": "Castle walk",
                    "description": "A short walk by the castle.",
                },
                {
                    "language_code": "es",
                    "title": "Paseo del castillo",
                    "description": "Un paseo breve junto al castillo.",
                },
            ],
        }

        response = self.client.post(reverse("itinerary-list"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        itinerary = Itinerary.objects.get(id=response.data["id"])
        self.assertEqual(itinerary.itinerary_json["points"][0]["id"], str(self.poi.id))
        self.assertEqual(itinerary.translations.count(), 2)
        self.assertEqual(itinerary.translations.get(language_code="en").slug, "castle-walk")
        self.assertEqual(itinerary.translations.get(language_code="es").slug, "paseo-del-castillo")
        self.assertTrue(itinerary.translations.get(language_code="en").is_reference)
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")

    def test_itinerary_create_requires_translation_title(self):
        response = self.client.post(
            reverse("itinerary-list"),
            {
                "enabled": True,
                "itinerary_json": {
                    "savedAt": "2026-07-02T09:00:00Z",
                    "points": [],
                    "segments": [],
                },
                "translations": [
                    {
                        "language_code": "en",
                        "title": "",
                        "description": "No title.",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_route_create_accepts_translations(self):
        response = self.client.post(
            reverse("route-list"),
            {
                "enabled": True,
                "translations": [
                    {
                        "language_code": "en",
                        "title": "Camino route",
                        "description": "A multi-stage route.",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        route = Route.objects.get(id=response.data["id"])
        self.assertEqual(route.translations.get(language_code="en").slug, "camino-route")
        self.assertTrue(route.translations.get(language_code="en").is_reference)

    def test_route_list_uses_reference_translation_without_language_filter(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(
            language_code="en",
            title="English route",
            description="English description.",
            slug="english-route",
        )
        route.translations.create(
            language_code="es",
            title="Ruta española",
            description="Descripción española.",
            slug="ruta-espanola",
            is_reference=True,
        )

        response = self.client.get(reverse("route-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"][0]["title"], "Ruta española")
        self.assertEqual(response.data["results"][0]["description"], "Descripción española.")

    def test_itinerary_can_be_route_stage(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )

        response = self.client.post(
            reverse("itinerary-list"),
            {
                "enabled": True,
                "route": route.id,
                "stage_number": 1,
                "itinerary_json": {
                    "savedAt": "2026-07-02T09:00:00Z",
                    "points": [],
                    "segments": [],
                },
                "translations": [
                    {
                        "language_code": "en",
                        "title": "Stage one",
                        "description": "First day.",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["route"], route.id)
        self.assertEqual(response.data["route_title"], "Camino route")
        self.assertEqual(response.data["route_slug"], "camino-route")
        self.assertEqual(response.data["stage_number"], 1)

        route_response = self.client.get(reverse("itinerary-list"), {"route": route.id})
        unassigned_response = self.client.get(reverse("itinerary-list"), {"route": "null"})
        self.assertEqual(route_response.data["count"], 1)
        self.assertEqual(unassigned_response.data["count"], 0)

    def test_route_reorders_itinerary_stages(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )
        first = Itinerary.objects.create(
            route=route,
            stage_number=1,
            itinerary_json={"points": [], "segments": []},
        )
        first.translations.create(language_code="en", title="First", slug="first")
        second = Itinerary.objects.create(
            route=route,
            stage_number=2,
            itinerary_json={"points": [], "segments": []},
        )
        second.translations.create(language_code="en", title="Second", slug="second")

        response = self.client.post(
            reverse("route-reorder-itineraries", args=[route.id]),
            {
                "itineraries": [
                    {"id": second.id, "stage_number": 1},
                    {"id": first.id, "stage_number": 2},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.stage_number, 2)
        self.assertEqual(second.stage_number, 1)

    def test_route_remove_itinerary_compacts_stages(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )
        first = Itinerary.objects.create(route=route, stage_number=1, itinerary_json={"points": [], "segments": []})
        first.translations.create(language_code="en", title="First", slug="first")
        second = Itinerary.objects.create(route=route, stage_number=2, itinerary_json={"points": [], "segments": []})
        second.translations.create(language_code="en", title="Second", slug="second")
        third = Itinerary.objects.create(route=route, stage_number=3, itinerary_json={"points": [], "segments": []})
        third.translations.create(language_code="en", title="Third", slug="third")

        response = self.client.post(
            reverse("route-remove-itinerary", args=[route.id]),
            {"itinerary": second.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(first.stage_number, 1)
        self.assertIsNone(second.route)
        self.assertIsNone(second.stage_number)
        self.assertEqual(third.stage_number, 2)

    def test_itinerary_list_returns_localized_content_and_searches(self):
        itinerary = Itinerary.objects.create(
            itinerary_json={
                "savedAt": "2026-07-02T09:00:00Z",
                "points": [],
                "segments": [],
            }
        )
        itinerary.translations.create(
            language_code="en",
            title="Castle walk",
            description="A short walk by the castle.",
            slug="castle-walk",
        )
        itinerary.translations.create(
            language_code="es",
            title="Paseo del castillo",
            description="Un paseo breve junto al castillo.",
            slug="paseo-castillo",
        )

        localized_response = self.client.get(reverse("itinerary-list"), {"language": "es"})
        search_response = self.client.get(reverse("itinerary-list"), {"q": "castle"})

        self.assertEqual(localized_response.status_code, status.HTTP_200_OK)
        self.assertEqual(localized_response.data["results"][0]["title"], "Paseo del castillo")
        self.assertEqual(search_response.status_code, status.HTTP_200_OK)
        self.assertEqual(search_response.data["count"], 1)
