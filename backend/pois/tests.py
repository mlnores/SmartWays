from django.contrib.gis.geos import Point
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

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
        self.assertEqual(poi.gps_latitude, 42.1)
        self.assertEqual(poi.gps_longitude, -8.6)
        self.assertEqual(poi.translations.count(), 1)
        self.assertEqual(poi.images.count(), 1)

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
