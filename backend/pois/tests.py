import json
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from types import SimpleNamespace

from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .management.commands.import_rurallure_dump import COPY_TABLES, Command, CountryBoundaryLookup
from .management.commands.import_rurallure_dump_near_itineraries import (
    Command as NearbyPOIImportCommand,
    CURATED_DUMP_POI_MERGES,
    ExistingPoiDistanceIndex,
    ItineraryDistanceIndex,
)
from .management.commands.rurallure_import_romea_strata_official_with_pois import (
    Command as RomeaOfficialWithPoisCommand,
)
from .models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryMedia,
    POI,
    POIMedia,
    POITranslation,
    Route,
    RouteMedia,
    RouteStage,
    RouteTranslation,
)


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
            phone="+34 000 000 000",
            email="info@example.com",
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
        POIMedia.objects.create(
            poi=self.poi,
            media_type=POIMedia.MediaType.IMAGE,
            url="https://example.com/castle.jpg",
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

    def test_poi_map_returns_individual_pois_for_small_result_sets(self):
        response = self.client.get(reverse("poi-map"), {"bbox": "-9,42,-8,43"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["mode"], "pois")
        self.assertEqual(response.data["results"][0]["type"], "poi")
        self.assertEqual(response.data["results"][0]["poi"]["title"], "Castle")

    def test_poi_map_returns_clusters_when_result_set_exceeds_limit(self):
        POI.objects.create(
            enabled=True,
            country_code="ES",
            location=Point(-8.6000, 42.1000, srid=4326),
        )

        response = self.client.get(reverse("poi-map"), {
            "bbox": "-9,42,-8,43",
            "individual_limit": "1",
            "cluster_limit": "4",
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["mode"], "clusters")
        self.assertEqual(response.data["results"][0]["type"], "cluster")
        self.assertGreaterEqual(response.data["results"][0]["count"], 1)

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

    def test_poi_country_bounds_returns_leaflet_bounds(self):
        response = self.client.get(reverse("poi-country-bounds"), {"country": "es"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["country"], "ES")
        self.assertEqual(len(response.data["bounds"]), 2)
        self.assertLess(response.data["bounds"][0][0], response.data["bounds"][1][0])
        self.assertLess(response.data["bounds"][0][1], response.data["bounds"][1][1])

    def test_poi_country_bounds_uses_european_overrides(self):
        cases = {
            "AU": [[-43.75, 112.90], [-10.00, 153.70]],
            "CL": [[-56.00, -75.75], [-17.50, -66.40]],
            "DK": [[54.45, 7.70], [57.85, 15.25]],
            "EC": [[-5.05, -81.10], [1.70, -75.10]],
            "GB": [[49.85, -8.65], [60.86, 1.78]],
            "FR": [[41.30, -5.15], [51.10, 9.57]],
            "NO": [[57.95, 4.50], [71.20, 31.20]],
        }

        for country_code, expected_bounds in cases.items():
            with self.subTest(country_code=country_code):
                response = self.client.get(reverse("poi-country-bounds"), {"country": country_code})

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.data["bounds"], expected_bounds)

    def test_poi_country_bounds_uses_full_bounds_for_excluded_regions(self):
        focused_response = self.client.get(reverse("poi-country-bounds"), {"country": "DK", "lat": 55.7, "lng": 12.6})
        greenland_response = self.client.get(reverse("poi-country-bounds"), {"country": "DK", "lat": 64.2, "lng": -51.7})

        self.assertEqual(focused_response.status_code, status.HTTP_200_OK)
        self.assertEqual(greenland_response.status_code, status.HTTP_200_OK)
        self.assertEqual(focused_response.data["bounds"], [[54.45, 7.70], [57.85, 15.25]])
        self.assertNotEqual(greenland_response.data["bounds"], focused_response.data["bounds"])
        self.assertLess(greenland_response.data["bounds"][0][1], -20)

    def test_poi_country_at_returns_country_for_coordinates(self):
        response = self.client.get(reverse("poi-country-at"), {"lat": 42.2406, "lng": -8.7207})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["country"], "ES")

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

    def test_buffer_poi_lookup_returns_pois_inside_buffer(self):
        disabled_poi = POI.objects.create(
            enabled=False,
            location=Point(-8.7100, 42.2500, srid=4326),
        )
        POITranslation.objects.create(
            poi=disabled_poi,
            language_code="en",
            title="Disabled POI",
            description="Draft POI inside the buffer.",
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
        self.assertEqual(len(response.json()["results"]), 2)
        results_by_id = {result["id"]: result for result in response.json()["results"]}
        result = results_by_id[str(self.poi.id)]
        self.assertEqual(result["id"], str(self.poi.id))
        self.assertTrue(result["enabled"])
        self.assertEqual(result["label"], "Castle")
        self.assertEqual(result["snippet"], "A fortified place.")
        self.assertEqual(result["imageUrl"], "https://example.com/castle.jpg")
        self.assertEqual(result["imageUrls"], ["https://example.com/castle.jpg"])
        self.assertEqual(result["media"][0]["type"], "image")
        self.assertEqual(result["media"][0]["url"], "https://example.com/castle.jpg")
        self.assertEqual(result["lat"], self.poi.gps_latitude)
        self.assertEqual(result["lng"], self.poi.gps_longitude)
        self.assertEqual(result["phone"], "+34 000 000 000")
        self.assertEqual(result["email"], "info@example.com")
        self.assertFalse(results_by_id[str(disabled_poi.id)]["enabled"])
        self.assertEqual(result["categories"], [{"slug": "heritage", "name": "Heritage"}])

    def test_poi_create_accepts_coordinates_and_nested_content(self):
        payload = {
            "enabled": True,
            "country_code": "pt",
            "gps_latitude": 42.1,
            "gps_longitude": -8.6,
            "website": "https://example.com/new",
            "phone": "+351 000 000 000",
            "email": "hello@example.com",
            "category_ids": [self.category.id],
            "translations": [
                {
                    "language_code": "en",
                    "title": "Viewpoint",
                    "description": "Open landscape views.",
                    "slug": "viewpoint",
                }
            ],
            "media": [
                {
                    "media_type": POIMedia.MediaType.IMAGE,
                    "url": "https://example.com/viewpoint.jpg",
                    "position": 1,
                    "is_primary": True,
                    "translations": [
                        {"language_code": "en", "caption": "View from the ridge"},
                        {"language_code": "es", "caption": "Vista desde la cresta"},
                    ],
                }
            ],
        }

        response = self.client.post(reverse("poi-list"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        poi = POI.objects.get(id=response.data["id"])
        self.assertEqual(poi.country_code, "PT")
        self.assertEqual(poi.gps_latitude, 42.1)
        self.assertEqual(poi.gps_longitude, -8.6)
        self.assertEqual(poi.phone, "+351 000 000 000")
        self.assertEqual(poi.email, "hello@example.com")
        self.assertEqual(poi.translations.count(), 1)
        self.assertEqual(poi.media.count(), 1)
        media = poi.media.get()
        self.assertEqual(media.media_type, POIMedia.MediaType.IMAGE)
        self.assertEqual(media.translations.get(language_code="en").caption, "View from the ridge")
        self.assertEqual(media.translations.get(language_code="es").caption, "Vista desde la cresta")
        self.assertTrue(poi.translations.get(language_code="en").is_reference)

    def test_poi_media_accepts_uploaded_file(self):
        self.poi.enabled = False
        self.poi.save(update_fields=["enabled"])
        upload = SimpleUploadedFile(
            "castle.txt",
            b"test file content",
            content_type="text/plain",
        )

        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                response = self.client.post(
                    reverse("poi-media-list"),
                    {
                        "poi": self.poi.id,
                        "media_type": POIMedia.MediaType.DOCUMENT,
                        "file": upload,
                        "position": 2,
                        "is_primary": False,
                        "translations": json.dumps([
                            {"language_code": "en", "caption": "Original document"},
                        ]),
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = POIMedia.objects.get(id=response.data["id"])
        self.assertEqual(media.original_filename, "castle.txt")
        self.assertEqual(media.content_type, "text/plain")
        self.assertEqual(media.size, len(b"test file content"))
        self.assertTrue(media.file.name)
        self.assertEqual(media.translations.get(language_code="en").caption, "Original document")
        self.assertTrue(response.data["file_url"])
        self.assertEqual(response.data["translations"][0]["caption"], "Original document")

    def test_poi_create_generates_slug_when_nested_slug_is_blank(self):
        payload = {
            "enabled": True,
            "country_code": "ES",
            "gps_latitude": 42.7147322,
            "gps_longitude": -7.9151333,
            "website": "",
            "category_ids": [],
            "media": [],
            "translations": [
                {
                    "language_code": "en",
                    "title": "Sample title 2",
                    "description": "",
                    "slug": "",
                    "is_reference": True,
                }
            ],
        }

        response = self.client.post(reverse("poi-list"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        poi = POI.objects.get(id=response.data["id"])
        self.assertEqual(poi.translations.get(language_code="en").slug, "sample-title-2")

    def test_poi_update_accepts_existing_translation_slugs(self):
        self.poi.enabled = False
        self.poi.save(update_fields=["enabled"])
        payload = {
            "enabled": self.poi.enabled,
            "country_code": self.poi.country_code,
            "gps_latitude": self.poi.gps_latitude,
            "gps_longitude": self.poi.gps_longitude,
            "website": self.poi.website,
            "phone": self.poi.phone,
            "email": self.poi.email,
            "category_ids": [self.category.id],
            "translations": [
                {
                    "language_code": translation.language_code,
                    "title": "Updated Castle" if translation.language_code == "en" else translation.title,
                    "description": translation.description,
                    "slug": translation.slug,
                    "is_reference": translation.language_code == "en",
                }
                for translation in self.poi.translations.order_by("language_code")
            ],
            "media": [
                {
                    "media_type": media.media_type,
                    "url": media.url,
                    "position": media.position,
                    "is_primary": media.is_primary,
                }
                for media in self.poi.media.all()
            ],
        }

        response = self.client.patch(reverse("poi-detail", args=[self.poi.id]), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.poi.translations.get(language_code="en").title, "Updated Castle")

    def test_public_poi_cannot_be_updated_or_deleted(self):
        patch_response = self.client.patch(
            reverse("poi-detail", args=[self.poi.id]),
            {"website": "https://example.com/updated"},
            format="json",
        )
        delete_response = self.client.delete(reverse("poi-detail", args=[self.poi.id]))

        self.assertEqual(patch_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(delete_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.poi.refresh_from_db()
        self.assertEqual(self.poi.website, "https://example.com/poi")

    def test_deleting_draft_poi_removes_itinerary_references_and_keeps_waypoint(self):
        self.poi.enabled = False
        self.poi.save(update_fields=["enabled"])
        itinerary = Itinerary.objects.create(
            itinerary_json={
                "poiIds": [self.poi.id, str(self.poi.id), 999],
                "points": [
                    {
                        "type": "poi",
                        "id": str(self.poi.id),
                        "name": "Castle stop",
                        "lat": 42.25,
                        "lng": -8.71,
                        "coordinates": {"lat": 42.25, "lng": -8.71},
                    },
                    {
                        "type": "poi",
                        "poiId": self.poi.id,
                    },
                    {
                        "type": "waypoint",
                        "id": "existing-waypoint",
                        "coordinates": {"lat": 42.0, "lng": -8.0},
                    },
                ],
                "segments": [],
            },
        )

        response = self.client.delete(reverse("poi-detail", args=[self.poi.id]))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(POI.objects.filter(id=self.poi.id).exists())
        itinerary.refresh_from_db()
        self.assertEqual(itinerary.itinerary_json["poiIds"], [999])
        first_point = itinerary.itinerary_json["points"][0]
        self.assertEqual(first_point["type"], "waypoint")
        self.assertEqual(first_point["name"], "Castle stop")
        self.assertEqual(first_point["coordinates"], {"lat": 42.25, "lng": -8.71})
        second_point = itinerary.itinerary_json["points"][1]
        self.assertEqual(second_point["type"], "waypoint")
        self.assertEqual(second_point["coordinates"], {"lat": self.poi.gps_latitude, "lng": self.poi.gps_longitude})
        self.assertEqual(itinerary.itinerary_json["points"][2]["id"], "existing-waypoint")

    def test_public_poi_can_be_turned_to_draft(self):
        response = self.client.patch(reverse("poi-detail", args=[self.poi.id]), {"enabled": False}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.poi.refresh_from_db()
        self.assertFalse(self.poi.enabled)

    def test_poi_turned_to_draft_cascades_to_itineraries_and_routes(self):
        itinerary = Itinerary.objects.create(
            enabled=True,
            itinerary_json={
                "points": [{"type": "poi", "id": self.poi.id}],
                "segments": [],
            },
        )
        route = Route.objects.create(enabled=True)
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)

        response = self.client.patch(reverse("poi-detail", args=[self.poi.id]), {"enabled": False}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.poi.refresh_from_db()
        itinerary.refresh_from_db()
        route.refresh_from_db()
        self.assertFalse(self.poi.enabled)
        self.assertFalse(itinerary.enabled)
        self.assertFalse(route.enabled)

    def test_poi_turned_to_draft_cascades_from_itinerary_poi_ids(self):
        itinerary = Itinerary.objects.create(
            enabled=True,
            itinerary_json={
                "points": [],
                "poiIds": [self.poi.id],
                "segments": [],
            },
        )
        route = Route.objects.create(enabled=True)
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)

        response = self.client.patch(reverse("poi-detail", args=[self.poi.id]), {"enabled": False}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        itinerary.refresh_from_db()
        route.refresh_from_db()
        self.assertFalse(itinerary.enabled)
        self.assertFalse(route.enabled)

    def test_poi_list_includes_itinerary_poi_ids_in_inclusions(self):
        itinerary = Itinerary.objects.create(
            enabled=True,
            itinerary_json={
                "points": [],
                "poiIds": [self.poi.id],
                "segments": [],
            },
        )
        itinerary.translations.create(language_code="en", title="Imported stage", slug="imported-stage")
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Imported route", slug="imported-route")
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=3)

        response = self.client.get(reverse("poi-list"), {"language": "en"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        result = next(item for item in response.data["results"] if item["id"] == self.poi.id)
        self.assertEqual(result["itinerary_inclusions"][0]["itinerary"], itinerary.id)
        self.assertEqual(result["itinerary_inclusions"][0]["itinerary_title"], "Imported stage")
        self.assertEqual(result["itinerary_inclusions"][0]["stage_number"], 3)

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

    def test_rurallure_import_discards_placeholder_poi_translation_titles(self):
        command = Command()
        language_codes = {"lang-en": "en", "lang-es": "es"}
        translation_rows = [
            {
                "point_of_interest_id": "poi-1",
                "language_id": "lang-en",
                "title": "...",
                "slug": "placeholder",
                "description": "Placeholder title.",
            },
            {
                "point_of_interest_id": "poi-1",
                "language_id": "lang-es",
                "title": "Título correcto",
                "slug": "titulo-correcto",
                "description": "Usable title.",
            },
            {
                "point_of_interest_id": "poi-2",
                "language_id": "lang-en",
                "title": "   ",
                "slug": "",
                "description": "Blank title.",
            },
            {
                "point_of_interest_id": "poi-2",
                "language_id": "lang-es",
                "title": "...",
                "slug": "placeholder-2",
                "description": "Placeholder title.",
            },
        ]
        valid_translation_rows = command.valid_poi_translation_rows_by_poi(
            translation_rows,
            language_codes,
        )
        pois_by_source_id, poi_stats = command.import_pois(
            [
                {
                    "id": "poi-1",
                    "enabled": "t",
                    "gps_latitude": "42.1",
                    "gps_longitude": "-8.6",
                    "website": "",
                },
                {
                    "id": "poi-2",
                    "enabled": "t",
                    "gps_latitude": "42.2",
                    "gps_longitude": "-8.7",
                    "website": "",
                },
            ],
            valid_translation_rows,
            timezone.now(),
            None,
        )
        translation_stats = command.import_poi_translations(valid_translation_rows, pois_by_source_id)

        self.assertIn("poi-1", pois_by_source_id)
        self.assertNotIn("poi-2", pois_by_source_id)
        self.assertEqual(poi_stats["pois_skipped_without_valid_translations"], 1)
        self.assertEqual(translation_stats["poi_translations_created"], 1)
        self.assertEqual(translation_stats["poi_translations_skipped_invalid_title"], 3)
        translation = POITranslation.objects.get(poi=pois_by_source_id["poi-1"])
        self.assertEqual(translation.language_code, "es")
        self.assertEqual(translation.title, "Título correcto")
        self.assertTrue(translation.is_reference)

    def test_rurallure_import_near_itineraries_filters_dump_tables_by_distance_range(self):
        Itinerary.objects.create(
            itinerary_json={
                "points": [
                    {"coordinates": {"lat": 42.0, "lng": -8.0}},
                    {"coordinates": {"lat": 42.0, "lng": -7.9}},
                ],
                "segments": [],
            }
        )
        command = NearbyPOIImportCommand()
        data = {table_name: [] for table_name in COPY_TABLES}
        data["public.point_of_interest"] = [
            {
                "id": "near-poi",
                "gps_latitude": "42.001",
                "gps_longitude": "-7.95",
            },
            {
                "id": "far-poi",
                "gps_latitude": "43.0",
                "gps_longitude": "-7.95",
            },
        ]
        data["public.point_of_interest_translation"] = [
            {"point_of_interest_id": "near-poi", "language_id": "lang-en", "title": "Near"},
            {"point_of_interest_id": "far-poi", "language_id": "lang-en", "title": "Far"},
        ]
        data["public.point_of_interest_category"] = [
            {"point_of_interest_id": "near-poi", "category_id": "cat-near"},
            {"point_of_interest_id": "far-poi", "category_id": "cat-far"},
        ]
        data["public.category"] = [{"id": "cat-near"}, {"id": "cat-far"}]
        data["public.category_translation"] = [
            {"category_id": "cat-near", "language_id": "lang-en", "description": "Near category"},
            {"category_id": "cat-far", "language_id": "lang-en", "description": "Far category"},
        ]
        data["public.image_point_of_interest"] = [
            {"point_of_interest_id": "near-poi", "file_uploaded_id": "file-near"},
            {"point_of_interest_id": "far-poi", "file_uploaded_id": "file-far"},
        ]
        data["public.file_uploaded"] = [
            {"id": "file-near", "filename": "near.jpg"},
            {"id": "file-far", "filename": "far.jpg"},
        ]

        filtered_data, stats = command.filter_data_by_distance_range(
            data,
            ItineraryDistanceIndex.from_database(max_distance_km=2),
            min_distance_km=0,
            max_distance_km=2,
        )

        self.assertEqual(stats["pois_matching_distance_range"], 1)
        self.assertEqual(
            [row["id"] for row in filtered_data["public.point_of_interest"]],
            ["near-poi"],
        )
        self.assertEqual(
            [row["point_of_interest_id"] for row in filtered_data["public.point_of_interest_translation"]],
            ["near-poi"],
        )
        self.assertEqual(
            [row["id"] for row in filtered_data["public.category"]],
            ["cat-near"],
        )
        self.assertEqual(
            [row["id"] for row in filtered_data["public.file_uploaded"]],
            ["file-near"],
        )

    def test_rurallure_import_near_itineraries_reports_existing_poi_proximity(self):
        existing_poi = POI.objects.create(
            enabled=True,
            country_code="IT",
            location=Point(12.0, 42.0, srid=4326),
        )
        POITranslation.objects.create(
            poi=existing_poi,
            language_code="it",
            title="Chiesa esistente",
            slug="chiesa-esistente",
            description="Descrizione gia importata.",
            is_reference=True,
        )
        command = NearbyPOIImportCommand()
        rows = [
            {
                "id": "within-two",
                "gps_latitude": "42.000000",
                "gps_longitude": "12.000015",
            },
            {
                "id": "within-ten",
                "gps_latitude": "42.000000",
                "gps_longitude": "12.000080",
            },
            {
                "id": "far",
                "gps_latitude": "42.001000",
                "gps_longitude": "12.001000",
            },
            {
                "id": "without-coordinates",
                "gps_latitude": "",
                "gps_longitude": "",
            },
        ]

        stats = command.existing_poi_proximity_stats(rows, [2, 5, 10])

        self.assertEqual(stats["existing_pois_indexed_for_proximity"], 1)
        self.assertEqual(stats["dump_pois_checked_for_existing_poi_proximity"], 3)
        self.assertEqual(stats["dump_pois_skipped_for_existing_poi_proximity_without_coordinates"], 1)
        self.assertEqual(stats["dump_pois_within_2m_of_existing_poi"], 1)
        self.assertEqual(stats["dump_pois_within_5m_of_existing_poi"], 1)
        self.assertEqual(stats["dump_pois_within_10m_of_existing_poi"], 2)

    def test_rurallure_import_near_itineraries_reports_existing_poi_coincidence_details(self):
        existing_poi = POI.objects.create(
            enabled=True,
            country_code="IT",
            location=Point(12.0, 42.0, srid=4326),
        )
        POITranslation.objects.create(
            poi=existing_poi,
            language_code="it",
            title="Chiesa esistente",
            slug="chiesa-esistente",
            description="Descrizione gia importata.",
            is_reference=True,
        )
        command = NearbyPOIImportCommand()
        data = {table_name: [] for table_name in COPY_TABLES}
        data["public.languages"] = [
            {"id": "lang-en", "iso_639_1_code": "en"},
            {"id": "lang-it", "iso_639_1_code": "it"},
        ]
        data["public.point_of_interest"] = [
            {
                "id": "dump-near",
                "gps_latitude": "42.000000",
                "gps_longitude": "12.000015",
            },
            {
                "id": "dump-far",
                "gps_latitude": "42.001000",
                "gps_longitude": "12.001000",
            },
        ]
        data["public.point_of_interest_translation"] = [
            {
                "point_of_interest_id": "dump-near",
                "language_id": "lang-en",
                "title": "Existing church",
                "description": "Already described in the dump.",
            },
            {
                "point_of_interest_id": "dump-far",
                "language_id": "lang-en",
                "title": "Far place",
                "description": "Not a duplicate candidate.",
            },
        ]

        coincidences = command.existing_poi_coincidences(data, 10)

        self.assertEqual(len(coincidences), 1)
        self.assertEqual(coincidences[0]["dump_poi"]["id"], "dump-near")
        self.assertEqual(coincidences[0]["existing_poi"], existing_poi)
        self.assertEqual(coincidences[0]["dump_translations"][0]["language_code"], "en")
        self.assertEqual(coincidences[0]["dump_translations"][0]["title"], "Existing church")
        self.assertEqual(coincidences[0]["existing_translations"][0].title, "Chiesa esistente")

    def test_rurallure_import_near_itineraries_discards_placeholder_first_translation_title(self):
        existing_poi = POI.objects.create(
            enabled=True,
            country_code="IT",
            location=Point(12.0, 42.0, srid=4326),
        )
        POITranslation.objects.create(
            poi=existing_poi,
            language_code="it",
            title="Chiesa esistente",
            slug="chiesa-esistente",
            description="Descrizione gia importata.",
            is_reference=True,
        )
        command = NearbyPOIImportCommand()
        data = {table_name: [] for table_name in COPY_TABLES}
        data["public.languages"] = [
            {"id": "lang-en", "iso_639_1_code": "en"},
            {"id": "lang-it", "iso_639_1_code": "it"},
        ]
        data["public.point_of_interest"] = [
            {
                "id": "dump-placeholder",
                "enabled": "t",
                "gps_latitude": "42.000000",
                "gps_longitude": "12.000015",
                "website": "",
            },
            {
                "id": "dump-new",
                "enabled": "t",
                "gps_latitude": "42.001000",
                "gps_longitude": "12.001000",
                "website": "",
            },
        ]
        data["public.point_of_interest_translation"] = [
            {
                "point_of_interest_id": "dump-placeholder",
                "language_id": "lang-en",
                "title": "...",
                "description": "...",
                "slug": "",
            },
            {
                "point_of_interest_id": "dump-placeholder",
                "language_id": "lang-it",
                "title": "Useful later title",
                "description": "Useful later description.",
                "slug": "useful-later-title",
            },
            {
                "point_of_interest_id": "dump-new",
                "language_id": "lang-en",
                "title": "New dump place",
                "description": "Useful dump description.",
                "slug": "new-dump-place",
            },
        ]
        data["public.file_uploaded"] = [{"id": "file-placeholder", "filename": "placeholder.jpg"}]
        data["public.image_point_of_interest"] = [
            {
                "point_of_interest_id": "dump-placeholder",
                "file_uploaded_id": "file-placeholder",
                "position": "0",
            }
        ]

        stats = command.import_data(data, "https://example.test/images/", country_boundaries_path=None)

        self.assertEqual(stats["dump_pois_discarded_with_placeholder_first_translation_title"], 1)
        self.assertEqual(stats["pois_created"], 1)
        self.assertEqual(POI.objects.count(), 2)
        self.assertEqual(POITranslation.objects.filter(title="...").count(), 0)
        self.assertEqual(POITranslation.objects.filter(title="Useful later title").count(), 0)
        self.assertEqual(POIMedia.objects.count(), 0)

    def test_rurallure_import_near_itineraries_applies_curated_dump_metadata_merge(self):
        source_id, existing_id = next(iter(CURATED_DUMP_POI_MERGES.items()))
        existing_poi = POI.objects.create(
            id=existing_id,
            enabled=True,
            country_code="IT",
            location=Point(12.0, 42.0, srid=4326),
            website="https://old.example.test",
        )
        POITranslation.objects.create(
            poi=existing_poi,
            language_code="it",
            title="Vecchio nome",
            slug="vecchio-nome",
            description="Vecchia descrizione.",
            is_reference=True,
        )
        command = NearbyPOIImportCommand()
        data = {table_name: [] for table_name in COPY_TABLES}
        data["public.languages"] = [
            {"id": "lang-en", "iso_639_1_code": "en"},
            {"id": "lang-it", "iso_639_1_code": "it"},
        ]
        data["public.point_of_interest"] = [
            {
                "id": source_id,
                "enabled": "t",
                "gps_latitude": "42.123456",
                "gps_longitude": "12.654321",
                "website": "https://dump.example.test",
            }
        ]
        data["public.point_of_interest_translation"] = [
            {
                "point_of_interest_id": source_id,
                "language_id": "lang-en",
                "title": "Dump title",
                "description": "Dump description.",
                "slug": "dump-title",
            },
            {
                "point_of_interest_id": source_id,
                "language_id": "lang-it",
                "title": "Titolo dump",
                "description": "Descrizione dump.",
                "slug": "titolo-dump",
            },
        ]
        data["public.category"] = [{"id": "cat-1"}]
        data["public.category_translation"] = [
            {"category_id": "cat-1", "language_id": "lang-en", "description": "Church"}
        ]
        data["public.point_of_interest_category"] = [
            {"point_of_interest_id": source_id, "category_id": "cat-1"}
        ]
        data["public.file_uploaded"] = [{"id": "file-1", "filename": "dump.jpg"}]
        data["public.image_point_of_interest"] = [
            {"point_of_interest_id": source_id, "file_uploaded_id": "file-1", "position": "0"}
        ]

        stats = command.import_data(data, "https://example.test/images/", country_boundaries_path=None)

        existing_poi.refresh_from_db()
        self.assertEqual(stats["dump_pois_merged_into_existing_pois_with_dump_metadata"], 1)
        self.assertEqual(stats["pois_created"], 0)
        self.assertEqual(POI.objects.count(), 1)
        self.assertAlmostEqual(existing_poi.location.y, 42.123456)
        self.assertAlmostEqual(existing_poi.location.x, 12.654321)
        self.assertEqual(existing_poi.website, "https://dump.example.test")
        self.assertFalse(POITranslation.objects.filter(title="Vecchio nome").exists())
        reference_translation = existing_poi.translations.get(is_reference=True)
        self.assertEqual(reference_translation.language_code, "en")
        self.assertEqual(reference_translation.title, "Dump title")
        self.assertEqual(existing_poi.translations.get(language_code="it").description, "Descrizione dump.")
        self.assertEqual(existing_poi.categories.get().translations.get(language_code="en").name, "Church")
        self.assertEqual(existing_poi.media.get().url, "https://example.test/images/dump.jpg")

    def test_rurallure_import_near_itineraries_automatically_merges_nearby_dump_metadata(self):
        existing_poi = POI.objects.create(
            enabled=True,
            country_code="IT",
            location=Point(12.0, 42.0, srid=4326),
            website="https://old.example.test",
        )
        POITranslation.objects.create(
            poi=existing_poi,
            language_code="it",
            title="Vecchio nome",
            slug="vecchio-nome",
            description="Vecchia descrizione.",
            is_reference=True,
        )
        command = NearbyPOIImportCommand()
        data = {table_name: [] for table_name in COPY_TABLES}
        data["public.languages"] = [{"id": "lang-en", "iso_639_1_code": "en"}]
        data["public.point_of_interest"] = [
            {
                "id": "near-dump",
                "enabled": "t",
                "gps_latitude": "42.000000",
                "gps_longitude": "12.000015",
                "website": "https://dump.example.test",
            }
        ]
        data["public.point_of_interest_translation"] = [
            {
                "point_of_interest_id": "near-dump",
                "language_id": "lang-en",
                "title": "Nearby dump title",
                "description": "Nearby dump description.",
                "slug": "nearby-dump-title",
            }
        ]

        stats = command.import_data(data, "https://example.test/images/", country_boundaries_path=None)

        existing_poi.refresh_from_db()
        self.assertEqual(stats["dump_pois_automatically_merged_into_existing_pois_with_dump_metadata"], 1)
        self.assertEqual(stats["pois_created"], 0)
        self.assertEqual(POI.objects.count(), 1)
        self.assertAlmostEqual(existing_poi.location.y, 42.0)
        self.assertAlmostEqual(existing_poi.location.x, 12.000015)
        self.assertEqual(existing_poi.website, "https://dump.example.test")
        self.assertEqual(existing_poi.translations.get().title, "Nearby dump title")
        self.assertTrue(existing_poi.translations.get().is_reference)

    def test_existing_poi_distance_index_finds_nearby_pois(self):
        index = ExistingPoiDistanceIndex([(12.0, 42.0)], max_distance_meters=10)

        self.assertLess(index.nearest_distance_meters((12.000015, 42.0)), 2)
        self.assertIsNone(index.nearest_distance_meters((12.001, 42.0)))

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

    def test_itinerary_detail_uses_reference_translation_when_requested_language_is_missing(self):
        itinerary = Itinerary.objects.create(
            enabled=True,
            itinerary_json={
                "points": [],
                "segments": [],
            },
        )
        itinerary.translations.create(
            language_code="it",
            title="Tappa italiana",
            description="Descrizione italiana.",
            slug="tappa-italiana",
            is_reference=True,
        )

        response = self.client.get(reverse("itinerary-detail", args=[itinerary.id]), {"language": "en"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["title"], "Tappa italiana")
        self.assertEqual(response.data["description"], "Descrizione italiana.")

    def test_itinerary_media_accepts_uploaded_file(self):
        itinerary = Itinerary.objects.create(
            enabled=False,
            itinerary_json={
                "points": [],
                "segments": [],
            },
        )
        itinerary.translations.create(
            language_code="en",
            title="Media itinerary",
            description="Itinerary with media.",
            slug="media-itinerary",
            is_reference=True,
        )
        upload = SimpleUploadedFile("itinerary.pdf", b"itinerary document", content_type="application/pdf")

        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                response = self.client.post(
                    reverse("itinerary-media-list"),
                    {
                        "itinerary": itinerary.id,
                        "media_type": ItineraryMedia.MediaType.DOCUMENT,
                        "file": upload,
                        "position": 2,
                        "is_primary": False,
                        "translations": json.dumps([
                            {"language_code": "en", "caption": "Itinerary document"},
                        ]),
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = ItineraryMedia.objects.get(id=response.data["id"])
        self.assertEqual(media.itinerary, itinerary)
        self.assertEqual(media.original_filename, "itinerary.pdf")
        self.assertEqual(media.content_type, "application/pdf")
        self.assertTrue(media.file.name)
        self.assertEqual(media.translations.get(language_code="en").caption, "Itinerary document")
        self.assertTrue(response.data["file_url"])

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

    def test_route_media_accepts_uploaded_file(self):
        route = Route.objects.create(enabled=False)
        RouteTranslation.objects.create(
            route=route,
            language_code="en",
            title="Media route",
            description="Route with media.",
            slug="media-route",
            is_reference=True,
        )
        upload = SimpleUploadedFile("route.jpg", b"route image", content_type="image/jpeg")

        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                response = self.client.post(
                    reverse("route-media-list"),
                    {
                        "route": route.id,
                        "media_type": RouteMedia.MediaType.IMAGE,
                        "file": upload,
                        "position": 1,
                        "is_primary": True,
                        "translations": json.dumps([
                            {"language_code": "en", "caption": "Route cover"},
                        ]),
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = RouteMedia.objects.get(id=response.data["id"])
        self.assertEqual(media.route, route)
        self.assertEqual(media.original_filename, "route.jpg")
        self.assertEqual(media.content_type, "image/jpeg")
        self.assertTrue(media.file.name)
        self.assertEqual(media.translations.get(language_code="en").caption, "Route cover")
        self.assertTrue(response.data["file_url"])

    def test_route_list_uses_reference_translation_without_language_filter(self):
        route = Route.objects.create(enabled=False)
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
        route = Route.objects.create(enabled=False)
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
        self.assertEqual(
            response.data["route_memberships"],
            [
                {
                    "route": route.id,
                    "route_title": "Camino route",
                    "route_slug": "camino-route",
                    "stage_number": 1,
                }
            ],
        )

        route_response = self.client.get(reverse("itinerary-list"), {"route": route.id})
        unassigned_response = self.client.get(reverse("itinerary-list"), {"route": "null"})
        self.assertEqual(route_response.data["count"], 1)
        self.assertEqual(unassigned_response.data["count"], 0)

    def test_route_reorders_itinerary_stages(self):
        route = Route.objects.create(enabled=False)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )
        first = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=first, stage_number=1)
        first.translations.create(language_code="en", title="First", slug="first")
        second = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=second, stage_number=2)
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
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=first).stage_number, 2)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=second).stage_number, 1)

    def test_route_remove_itinerary_compacts_stages(self):
        route = Route.objects.create(enabled=False)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )
        first = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=first, stage_number=1)
        first.translations.create(language_code="en", title="First", slug="first")
        second = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=second, stage_number=2)
        second.translations.create(language_code="en", title="Second", slug="second")
        third = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=third, stage_number=3)
        third.translations.create(language_code="en", title="Third", slug="third")

        response = self.client.post(
            reverse("route-remove-itinerary", args=[route.id]),
            {"itinerary": second.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=first).stage_number, 1)
        self.assertFalse(RouteStage.objects.filter(route=route, itinerary=second).exists())
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=third).stage_number, 2)

    def test_route_add_itineraries_appends_new_stages(self):
        route = Route.objects.create(enabled=False)
        route.translations.create(
            language_code="en",
            title="Camino route",
            description="A multi-stage route.",
            slug="camino-route",
        )
        existing = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=existing, stage_number=1)
        existing.translations.create(language_code="en", title="Existing", slug="existing")
        first = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        first.translations.create(language_code="en", title="First", slug="first")
        second = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        second.translations.create(language_code="en", title="Second", slug="second")

        response = self.client.post(
            reverse("route-add-itineraries", args=[route.id]),
            {"itineraries": [existing.id, first.id, second.id]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=existing).stage_number, 1)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=first).stage_number, 2)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=second).stage_number, 3)

    def test_public_route_cannot_be_updated_deleted_or_reordered(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Public route", slug="public-route")
        first = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        second = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=first, stage_number=1)
        RouteStage.objects.create(route=route, itinerary=second, stage_number=2)

        patch_response = self.client.patch(
            reverse("route-detail", args=[route.id]),
            {"translations": [{"language_code": "en", "title": "Changed", "is_reference": True}]},
            format="json",
        )
        delete_response = self.client.delete(reverse("route-detail", args=[route.id]))
        reorder_response = self.client.post(
            reverse("route-reorder-itineraries", args=[route.id]),
            {"itineraries": [{"id": second.id, "stage_number": 1}, {"id": first.id, "stage_number": 2}]},
            format="json",
        )

        self.assertEqual(patch_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(delete_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(reorder_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(RouteStage.objects.get(route=route, itinerary=first).stage_number, 1)

    def test_public_route_can_be_turned_to_draft(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Public route", slug="public-route")

        response = self.client.patch(reverse("route-detail", args=[route.id]), {"enabled": False}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        route.refresh_from_db()
        self.assertFalse(route.enabled)

    def test_route_turned_public_cascades_to_itineraries_and_pois(self):
        poi = POI.objects.create(
            enabled=False,
            country_code="ES",
            location=Point(-8.7207, 42.2406, srid=4326),
        )
        route = Route.objects.create(enabled=False)
        route.translations.create(language_code="en", title="Draft route", slug="draft-route")
        itinerary = Itinerary.objects.create(
            enabled=False,
            itinerary_json={
                "points": [{"type": "poi", "id": poi.id}],
                "segments": [],
            },
        )
        itinerary.translations.create(language_code="en", title="Draft itinerary", slug="draft-itinerary")
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)

        response = self.client.patch(reverse("route-detail", args=[route.id]), {"enabled": True}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        poi.refresh_from_db()
        itinerary.refresh_from_db()
        route.refresh_from_db()
        self.assertTrue(route.enabled)
        self.assertTrue(itinerary.enabled)
        self.assertTrue(poi.enabled)

    def test_public_route_cannot_add_or_remove_itineraries(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Public route", slug="public-route")
        existing = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=existing, stage_number=1)
        new_itinerary = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})

        add_response = self.client.post(
            reverse("route-add-itineraries", args=[route.id]),
            {"itineraries": [new_itinerary.id]},
            format="json",
        )
        remove_response = self.client.post(
            reverse("route-remove-itinerary", args=[route.id]),
            {"itinerary": existing.id},
            format="json",
        )

        self.assertEqual(add_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(remove_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(RouteStage.objects.filter(route=route, itinerary=existing).exists())
        self.assertFalse(RouteStage.objects.filter(route=route, itinerary=new_itinerary).exists())

    def test_itinerary_cannot_be_created_in_public_route(self):
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Public route", slug="public-route")

        response = self.client.post(
            reverse("itinerary-list"),
            {
                "enabled": False,
                "route": route.id,
                "stage_number": 1,
                "itinerary_json": {"points": [], "segments": []},
                "translations": [{"language_code": "en", "title": "Draft itinerary", "is_reference": True}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(RouteStage.objects.filter(route=route).exists())

    def test_public_itinerary_cannot_be_updated_or_deleted(self):
        itinerary = Itinerary.objects.create(enabled=True, itinerary_json={"points": [], "segments": []})
        itinerary.translations.create(language_code="en", title="Public itinerary", slug="public-itinerary")

        patch_response = self.client.patch(reverse("itinerary-detail", args=[itinerary.id]), {"itinerary_json": {"points": [{"id": 1}], "segments": []}}, format="json")
        delete_response = self.client.delete(reverse("itinerary-detail", args=[itinerary.id]))

        self.assertEqual(patch_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(delete_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Itinerary.objects.filter(id=itinerary.id).exists())

    def test_public_itinerary_can_be_turned_to_draft(self):
        itinerary = Itinerary.objects.create(enabled=True, itinerary_json={"points": [], "segments": []})
        itinerary.translations.create(language_code="en", title="Public itinerary", slug="public-itinerary")
        route = Route.objects.create(enabled=True)
        route.translations.create(language_code="en", title="Public route", slug="public-route")
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)

        response = self.client.patch(reverse("itinerary-detail", args=[itinerary.id]), {"enabled": False}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        itinerary.refresh_from_db()
        route.refresh_from_db()
        self.assertFalse(itinerary.enabled)
        self.assertFalse(route.enabled)

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


class ManagementCommandTests(APITestCase):
    def write_gpx(self, path, title, coordinates):
        points = "\n".join(
            f'        <trkpt lon="{lon}" lat="{lat}"></trkpt>'
            for lon, lat in coordinates
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{title}</name></metadata>
  <wpt lon="{coordinates[0][0]}" lat="{coordinates[0][1]}"><name>Waypoint</name></wpt>
  <trk>
    <name>{title}</name>
    <trkseg>
{points}
    </trkseg>
  </trk>
</gpx>
""",
            encoding="utf-8",
        )

    def test_clear_content_data_requires_confirmation(self):
        with self.assertRaises(CommandError):
            call_command("clear_content_data")

    def test_clear_content_data_deletes_content(self):
        category = Category.objects.create(slug="heritage")
        poi = POI.objects.create(enabled=True, country_code="ES", location=Point(-8.7, 42.2, srid=4326))
        poi.categories.add(category)
        POITranslation.objects.create(poi=poi, language_code="en", title="POI", slug="poi", is_reference=True)
        route = Route.objects.create(enabled=True)
        RouteTranslation.objects.create(route=route, language_code="en", title="Route", slug="route", is_reference=True)
        itinerary = Itinerary.objects.create(itinerary_json={"points": [], "segments": []})
        RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)
        itinerary.translations.create(language_code="en", title="Itinerary", slug="itinerary", is_reference=True)

        call_command("clear_content_data", "--yes")

        self.assertEqual(POI.objects.count(), 0)
        self.assertEqual(Itinerary.objects.count(), 0)
        self.assertEqual(Route.objects.count(), 0)
        self.assertEqual(Category.objects.count(), 0)

    def test_rurallure_import_romea_strata_creates_one_continuous_itinerary(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            for index in (1, 2):
                coordinates = (
                    [[13.0, 45.0], [13.1, 45.1]]
                    if index == 1
                    else [[13.1, 45.1], [13.2, 45.2]]
                )
                payload = {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coordinates,
                            },
                            "properties": {"name": f"stage-{index}"},
                        }
                    ],
                }
                (source_dir / f"test_part{index:03d}.geojson").write_text(json.dumps(payload), encoding="utf-8")

            call_command("rurallure_import_romea_strata", "--source-dir", str(source_dir), "--route-title", "Romea Strata Test", "--route-slug", "romea-strata-test")

        route = RouteTranslation.objects.get(slug="romea-strata-test").route
        stages = list(route.stages.select_related("itinerary").order_by("stage_number"))
        itineraries = [stage.itinerary for stage in stages]
        self.assertEqual(len(itineraries), 1)
        self.assertEqual(stages[0].stage_number, 1)
        self.assertEqual(itineraries[0].translations.get().title, "Romea Strata Test")
        self.assertEqual(
            itineraries[0].itinerary_json["segments"][0]["selectedWalkingRoute"]["geometry"]["type"],
            "LineString",
        )
        self.assertEqual(
            len(itineraries[0].itinerary_json["segments"][0]["selectedWalkingRoute"]["geometry"]["coordinates"]),
            3,
        )

    def test_rurallure_import_via_romea_del_santo_uses_shared_geojson_importer(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            for index in (1, 2):
                coordinates = (
                    [[11.0, 44.0], [11.1, 44.1]]
                    if index == 1
                    else [[11.1, 44.1], [11.2, 44.2]]
                )
                payload = {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coordinates,
                            },
                            "properties": {"name": f"stage-{index}"},
                        }
                    ],
                }
                (source_dir / f"test_part{index:03d}.geojson").write_text(json.dumps(payload), encoding="utf-8")

            call_command(
                "rurallure_import_via_romea_del_santo",
                "--source-dir",
                str(source_dir),
                "--route-title",
                "Via Romea del Santo Test",
                "--route-slug",
                "via-romea-del-santo-test",
            )

        route = RouteTranslation.objects.get(slug="via-romea-del-santo-test").route
        stage = route.stages.select_related("itinerary").get()
        itinerary = stage.itinerary
        self.assertEqual(stage.stage_number, 1)
        self.assertEqual(itinerary.translations.get().title, "Via Romea del Santo Test")
        self.assertEqual(
            len(itinerary.itinerary_json["segments"][0]["selectedWalkingRoute"]["geometry"]["coordinates"]),
            3,
        )

    def test_rurallure_import_romea_strata_official_imports_gpx_stages(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            self.write_gpx(
                source_dir / "1.Estonia" / "A piedi_on foot" / "rsee01.gpx",
                "RSEE01 - Tallinn > Saku",
                [[24.7, 59.4], [24.8, 59.3]],
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Cammino principale - Main path (Tarvisio-Roma)" / "rsit01.gpx",
                "RSIT01 - Tarvisio > Pontebba",
                [[13.5, 46.5], [13.3, 46.4]],
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Romee" / "Romea del Santo" / "rsit01.gpx",
                "Romea del Santo stage",
                [[11.7, 45.8], [11.9, 45.6]],
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Romee" / "Romea del Santo" / "rsit01_variante.gpx",
                "Romea del Santo variant",
                [[11.8, 45.9], [12.0, 45.7]],
            )

            call_command("rurallure_import_romea_strata_official", "--source-dir", str(source_dir))

        main_route = RouteTranslation.objects.get(slug="romea-strata-official").route
        branch_translation = RouteTranslation.objects.get(slug="romea-del-santo")
        branch_route = branch_translation.route
        self.assertEqual(branch_translation.title, "Romea del Santo")
        self.assertEqual(main_route.translations.get().description, "")
        self.assertEqual(branch_translation.description, "")
        self.assertEqual(main_route.itineraries.count(), 2)
        self.assertEqual(branch_route.itineraries.count(), 1)
        itinerary = main_route.stages.select_related("itinerary").order_by("stage_number").first().itinerary
        self.assertEqual(itinerary.translations.get().title, "RSEE01 - Tallinn > Saku")
        self.assertEqual(itinerary.translations.get().description, "")
        self.assertEqual(
            itinerary.itinerary_json["segments"][0]["selectedWalkingRoute"]["geometry"]["type"],
            "LineString",
        )
        self.assertEqual(itinerary.itinerary_json["source"]["waypointCount"], 1)

    def test_rurallure_import_romea_strata_official_with_pois_reports_near_duplicate_waypoints(self):
        command = RomeaOfficialWithPoisCommand()
        left_waypoint = SimpleNamespace(
            coordinates=[12.0, 42.0],
            name="Santuario della Madonna Addolorata di Merna",
            category_name="Chiesa",
            description="Descrizione",
        )
        right_waypoint = SimpleNamespace(
            coordinates=[12.000015, 42.0],
            name="Santuario della Madonna Addolorata di Merna",
            category_name="Alloggio condiviso",
            description="",
        )
        far_waypoint = SimpleNamespace(
            coordinates=[12.001, 42.0],
            name="Altro POI",
            category_name="Chiesa",
            description="",
        )
        stage = SimpleNamespace(title="RSIT01 - Miren > San Canzian")

        pairs = command.potential_duplicate_waypoint_pairs(
            [
                (left_waypoint, stage),
                (right_waypoint, stage),
                (far_waypoint, stage),
            ],
            10,
        )

        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["left_waypoint"].category_name, "Chiesa")
        self.assertEqual(pairs[0]["right_waypoint"].category_name, "Alloggio condiviso")
        self.assertLess(pairs[0]["distance_meters"], 2)

        merged_waypoints = command.merged_waypoints({
            "left": (left_waypoint, stage),
            "right": (right_waypoint, stage),
            "far": (far_waypoint, stage),
        })

        self.assertEqual(len(merged_waypoints), 2)
        merged_duplicate = merged_waypoints[0]
        self.assertEqual(merged_duplicate.name, "Santuario della Madonna Addolorata di Merna")
        self.assertEqual(merged_duplicate.coordinates, [12.0, 42.0])
        self.assertEqual(merged_duplicate.category_names, ["Chiesa", "Alloggio condiviso"])
        self.assertEqual(merged_duplicate.description, "Descrizione")
        self.assertEqual(merged_duplicate.source_fingerprints, ["left", "right"])

    def test_rurallure_import_romea_strata_official_can_include_variants_disabled(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Romee" / "Romea del Santo" / "rsit01.gpx",
                "Romea del Santo stage",
                [[11.7, 45.8], [11.9, 45.6]],
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Romee" / "Romea del Santo" / "rsit01_variante.gpx",
                "Romea del Santo variant",
                [[11.8, 45.9], [12.0, 45.7]],
            )

            call_command("rurallure_import_romea_strata_official", "--source-dir", str(source_dir), "--include-variants")

        branch_route = RouteTranslation.objects.get(slug="romea-del-santo").route
        stages = list(branch_route.stages.select_related("itinerary").order_by("stage_number"))
        itineraries = [stage.itinerary for stage in stages]
        self.assertEqual(len(itineraries), 2)
        self.assertTrue(itineraries[0].enabled)
        self.assertFalse(itineraries[1].enabled)

    def test_rurallure_import_romea_strata_official_reuses_overlapping_stages(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            shared_coordinates = [[13.5, 46.5], [13.3, 46.4]]
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Cammino principale - Main path (Tarvisio-Roma)" / "rsit01.gpx",
                "RSIT01 - Tarvisio > Pontebba",
                shared_coordinates,
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Romee" / "Romea del Santo" / "rsit01.gpx",
                "Romea del Santo shared stage",
                shared_coordinates,
            )

            call_command("rurallure_import_romea_strata_official", "--source-dir", str(source_dir))

        main_route = RouteTranslation.objects.get(slug="romea-strata-official").route
        branch_route = RouteTranslation.objects.get(slug="romea-del-santo").route
        main_stage = main_route.stages.get(stage_number=1)
        branch_stage = branch_route.stages.get(stage_number=1)
        self.assertEqual(main_stage.itinerary_id, branch_stage.itinerary_id)
        self.assertEqual(Itinerary.objects.count(), 1)

    def test_rurallure_import_romea_strata_official_skips_duplicate_stage_inside_same_route(self):
        with TemporaryDirectory() as temporary_directory:
            source_dir = Path(temporary_directory)
            shared_coordinates = [[13.5, 46.5], [13.3, 46.4]]
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Cammino principale - Main path (Tarvisio-Roma)" / "rsit01.gpx",
                "RSIT01 - Tarvisio > Pontebba",
                shared_coordinates,
            )
            self.write_gpx(
                source_dir / "7.Italia" / "A piedi_on foot" / "Cammino principale - Main path (Tarvisio-Roma)" / "rsit01_duplicate.gpx",
                "RSIT01 duplicate",
                shared_coordinates,
            )

            call_command("rurallure_import_romea_strata_official", "--source-dir", str(source_dir))

        main_route = RouteTranslation.objects.get(slug="romea-strata-official").route
        self.assertEqual(main_route.stages.count(), 1)
        self.assertEqual(main_route.stages.get().stage_number, 1)
        self.assertEqual(Itinerary.objects.count(), 1)
