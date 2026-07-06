import math
import re
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from pois.models import Itinerary, ItineraryTranslation, Route, RouteStage, RouteTranslation


GPX_NS = {"g": "http://www.topografix.com/GPX/1/1"}
DEFAULT_LANGUAGE = "it"
VARIANT_MARKERS = ("variante", "de tour", "fuori percorso", "raccordo", "anello")


@dataclass
class GpxStage:
    path: Path
    title: str
    coordinates: list
    waypoint_count: int
    track_count: int
    track_segment_count: int
    is_variant: bool


@dataclass
class GpxRoutePlan:
    title: str
    slug: str
    description: str
    files: list


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


def stage_fingerprint(stage):
    rounded_coordinates = [[round(float(lon), 7), round(float(lat), 7)] for lon, lat in stage.coordinates]
    payload = json.dumps(rounded_coordinates, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def natural_sort_key(path):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


def normalized_title(value):
    return re.sub(r"\s+", " ", value.replace("_", " ").replace("-", " ")).strip()


def is_variant_path(path):
    name = path.name.lower()
    return any(marker in name for marker in VARIANT_MARKERS)


def text_or_empty(element, xpath):
    value = element.findtext(xpath, namespaces=GPX_NS)
    return value.strip() if value else ""


def gpx_point_coordinates(point):
    return [float(point.attrib["lon"]), float(point.attrib["lat"])]


def parse_gpx_stage(path):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise CommandError(f"Could not parse GPX file {path}: {exc}") from exc

    title = (
        text_or_empty(root, "g:metadata/g:name")
        or text_or_empty(root, "g:trk/g:name")
        or normalized_title(path.stem)
    )
    tracks = root.findall("g:trk", GPX_NS)
    coordinates = []
    track_segment_count = 0
    for track in tracks:
        for segment in track.findall("g:trkseg", GPX_NS):
            track_segment_count += 1
            coordinates.extend(gpx_point_coordinates(point) for point in segment.findall("g:trkpt", GPX_NS))

    if len(coordinates) < 2:
        raise CommandError(f"{path} does not contain a GPX track with at least two points.")

    return GpxStage(
        path=path,
        title=title,
        coordinates=coordinates,
        waypoint_count=len(root.findall("g:wpt", GPX_NS)),
        track_count=len(tracks),
        track_segment_count=track_segment_count,
        is_variant=is_variant_path(path),
    )


def itinerary_json_for_stage(stage, route_title, source_dir):
    start_lon, start_lat = stage.coordinates[0]
    end_lon, end_lat = stage.coordinates[-1]
    distance_meters = round(line_distance_meters(stage.coordinates))
    point_id_prefix = slugify(stage.title) or "gpx-stage"
    return {
        "points": [
            {
                "id": f"{point_id_prefix}-start",
                "type": "waypoint",
                "label": f"{stage.title} start",
                "name": f"{stage.title} start",
                "lat": start_lat,
                "lng": start_lon,
                "coordinates": {"lat": start_lat, "lng": start_lon},
            },
            {
                "id": f"{point_id_prefix}-end",
                "type": "waypoint",
                "label": f"{stage.title} end",
                "name": f"{stage.title} end",
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
                    "source": "romea_strata_official_gpx",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": stage.coordinates,
                    },
                    "distanceMeters": distance_meters,
                },
            }
        ],
        "source": {
            "kind": "romea-strata-official-gpx-import",
            "routeTitle": route_title,
            "sourceDirectory": str(source_dir),
            "path": str(stage.path),
            "trackCount": stage.track_count,
            "trackSegmentCount": stage.track_segment_count,
            "waypointCount": stage.waypoint_count,
            "isVariant": stage.is_variant,
        },
    }


