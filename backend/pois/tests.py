from django.contrib.gis.geos import Point
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Category, CategoryTranslation, POI, POIImage, POITranslation


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
