import json
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory

from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .management.commands.import_rurallure_dump import Command, CountryBoundaryLookup
from .models import Category, CategoryTranslation, Itinerary, POI, POIImage, POITranslation, Route, RouteStage, RouteTranslation


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
        route = Route.objects.create(enabled=True)
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
        route = Route.objects.create(enabled=True)
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
        route = Route.objects.create(enabled=True)
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