class BaseGpxRouteImportCommand(BaseCommand):
    help = "Import GPX route files into routes and numbered itineraries."
    source_dir = None
    base_route_title = ""
    base_route_slug = ""

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-dir",
            default=str(self.source_dir),
            help="Directory containing the official Romea Strata GPX files.",
        )
        parser.add_argument(
            "--language",
            default=DEFAULT_LANGUAGE,
            help="Reference translation language.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete existing itineraries for imported routes before importing.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Validate source files and report what would be imported without writing rows.",
        )
        parser.add_argument(
            "--include-variants",
            action="store_true",
            help="Import GPX files marked as variants, detours, or outside-route alternatives.",
        )

    def handle(self, *args, **options):
        source_dir = Path(options["source_dir"]).expanduser().resolve()
        if not source_dir.exists() or not source_dir.is_dir():
            raise CommandError(f"Source directory not found: {source_dir}")

        language = options["language"].strip()
        if not language:
            raise CommandError("Language must not be empty.")

        route_plans = self.build_route_plans(source_dir, include_variants=options["include_variants"])
        if not route_plans:
            raise CommandError(f"No importable GPX route files found in {source_dir}")

        prepared_routes = []
        for plan in route_plans:
            stages = [parse_gpx_stage(path) for path in plan.files]
            prepared_routes.append((plan, stages))

        if options["dry_run"]:
            self.write_dry_run(source_dir, prepared_routes)
            return

        with transaction.atomic():
            imported_count = 0
            created_itinerary_count = 0
            reused_itinerary_count = 0
            skipped_duplicate_stage_count = 0
            itinerary_by_fingerprint = {}
            for plan, stages in prepared_routes:
                route = self.get_or_create_route(plan, language)
                existing_count = route.itineraries.count()
                if existing_count and not options["replace"]:
                    raise CommandError(
                        f'Route "{plan.title}" already has {existing_count} itineraries. '
                        "Use --replace to delete them before importing."
                    )
                if existing_count:
                    route.stages.all().delete()

                route_itinerary_ids = set()
                next_stage_number = 1
                for stage in stages:
                    fingerprint = stage_fingerprint(stage)
                    itinerary = itinerary_by_fingerprint.get(fingerprint)
                    if itinerary is None:
                        itinerary = self.find_existing_itinerary(fingerprint)
                    if itinerary is None:
                        itinerary = Itinerary.objects.create(
                            enabled=not stage.is_variant,
                            itinerary_json=itinerary_json_for_stage(stage, plan.title, source_dir),
                        )
                        itinerary.itinerary_json.setdefault("source", {})["fingerprint"] = fingerprint
                        itinerary.save(update_fields=["itinerary_json", "updated_at"])
                        ItineraryTranslation.objects.create(
                            itinerary=itinerary,
                            language_code=language,
                            title=stage.title,
                            description=self.stage_description(stage, plan),
                            slug=slugify(stage.title)[:255],
                            is_reference=True,
                        )
                        created_itinerary_count += 1
                    else:
                        reused_itinerary_count += 1
                    itinerary_by_fingerprint[fingerprint] = itinerary
                    if itinerary.id in route_itinerary_ids:
                        skipped_duplicate_stage_count += 1
                        continue
                    route_itinerary_ids.add(itinerary.id)
                    RouteStage.objects.create(
                        route=route,
                        itinerary=itinerary,
                        stage_number=next_stage_number,
                    )
                    next_stage_number += 1
                    imported_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {imported_count} route stages into {len(prepared_routes)} routes "
                f"({created_itinerary_count} new itineraries, {reused_itinerary_count} reused, "
                f"{skipped_duplicate_stage_count} duplicate stages skipped)."
            )
        )

    def build_route_plans(self, source_dir, include_variants=False):
        country_dirs = [source_dir / name / "A piedi_on foot" for name in [
            "1.Estonia",
            "2.Lettonia",
            "3.Lituania",
            "4.Polonia",
            "5.Repubblica_Ceca",
            "6.Austria",
        ]]
        italy_main_dir = source_dir / "7.Italia" / "A piedi_on foot" / "Cammino principale - Main path (Tarvisio-Roma)"
        vatican_dir = source_dir / "8.Vatican"

        main_files = []
        for directory in country_dirs + [italy_main_dir, vatican_dir]:
            main_files.extend(self.importable_files(directory, include_variants))

        plans = []
        if main_files:
            plans.append(
                GpxRoutePlan(
                    title=self.base_route_title,
                    slug=self.base_route_slug,
                    description=f"Official Romea Strata GPX main route imported from {source_dir}.",
                    files=main_files,
                )
            )

        branches_dir = source_dir / "7.Italia" / "A piedi_on foot" / "Diramazioni - Branches"
        romee_dir = source_dir / "7.Italia" / "A piedi_on foot" / "Romee"
        for parent in (branches_dir, romee_dir):
            if not parent.exists():
                continue
            for directory in sorted((path for path in parent.iterdir() if path.is_dir()), key=lambda item: item.name.lower()):
                files = self.importable_files(directory, include_variants)
                if not files:
                    continue
                title = f"{self.base_route_title}: {directory.name}"
                plans.append(
                    GpxRoutePlan(
                        title=title,
                        slug=slugify(title),
                        description=f"Official Romea Strata GPX branch imported from {directory}.",
                        files=files,
                    )
                )

        return plans

    def importable_files(self, directory, include_variants):
        if not directory.exists():
            return []
        files = sorted(directory.glob("*.gpx"), key=natural_sort_key)
        if include_variants:
            return files
        return [path for path in files if not is_variant_path(path)]

    def get_or_create_route(self, plan, language):
        route_translation = RouteTranslation.objects.select_related("route").filter(
            language_code=language,
            slug=plan.slug,
        ).first()
        if route_translation:
            return route_translation.route

        route = Route.objects.create(enabled=True)
        RouteTranslation.objects.create(
            route=route,
            language_code=language,
            title=plan.title,
            description=plan.description,
            slug=plan.slug,
            is_reference=True,
        )
        return route

    def find_existing_itinerary(self, fingerprint):
        return Itinerary.objects.filter(itinerary_json__source__fingerprint=fingerprint).first()

    def stage_description(self, stage, plan):
        details = [
            f"Imported from official Romea Strata GPX file: {stage.path.name}.",
            f"Route: {plan.title}.",
        ]
        if stage.is_variant:
            details.append("This itinerary was marked as a variant or detour by filename and imported disabled.")
        if stage.track_count != 1:
            details.append(f"The GPX file contains {stage.track_count} tracks.")
        return " ".join(details)

    def write_dry_run(self, source_dir, prepared_routes):
        total_stages = sum(len(stages) for _, stages in prepared_routes)
        total_waypoints = sum(stage.waypoint_count for _, stages in prepared_routes for stage in stages)
        variant_stages = sum(1 for _, stages in prepared_routes for stage in stages if stage.is_variant)
        multi_track_stages = [
            stage for _, stages in prepared_routes for stage in stages if stage.track_count != 1
        ]

        self.stdout.write(f"Source directory: {source_dir}")
        self.stdout.write(f"Routes: {len(prepared_routes)}")
        self.stdout.write(f"Importable itineraries: {total_stages}")
        self.stdout.write(f"Variant/detour itineraries: {variant_stages}")
        self.stdout.write(f"GPX waypoints found: {total_waypoints}")
        self.stdout.write(f"Multi-track GPX files: {len(multi_track_stages)}")
        for plan, stages in prepared_routes:
            self.stdout.write(f"- {plan.title} ({plan.slug}): {len(stages)} stages")
        for stage in multi_track_stages:
            self.stdout.write(f"  warning: {stage.path} contains {stage.track_count} tracks")
