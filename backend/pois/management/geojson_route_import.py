import json
import math
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from pois.models import Itinerary, ItineraryTranslation, Route, RouteStage, RouteTranslation


DEFAULT_LANGUAGE = "en"


def line_coordinates(geometry):
    if not geometry:
        return []

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geometry_type == "LineString":
        return coordinates
    if geometry_type == "MultiLineString":
        return [coordinate for line in coordinates for coordinate in line]
    return []


def haversine_meters(left, right):
    lon1, lat1 = left
    lon2, lat2 = right
    radius = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def line_distance_meters(coordinates):
    return sum(haversine_meters(left, right) for left, right in zip(coordinates, coordinates[1:]))


def stage_number_from_name(path, fallback):
    match = re.search(r"_part(\d+)\.geojson$", path.name)
    return int(match.group(1)) if match else fallback


def coordinates_equal(left, right):
    return (
        len(left) >= 2
        and len(right) >= 2
        and abs(float(left[0]) - float(right[0])) < 1e-9
        and abs(float(left[1]) - float(right[1])) < 1e-9
    )


class BaseGeojsonRouteImportCommand(BaseCommand):
    help = "Import ordered GeoJSON route files as one continuous itinerary."
    route_title = ""
    route_slug = ""
    source_dir = None

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-dir",
            default=str(self.source_dir),
            help="Directory containing .geojson route files.",
        )
        parser.add_argument(
            "--route-title",
            default=self.route_title,
            help="Route title to create or reuse.",
        )
        parser.add_argument(
            "--route-slug",
            default=self.route_slug,
            help="Route slug to create or reuse.",
        )
        parser.add_argument(
            "--language",
            default=DEFAULT_LANGUAGE,
            help="Reference translation language.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing itineraries for the route before importing.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Validate source files and report what would be imported without writing rows.",
        )

    def handle(self, *args, **options):
        source_dir = Path(options["source_dir"]).expanduser().resolve()
        if not source_dir.exists() or not source_dir.is_dir():
            raise CommandError(f"Source directory not found: {source_dir}")

        files = sorted(source_dir.glob("*.geojson"))
        if not files:
            raise CommandError(f"No .geojson files found in {source_dir}")

        route_title = options["route_title"].strip()
        route_slug = options["route_slug"].strip() or slugify(route_title)
        language = options["language"].strip()
        if not route_title:
            raise CommandError("Route title must not be empty.")
        if not language:
            raise CommandError("Language must not be empty.")

        prepared = self.prepare_itinerary(files, route_title, source_dir)
        if options["dry_run"]:
            self.stdout.write(f"Source directory: {source_dir}")
            self.stdout.write(f"Route: {route_title} ({route_slug})")
            self.stdout.write(f"GeoJSON files: {len(files)}")
            self.stdout.write("Importable itineraries: 1")
            self.stdout.write(f"Coordinates: {len(prepared['coordinates'])}")
            self.stdout.write(f"Discontinuities: {prepared['itinerary_json']['source']['discontinuities']}")
            return

        with transaction.atomic():
            route = self.get_or_create_route(route_title, route_slug, language, source_dir)
            existing_count = route.itineraries.count()
            if existing_count and not options["replace"]:
                raise CommandError(
                    f'Route "{route_title}" already has {existing_count} itineraries. '
                    "Use --replace to delete them before importing."
                )
            if existing_count:
                route.stages.all().delete()

            itinerary = Itinerary.objects.create(
                enabled=True,
                itinerary_json=prepared["itinerary_json"],
            )
            RouteStage.objects.create(route=route, itinerary=itinerary, stage_number=1)
            ItineraryTranslation.objects.create(
                itinerary=itinerary,
                language_code=language,
                title=prepared["title"],
                description=prepared["description"],
                slug=slugify(prepared["title"]),
                is_reference=True,
            )

        self.stdout.write(self.style.SUCCESS(f'Imported 1 itinerary into "{route_title}".'))
        self.stdout.write(f"Route id: {route.id}")

    def get_or_create_route(self, route_title, route_slug, language, source_dir):
        route_translation = RouteTranslation.objects.select_related("route").filter(
            language_code=language,
            slug=route_slug,
        ).first()
        if route_translation:
            return route_translation.route

        route = Route.objects.create(enabled=True)
        RouteTranslation.objects.create(
            route=route,
            language_code=language,
            title=route_title,
            description=f"Imported from {source_dir}.",
            slug=route_slug,
            is_reference=True,
        )
        return route

    def prepare_itinerary(self, files, route_title, source_dir):
        ordered_segments = []
        for fallback_index, path in enumerate(files, start=1):
            payload = json.loads(path.read_text())
            features = payload.get("features") or []
            if not features:
                raise CommandError(f"{path} does not contain any GeoJSON features.")

            feature = features[0]
            geometry = feature.get("geometry") or {}
            coordinates = line_coordinates(geometry)
            if len(coordinates) < 2:
                raise CommandError(f"{path} does not contain a LineString with at least two coordinates.")

            stage_number = stage_number_from_name(path, fallback_index)

            ordered_segments.append(
                {
                    "stage_number": stage_number,
                    "path": path,
                    "name": (feature.get("properties") or {}).get("name") or path.stem,
                    "coordinates": coordinates,
                }
            )

        ordered_segments.sort(key=lambda item: item["path"].name)
        merged_coordinates = []
        discontinuities = 0
        for segment in ordered_segments:
            coordinates = segment["coordinates"]
            if not merged_coordinates:
                merged_coordinates.extend(coordinates)
                continue

            if coordinates_equal(merged_coordinates[-1], coordinates[0]):
                merged_coordinates.extend(coordinates[1:])
            else:
                discontinuities += 1
                merged_coordinates.extend(coordinates)

        start_lon, start_lat = merged_coordinates[0]
        end_lon, end_lat = merged_coordinates[-1]
        distance_meters = round(line_distance_meters(merged_coordinates))
        geometry = {
            "type": "LineString",
            "coordinates": merged_coordinates,
        }

        return {
            "title": route_title,
            "description": (
                f"Imported as one continuous itinerary from {len(ordered_segments)} GeoJSON files in {source_dir}."
                + (f" {discontinuities} stage joins were not coordinate-contiguous." if discontinuities else "")
            ),
            "coordinates": merged_coordinates,
            "itinerary_json": {
                "points": [
                    {
                        "id": f"{slugify(route_title)}-start",
                        "type": "waypoint",
                        "label": f"{route_title} start",
                        "name": f"{route_title} start",
                        "lat": start_lat,
                        "lng": start_lon,
                        "coordinates": {"lat": start_lat, "lng": start_lon},
                    },
                    {
                        "id": f"{slugify(route_title)}-end",
                        "type": "waypoint",
                        "label": f"{route_title} end",
                        "name": f"{route_title} end",
                        "lat": end_lat,
                        "lng": end_lon,
                        "coordinates": {"lat": end_lat, "lng": end_lon},
                    },
                ],
                "segments": [
                    {
                        "fromPoint": 1,
                        "toPoint": 2,
                        "bufferDistanceMeters": 1000,
                        "selectedWalkingRoute": {
                            "source": "routes_data",
                            "geometry": geometry,
                            "distanceMeters": distance_meters,
                        },
                    }
                ],
                "source": {
                    "kind": "geojson-continuous-route-import",
                    "sourceDirectory": str(source_dir),
                    "files": [
                        {
                            "stageNumber": segment["stage_number"],
                            "path": str(segment["path"]),
                            "name": segment["name"],
                        }
                        for segment in ordered_segments
                    ],
                    "discontinuities": discontinuities,
                },
            },
        }
