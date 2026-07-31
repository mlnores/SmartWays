import math
from pathlib import Path
import sys
import time

from django.contrib.gis.geos import Point
from django.core.management.base import CommandError
from django.db import transaction
from django.utils import timezone

from pois.management.commands.import_rurallure_dump import (
    Command as RurallureDumpImportCommand,
    CountryBoundaryLookup,
    parse_bool,
    unique_slug,
)
from pois.models import Category, CategoryTranslation, Itinerary, POI, POIMedia, POITranslation


EARTH_RADIUS_METERS = 6371000
METADATA_MERGE_DISTANCE_METERS = 10
CURATED_DUMP_POI_MERGES = {
    "8e5d77fe-afc3-4269-a039-f9e48ca189ad": 1575,
    "c565cd03-6159-419d-9ae3-5b48192902fa": 2241,
    "9a0d4f57-4767-43e2-a235-6f1a84f230fe": 2142,
    "0786732b-d9b0-48ca-9e97-947a44a33f0e": 2087,
    "8ec4c43f-6bad-46cc-82ee-1e440ac63162": 1982,
    "dcf48c79-cc42-46b5-80bb-f4ad370d4531": 1951,
    "3b8aac75-e59f-4a61-86e7-f91dd93f10db": 2150,
    "7ecc2428-dc06-42e2-bce1-4c905156fbb0": 1457,
    "28a1c3f8-fd02-4ad0-b94a-726b15b87ac6": 2099,
    "44a6caf9-292e-4b6a-9ad4-23cc91d6614b": 2169,
    "2e1a6db7-0719-4b66-ac4c-ab7048c8d50d": 2177,
    "82964de8-07ee-49d3-968f-adf21afa3b5d": 2098,
    "3c1f1305-7ffb-4761-a61b-9fc74fdb6f99": 2108,
    "cc2eda10-6923-41e5-b917-3f1379051dad": 1573,
}


class ProgressReporter:
    def __init__(self, stdout, label, total, every_seconds=2):
        self.stdout = stdout
        self.label = label
        self.total = total
        self.every_seconds = every_seconds
        self.started_at = time.monotonic()
        self.last_report_at = 0
        self.finished = False
        self.last_reported_current = None

    def update(self, current):
        if self.total <= 0:
            return
        if current == self.last_reported_current:
            return
        now = time.monotonic()
        if current < self.total and now - self.last_report_at < self.every_seconds:
            return
        self.last_report_at = now
        self.last_reported_current = current
        percent = current / self.total
        bar_width = 28
        filled = min(bar_width, int(percent * bar_width))
        bar = "#" * filled + "-" * (bar_width - filled)
        elapsed = max(now - self.started_at, 0.001)
        rate = current / elapsed
        remaining = (self.total - current) / rate if rate > 0 else 0
        message = (
            f"\r{self.label}: [{bar}] {current}/{self.total} "
            f"({percent:.0%}) elapsed {elapsed:.0f}s"
        )
        if current < self.total:
            message += f", eta {remaining:.0f}s"
        self.stdout.write(message, ending="")
        try:
            self.stdout.flush()
        except AttributeError:
            sys.stdout.flush()

    def finish(self):
        if not self.finished:
            self.last_report_at = 0
            self.update(self.total)
            self.finished = True
        self.stdout.write("")


def finite_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def haversine_meters(left, right):
    left_lon, left_lat = left
    right_lon, right_lat = right
    left_lat_radians = math.radians(left_lat)
    right_lat_radians = math.radians(right_lat)
    delta_lat = math.radians(right_lat - left_lat)
    delta_lon = math.radians(right_lon - left_lon)
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(left_lat_radians)
        * math.cos(right_lat_radians)
        * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METERS * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def projected_xy(coordinate, reference_latitude):
    lon, lat = coordinate
    return (
        EARTH_RADIUS_METERS * math.radians(lon) * math.cos(math.radians(reference_latitude)),
        EARTH_RADIUS_METERS * math.radians(lat),
    )


def point_to_segment_distance_meters(point, start, end):
    if start == end:
        return haversine_meters(point, start)

    reference_latitude = (point[1] + start[1] + end[1]) / 3
    px, py = projected_xy(point, reference_latitude)
    sx, sy = projected_xy(start, reference_latitude)
    ex, ey = projected_xy(end, reference_latitude)
    dx = ex - sx
    dy = ey - sy
    length_squared = dx * dx + dy * dy
    if length_squared <= 0:
        return haversine_meters(point, start)

    ratio = max(0, min(1, ((px - sx) * dx + (py - sy) * dy) / length_squared))
    closest = (sx + ratio * dx, sy + ratio * dy)
    return math.hypot(px - closest[0], py - closest[1])


def point_from_json(value):
    if not isinstance(value, dict):
        return None
    coordinates = value.get("coordinates") if isinstance(value.get("coordinates"), dict) else {}
    lat = finite_float(coordinates.get("lat", value.get("lat")))
    lon = finite_float(coordinates.get("lng", value.get("lng")))
    if lat is None or lon is None:
        return None
    return lon, lat


def coordinate_pair(value):
    if (
        isinstance(value, list)
        and len(value) >= 2
        and finite_float(value[0]) is not None
        and finite_float(value[1]) is not None
    ):
        return finite_float(value[0]), finite_float(value[1])
    return None


def line_coordinates_from_geometry(geometry):
    if not isinstance(geometry, dict):
        return []

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, list):
        line = [coordinate_pair(coordinate) for coordinate in coordinates]
        return [[coordinate for coordinate in line if coordinate is not None]]
    if geometry_type == "MultiLineString" and isinstance(coordinates, list):
        lines = []
        for raw_line in coordinates:
            line = [coordinate_pair(coordinate) for coordinate in raw_line or []]
            line = [coordinate for coordinate in line if coordinate is not None]
            if line:
                lines.append(line)
        return lines
    if geometry_type == "GeometryCollection":
        lines = []
        for child in geometry.get("geometries") or []:
            lines.extend(line_coordinates_from_geometry(child))
        return lines
    return []


def itinerary_lines(itinerary_json):
    if not isinstance(itinerary_json, dict):
        return []

    points = [point_from_json(point) for point in itinerary_json.get("points") or []]
    segments = itinerary_json.get("segments") or []
    lines = []
    segment_count = max(max(len(points) - 1, 0), len(segments))

    for index in range(segment_count):
        selected_route = (segments[index] or {}).get("selectedWalkingRoute") if index < len(segments) else None
        geometry_lines = line_coordinates_from_geometry((selected_route or {}).get("geometry"))
        if geometry_lines:
            lines.extend(line for line in geometry_lines if len(line) >= 2)
            continue

        start = points[index] if index < len(points) else None
        end = points[index + 1] if index + 1 < len(points) else None
        if start and end:
            lines.append([start, end])

    if not lines:
        lines.extend([[point] for point in points if point])
    return lines


class ItineraryDistanceIndex:
    def __init__(self, lines, max_distance_km):
        self.max_distance_meters = max_distance_km * 1000
        self.segments = []
        self.points = []
        for line in lines:
            if len(line) == 1:
                self.points.append(line[0])
                continue
            for start, end in zip(line, line[1:]):
                max_abs_latitude = max(abs(start[1]), abs(end[1]))
                latitude_margin = max_distance_km / 111
                longitude_margin = max_distance_km / (
                    111 * max(math.cos(math.radians(max_abs_latitude)), 0.1)
                )
                self.segments.append((
                    (
                        min(start[0], end[0]) - longitude_margin,
                        min(start[1], end[1]) - latitude_margin,
                        max(start[0], end[0]) + longitude_margin,
                        max(start[1], end[1]) + latitude_margin,
                    ),
                    start,
                    end,
                ))

    @classmethod
    def from_database(cls, max_distance_km):
        lines = []
        for itinerary in Itinerary.objects.only("itinerary_json"):
            lines.extend(itinerary_lines(itinerary.itinerary_json))
        return cls(lines, max_distance_km)

    def distance_meters(self, point):
        distances = []
        lon, lat = point
        for segment_bounds, start, end in self.segments:
            min_lon, min_lat, max_lon, max_lat = segment_bounds
            if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
                continue
            distances.append(point_to_segment_distance_meters(point, start, end))
        for itinerary_point in self.points:
            distances.append(haversine_meters(point, itinerary_point))
        return min(distances) if distances else None


class ExistingPoiDistanceIndex:
    def __init__(self, records, max_distance_meters):
        self.max_distance_meters = max_distance_meters
        self.cell_size = max(max_distance_meters, 1)
        self.grid = {}
        for record in records:
            if isinstance(record, dict):
                coordinate = record["coordinate"]
            else:
                coordinate = record
                record = {"coordinate": coordinate, "poi": None, "translations": []}
            key = self.grid_key(coordinate)
            self.grid.setdefault(key, []).append(record)

    @classmethod
    def from_database(cls, max_distance_meters):
        records = []
        pois = POI.objects.prefetch_related("translations").only(
            "id",
            "country_code",
            "location",
            "website",
            "phone",
            "email",
        )
        for poi in pois:
            if not poi.location:
                continue
            records.append({
                "coordinate": (poi.location.x, poi.location.y),
                "poi": poi,
                "translations": list(poi.translations.all()),
            })
        return cls(records, max_distance_meters)

    @property
    def poi_count(self):
        return sum(len(coordinates) for coordinates in self.grid.values())

    def grid_key(self, coordinate):
        lon, lat = coordinate
        x = EARTH_RADIUS_METERS * math.radians(lon)
        y = EARTH_RADIUS_METERS * math.radians(lat)
        return math.floor(x / self.cell_size), math.floor(y / self.cell_size)

    def nearest_distance_meters(self, point):
        if not self.grid:
            return None

        center_x, center_y = self.grid_key(point)
        lon, lat = point
        longitude_scale = max(math.cos(math.radians(abs(lat))), 0.2)
        neighbor_radius = max(1, math.ceil(1 / longitude_scale) + 1)
        nearest = None

        for x in range(center_x - neighbor_radius, center_x + neighbor_radius + 1):
            for y in range(center_y - neighbor_radius, center_y + neighbor_radius + 1):
                for candidate in self.grid.get((x, y), []):
                    distance = haversine_meters(point, candidate["coordinate"])
                    if distance <= self.max_distance_meters and (nearest is None or distance < nearest):
                        nearest = distance
        return nearest

    def nearest_match(self, point):
        if not self.grid:
            return None

        center_x, center_y = self.grid_key(point)
        lon, lat = point
        longitude_scale = max(math.cos(math.radians(abs(lat))), 0.2)
        neighbor_radius = max(1, math.ceil(1 / longitude_scale) + 1)
        nearest = None

        for x in range(center_x - neighbor_radius, center_x + neighbor_radius + 1):
            for y in range(center_y - neighbor_radius, center_y + neighbor_radius + 1):
                for candidate in self.grid.get((x, y), []):
                    distance = haversine_meters(point, candidate["coordinate"])
                    if distance <= self.max_distance_meters and (
                        nearest is None or distance < nearest["distance_meters"]
                    ):
                        nearest = {
                            "distance_meters": distance,
                            "record": candidate,
                        }
        return nearest


class Command(RurallureDumpImportCommand):
    help = (
        "Import POIs from the RurAllure dump only when they fall within a distance range "
        "from any itinerary currently stored in the database."
    )

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--min-distance-km",
            type=float,
            default=0,
            help="Minimum distance in kilometers from any itinerary. Defaults to 0.",
        )
        parser.add_argument(
            "--max-distance-km",
            type=float,
            default=25,
            help="Maximum distance in kilometers from any itinerary. Defaults to 25.",
        )
        parser.add_argument(
            "--existing-poi-distance-meters",
            default="2,5,10",
            help=(
                "Comma-separated meter thresholds reported during dry-run for dump POIs near existing POIs. "
                "Defaults to 2,5,10."
            ),
        )

    def handle(self, *args, **options):
        min_distance_km = options["min_distance_km"]
        max_distance_km = options["max_distance_km"]
        if min_distance_km < 0 or max_distance_km < 0:
            raise CommandError("Distance values must not be negative.")
        if min_distance_km > max_distance_km:
            raise CommandError("--min-distance-km must be lower than or equal to --max-distance-km.")
        if not Itinerary.objects.exists():
            raise CommandError("No itineraries exist in the database.")

        self.stdout.write("Building itinerary distance index...")
        distance_index = ItineraryDistanceIndex.from_database(max_distance_km)
        if not distance_index.segments and not distance_index.points:
            raise CommandError("No usable coordinates were found in the saved itineraries.")
        self.stdout.write(
            f"Distance index ready: {len(distance_index.segments)} path segments, "
            f"{len(distance_index.points)} standalone points."
        )

        dump_path = Path(options["dump_path"]).expanduser().resolve()
        if not dump_path.exists():
            raise CommandError(f"Dump file not found: {dump_path}")

        self.stdout.write(f"Parsing {dump_path}...")
        data = self.load_dump_data(dump_path)
        self.stdout.write(f"Parsed {dump_path}")
        self.stdout.write(
            f"Filtering POIs within {min_distance_km:g}-{max_distance_km:g} km of saved itineraries..."
        )
        filtered_data, filter_stats = self.filter_data_by_distance_range(
            data,
            distance_index,
            min_distance_km,
            max_distance_km,
        )

        if options["dry_run"]:
            self.report_loaded_data(filtered_data)
            for key, value in filter_stats.items():
                self.stdout.write(f"{key}: {value}")
            thresholds_meters = self.parse_existing_poi_distance_thresholds(options["existing_poi_distance_meters"])
            discarded_placeholder_ids = self.first_translation_placeholder_title_poi_ids(
                filtered_data["public.point_of_interest_translation"]
            )
            curated_merge_candidates = self.curated_poi_merge_candidates(filtered_data)
            metadata_merge_candidates = self.existing_poi_metadata_merge_candidates(
                filtered_data,
                METADATA_MERGE_DISTANCE_METERS,
                excluded_source_ids=discarded_placeholder_ids
                | {candidate["dump_poi"]["id"] for candidate in curated_merge_candidates},
            )
            proximity_stats = self.existing_poi_proximity_stats(
                filtered_data["public.point_of_interest"],
                thresholds_meters,
            )
            for key, value in proximity_stats.items():
                self.stdout.write(f"{key}: {value}")
            self.report_discarded_placeholder_title_pois(filtered_data, discarded_placeholder_ids)
            self.report_curated_poi_merge_candidates(curated_merge_candidates)
            self.report_existing_poi_metadata_merge_candidates(
                metadata_merge_candidates,
                METADATA_MERGE_DISTANCE_METERS,
            )
            coincidences = self.existing_poi_coincidences(filtered_data, max(thresholds_meters))
            merge_source_ids = {
                candidate["dump_poi"]["id"]
                for candidate in [*curated_merge_candidates, *metadata_merge_candidates]
            } | discarded_placeholder_ids
            coincidences = [
                coincidence
                for coincidence in coincidences
                if coincidence["dump_poi"]["id"] not in merge_source_ids
            ]
            self.report_existing_poi_coincidences(coincidences, max(thresholds_meters))
            return

        country_boundaries_path = Path(options["country_boundaries"]).expanduser().resolve()
        if not options["skip_country_annotation"] and not country_boundaries_path.exists():
            raise CommandError(
                "Country boundaries file not found: "
                f"{country_boundaries_path}. Download geoBoundaries ADM0 GeoJSON there, pass "
                "--country-boundaries, or use --skip-country-annotation."
            )

        with transaction.atomic():
            if options["clear"]:
                self.stdout.write("Clearing existing POI tables...")
                POIMedia.objects.all().delete()
                POITranslation.objects.all().delete()
                POI.objects.all().delete()
                CategoryTranslation.objects.all().delete()
                Category.objects.all().delete()

            self.stdout.write("Importing filtered POI data into the database...")
            import_progress = ProgressReporter(self.stdout, "Database import", 6)

            import_progress_current = 0

            def update_import_progress(_label):
                nonlocal import_progress_current
                import_progress_current += 1
                import_progress.update(import_progress_current)

            stats = self.import_data(
                filtered_data,
                options["image_base_url"],
                country_boundaries_path=None if options["skip_country_annotation"] else country_boundaries_path,
                progress_callback=update_import_progress,
            )
            import_progress.finish()

        self.stdout.write(self.style.SUCCESS("Import completed."))
        for key, value in {**filter_stats, **stats}.items():
            self.stdout.write(f"{key}: {value}")

    def filter_data_by_distance_range(self, data, distance_index, min_distance_km, max_distance_km):
        min_distance_meters = min_distance_km * 1000
        max_distance_meters = max_distance_km * 1000
        matching_poi_ids = set()
        skipped_without_coordinates = 0
        skipped_outside_distance_range = 0

        poi_rows = data["public.point_of_interest"]
        progress = ProgressReporter(self.stdout, "Distance filter", len(poi_rows))
        for index, row in enumerate(poi_rows, start=1):
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            if latitude is None or longitude is None:
                skipped_without_coordinates += 1
                progress.update(index)
                continue

            distance = distance_index.distance_meters((longitude, latitude))
            if distance is not None and min_distance_meters <= distance <= max_distance_meters:
                matching_poi_ids.add(row["id"])
            else:
                skipped_outside_distance_range += 1
            progress.update(index)
        progress.finish()

        self.stdout.write(f"Distance filter matched {len(matching_poi_ids)} POIs.")

        filtered_data = {table_name: list(rows) for table_name, rows in data.items()}
        filtered_data["public.point_of_interest"] = [
            row for row in data["public.point_of_interest"] if row["id"] in matching_poi_ids
        ]
        filtered_data["public.point_of_interest_translation"] = [
            row for row in data["public.point_of_interest_translation"] if row["point_of_interest_id"] in matching_poi_ids
        ]
        filtered_data["public.point_of_interest_category"] = [
            row for row in data["public.point_of_interest_category"] if row["point_of_interest_id"] in matching_poi_ids
        ]
        filtered_data["public.image_point_of_interest"] = [
            row for row in data["public.image_point_of_interest"] if row["point_of_interest_id"] in matching_poi_ids
        ]

        matching_category_ids = {
            row["category_id"] for row in filtered_data["public.point_of_interest_category"]
        }
        filtered_data["public.category"] = [
            row for row in data["public.category"] if row["id"] in matching_category_ids
        ]
        filtered_data["public.category_translation"] = [
            row for row in data["public.category_translation"] if row["category_id"] in matching_category_ids
        ]

        matching_file_ids = {
            row["file_uploaded_id"] for row in filtered_data["public.image_point_of_interest"]
        }
        filtered_data["public.file_uploaded"] = [
            row for row in data["public.file_uploaded"] if row["id"] in matching_file_ids
        ]

        return filtered_data, {
            "pois_matching_distance_range": len(matching_poi_ids),
            "pois_skipped_by_distance_filter_without_coordinates": skipped_without_coordinates,
            "pois_skipped_outside_distance_range": skipped_outside_distance_range,
        }

    def parse_existing_poi_distance_thresholds(self, value):
        thresholds = []
        for raw_threshold in (value or "").split(","):
            raw_threshold = raw_threshold.strip()
            if not raw_threshold:
                continue
            try:
                threshold = float(raw_threshold)
            except ValueError:
                raise CommandError("--existing-poi-distance-meters must contain comma-separated numbers.")
            if threshold <= 0:
                raise CommandError("--existing-poi-distance-meters thresholds must be positive.")
            thresholds.append(threshold)
        if not thresholds:
            raise CommandError("--existing-poi-distance-meters must contain at least one threshold.")
        return sorted(set(thresholds))

    def existing_poi_proximity_stats(self, poi_rows, thresholds_meters):
        max_threshold = max(thresholds_meters)
        index = ExistingPoiDistanceIndex.from_database(max_threshold)
        stats = {
            "existing_pois_indexed_for_proximity": index.poi_count,
            "dump_pois_checked_for_existing_poi_proximity": 0,
            "dump_pois_skipped_for_existing_poi_proximity_without_coordinates": 0,
        }
        for threshold in thresholds_meters:
            stats[f"dump_pois_within_{threshold:g}m_of_existing_poi"] = 0

        progress = ProgressReporter(self.stdout, "Existing POI proximity check", len(poi_rows))
        for row_index, row in enumerate(poi_rows, start=1):
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            if latitude is None or longitude is None:
                stats["dump_pois_skipped_for_existing_poi_proximity_without_coordinates"] += 1
                progress.update(row_index)
                continue

            stats["dump_pois_checked_for_existing_poi_proximity"] += 1
            nearest_distance = index.nearest_distance_meters((longitude, latitude))
            if nearest_distance is not None:
                for threshold in thresholds_meters:
                    if nearest_distance <= threshold:
                        stats[f"dump_pois_within_{threshold:g}m_of_existing_poi"] += 1
            progress.update(row_index)
        progress.finish()
        return stats

    def import_data(self, data, image_base_url, country_boundaries_path, progress_callback=None):
        def report_progress(_label):
            if progress_callback:
                progress_callback(_label)

        imported_at = timezone.now()
        language_codes = self.build_language_codes(data["public.languages"])
        discarded_placeholder_ids = self.first_translation_placeholder_title_poi_ids(
            data["public.point_of_interest_translation"]
        )
        curated_merge_candidates = self.curated_poi_merge_candidates(data)
        metadata_merge_candidates = self.existing_poi_metadata_merge_candidates(
            data,
            METADATA_MERGE_DISTANCE_METERS,
            excluded_source_ids=discarded_placeholder_ids
            | {candidate["dump_poi"]["id"] for candidate in curated_merge_candidates},
        )
        all_metadata_merge_candidates = [*curated_merge_candidates, *metadata_merge_candidates]
        metadata_merge_pois_by_source_id = {
            candidate["dump_poi"]["id"]: candidate["existing_poi"]
            for candidate in all_metadata_merge_candidates
        }
        metadata_merge_source_ids = set(metadata_merge_pois_by_source_id)
        poi_create_data = self.data_without_pois(data, discarded_placeholder_ids | metadata_merge_source_ids)
        category_data = self.data_without_pois(data, discarded_placeholder_ids)
        country_codes_by_name = self.build_country_codes_by_name(data["public.countries"])
        country_lookup = None
        if country_boundaries_path:
            country_lookup = CountryBoundaryLookup.from_geojson(country_boundaries_path, country_codes_by_name)
        report_progress("prepared")

        categories_by_source_id, category_stats = self.import_categories(
            category_data["public.category"],
            category_data["public.category_translation"],
            language_codes,
            imported_at,
        )
        report_progress("categories")
        valid_translation_rows_by_poi = self.valid_poi_translation_rows_by_poi(
            poi_create_data["public.point_of_interest_translation"],
            language_codes,
        )
        pois_by_source_id, poi_stats = self.import_pois(
            poi_create_data["public.point_of_interest"],
            valid_translation_rows_by_poi,
            imported_at,
            country_lookup,
        )
        metadata_poi_stats = self.update_curated_poi_merges(
            data,
            all_metadata_merge_candidates,
            language_codes,
            country_lookup,
            imported_at,
        )
        report_progress("pois")
        translation_stats = self.import_poi_translations(
            valid_translation_rows_by_poi,
            pois_by_source_id,
        )
        report_progress("translations")
        pois_by_source_id.update(metadata_merge_pois_by_source_id)
        relation_stats = self.import_category_relations(
            category_data["public.point_of_interest_category"],
            pois_by_source_id,
            categories_by_source_id,
        )
        report_progress("category links")

        image_rows = [
            row
            for row in data["public.image_point_of_interest"]
            if row["point_of_interest_id"] not in discarded_placeholder_ids
        ]
        media_stats = self.import_media(
            data["public.file_uploaded"],
            image_rows,
            pois_by_source_id,
            image_base_url,
        )
        report_progress("media")

        return {
            **category_stats,
            **poi_stats,
            **metadata_poi_stats,
            **translation_stats,
            **relation_stats,
            **media_stats,
            "dump_pois_discarded_with_placeholder_first_translation_title": len(discarded_placeholder_ids),
            "dump_pois_automatically_merged_into_existing_pois_with_dump_metadata": len(metadata_merge_candidates),
            "dump_pois_curated_merged_into_existing_pois_with_dump_metadata": len(curated_merge_candidates),
            "dump_poi_metadata_merge_distance_meters": METADATA_MERGE_DISTANCE_METERS,
        }

    def data_without_pois(self, data, excluded_poi_ids):
        filtered_data = {table_name: list(rows) for table_name, rows in data.items()}
        filtered_data["public.point_of_interest"] = [
            row for row in data["public.point_of_interest"] if row["id"] not in excluded_poi_ids
        ]
        filtered_data["public.point_of_interest_translation"] = [
            row
            for row in data["public.point_of_interest_translation"]
            if row["point_of_interest_id"] not in excluded_poi_ids
        ]
        filtered_data["public.point_of_interest_category"] = [
            row
            for row in data["public.point_of_interest_category"]
            if row["point_of_interest_id"] not in excluded_poi_ids
        ]

        matching_category_ids = {
            row["category_id"] for row in filtered_data["public.point_of_interest_category"]
        }
        filtered_data["public.category"] = [
            row for row in data["public.category"] if row["id"] in matching_category_ids
        ]
        filtered_data["public.category_translation"] = [
            row for row in data["public.category_translation"] if row["category_id"] in matching_category_ids
        ]
        return filtered_data

    def first_translation_placeholder_title_poi_ids(self, translation_rows):
        first_translation_by_poi = {}
        for row in translation_rows:
            first_translation_by_poi.setdefault(row["point_of_interest_id"], row)
        return {
            poi_id
            for poi_id, row in first_translation_by_poi.items()
            if self.is_placeholder_text(row.get("title"))
        }

    def is_placeholder_text(self, value):
        text = (value or "").strip()
        return text == "..." or (text and set(text) == {"."})

    def report_discarded_placeholder_title_pois(self, data, discarded_poi_ids):
        if not discarded_poi_ids:
            self.stdout.write("Dump POIs discarded because the first translation title is placeholder: 0")
            return

        self.stdout.write(
            f"Dump POIs discarded because the first translation title is placeholder: {len(discarded_poi_ids)}"
        )
        rows_by_source_id = {
            row["id"]: row
            for row in data["public.point_of_interest"]
            if row["id"] in discarded_poi_ids
        }
        for index, source_id in enumerate(sorted(discarded_poi_ids), start=1):
            row = rows_by_source_id.get(source_id)
            coordinates = "-"
            if row:
                coordinates = f"({row['gps_latitude']}, {row['gps_longitude']})"
            self.stdout.write(f"{index}. dump_id={source_id} coordinates={coordinates}")

    def existing_poi_metadata_merge_candidates(self, data, threshold_meters, excluded_source_ids=None):
        excluded_source_ids = excluded_source_ids or set()
        index = ExistingPoiDistanceIndex.from_database(threshold_meters)
        candidates = []
        for row in data["public.point_of_interest"]:
            if row["id"] in excluded_source_ids:
                continue
            if not parse_bool(row.get("enabled"), default=True):
                continue
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            if latitude is None or longitude is None:
                continue

            match = index.nearest_match((longitude, latitude))
            if not match or not match["record"]["poi"]:
                continue
            candidates.append({
                "distance_meters": match["distance_meters"],
                "dump_poi": row,
                "existing_poi": match["record"]["poi"],
            })
        return sorted(candidates, key=lambda item: item["distance_meters"])

    def report_existing_poi_metadata_merge_candidates(self, candidates, threshold_meters):
        if not candidates:
            self.stdout.write(f"No automatic dump metadata merge candidates within {threshold_meters:g}m.")
            return

        self.stdout.write(f"Automatic dump metadata merge candidates within {threshold_meters:g}m: {len(candidates)}")
        self.stdout.write(
            "These dump POIs will overwrite the existing POI coordinates and translations, and attach dump media."
        )
        for index, candidate in enumerate(candidates, start=1):
            dump_poi = candidate["dump_poi"]
            existing_poi = candidate["existing_poi"]
            self.stdout.write(
                f"{index}. distance={candidate['distance_meters']:.2f}m "
                f"dump_id={dump_poi['id']} existing_id={existing_poi.id} "
                f"coordinates=({dump_poi['gps_latitude']}, {dump_poi['gps_longitude']})"
            )

    def curated_poi_merge_candidates(self, data):
        rows_by_source_id = {
            row["id"]: row
            for row in data["public.point_of_interest"]
            if row["id"] in CURATED_DUMP_POI_MERGES
        }
        existing_pois_by_id = POI.objects.in_bulk(CURATED_DUMP_POI_MERGES.values())
        candidates = []
        for source_id, existing_id in CURATED_DUMP_POI_MERGES.items():
            row = rows_by_source_id.get(source_id)
            existing_poi = existing_pois_by_id.get(existing_id)
            if not row or not existing_poi:
                continue
            if not parse_bool(row.get("enabled"), default=True):
                continue
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            distance = None
            if latitude is not None and longitude is not None and existing_poi.location:
                distance = haversine_meters((longitude, latitude), (existing_poi.location.x, existing_poi.location.y))
            candidates.append({
                "distance_meters": distance,
                "dump_poi": row,
                "existing_poi": existing_poi,
            })
        return candidates

    def report_curated_poi_merge_candidates(self, candidates):
        self.stdout.write(f"Curated dump POI merges configured: {len(CURATED_DUMP_POI_MERGES)}")
        if not candidates:
            self.stdout.write("Curated dump POI merges found in filtered data: 0")
            return

        self.stdout.write(f"Curated dump POI merges found in filtered data: {len(candidates)}")
        self.stdout.write(
            "These dump POIs will overwrite the existing POI coordinates and translations, and attach dump media."
        )
        for index, candidate in enumerate(candidates, start=1):
            dump_poi = candidate["dump_poi"]
            existing_poi = candidate["existing_poi"]
            distance = candidate["distance_meters"]
            distance_text = f"{distance:.2f}m" if distance is not None else "-"
            self.stdout.write(
                f"{index}. distance={distance_text} "
                f"dump_id={dump_poi['id']} existing_id={existing_poi.id} "
                f"coordinates=({dump_poi['gps_latitude']}, {dump_poi['gps_longitude']})"
            )

    def update_curated_poi_merges(self, data, candidates, language_codes, country_lookup, imported_at):
        if not candidates:
            return {
                "dump_pois_merged_into_existing_pois_with_dump_metadata": 0,
                "dump_poi_metadata_merge_translations_created": 0,
                "dump_poi_metadata_merge_rows_skipped_without_coordinates": 0,
            }

        translation_rows_by_poi = self.valid_poi_translation_rows_by_poi(
            [
                row
                for row in data["public.point_of_interest_translation"]
                if row["point_of_interest_id"] in {candidate["dump_poi"]["id"] for candidate in candidates}
            ],
            language_codes,
        )
        merged_count = 0
        translations_created = 0
        skipped_without_coordinates = 0

        for candidate in candidates:
            row = candidate["dump_poi"]
            poi = candidate["existing_poi"]
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            if latitude is None or longitude is None:
                skipped_without_coordinates += 1
                continue

            poi.location = Point(longitude, latitude, srid=4326)
            if country_lookup:
                poi.country_code = country_lookup.country_code_for_point(poi.location)
            poi.website = (row.get("website") or "")[:200]
            poi.updated_at = imported_at
            poi.save(update_fields=["location", "country_code", "website", "updated_at"])

            translation_rows = translation_rows_by_poi.get(row["id"], [])
            if translation_rows:
                POITranslation.objects.filter(poi=poi).delete()
                translations_created += self.create_curated_poi_translations(
                    poi,
                    row["id"],
                    translation_rows,
                )
            merged_count += 1

        validation_stats = translation_rows_by_poi.get("_stats", {})
        return {
            "dump_pois_merged_into_existing_pois_with_dump_metadata": merged_count,
            "dump_poi_metadata_merge_translations_created": translations_created,
            "dump_poi_metadata_merge_rows_skipped_without_coordinates": skipped_without_coordinates,
            **{
                f"dump_poi_metadata_merge_{key}": value
                for key, value in validation_stats.items()
            },
        }

    def create_curated_poi_translations(self, poi, source_poi_id, translation_rows):
        if not translation_rows:
            return 0

        existing_translation_ids = list(POITranslation.objects.filter(poi=poi).values_list("id", flat=True))
        used_slugs_by_language = {}
        for language_code, slug in POITranslation.objects.exclude(id__in=existing_translation_ids).values_list(
            "language_code",
            "slug",
        ):
            used_slugs_by_language.setdefault(language_code, set()).add(slug)

        translations = []
        for index, row in enumerate(translation_rows):
            language_code = row["language_code"]
            used_slugs = used_slugs_by_language.setdefault(language_code, set())
            translations.append(
                POITranslation(
                    poi=poi,
                    language_code=language_code,
                    title=row["normalized_title"],
                    description=row.get("description") or "",
                    slug=unique_slug(row.get("slug") or row["normalized_title"], used_slugs, f"poi-{source_poi_id}", 255),
                    is_reference=index == 0,
                )
            )
        POITranslation.objects.bulk_create(translations)
        return len(translations)

    def existing_poi_coincidences(self, data, threshold_meters):
        language_codes = self.build_language_codes(data["public.languages"])
        dump_translations_by_poi = {}
        for row in data["public.point_of_interest_translation"]:
            language_id = row.get("language_id")
            language_code = language_codes.get(language_id) or language_id or "-"
            dump_translations_by_poi.setdefault(row["point_of_interest_id"], []).append({
                "language_code": language_code,
                "title": row.get("title") or "",
                "description": row.get("description") or "",
            })

        index = ExistingPoiDistanceIndex.from_database(threshold_meters)
        coincidences = []
        progress = ProgressReporter(
            self.stdout,
            f"Collecting existing POI coincidences within {threshold_meters:g}m",
            len(data["public.point_of_interest"]),
        )
        for row_index, row in enumerate(data["public.point_of_interest"], start=1):
            latitude = finite_float(row["gps_latitude"])
            longitude = finite_float(row["gps_longitude"])
            if latitude is None or longitude is None:
                progress.update(row_index)
                continue

            match = index.nearest_match((longitude, latitude))
            if match:
                coincidences.append({
                    "distance_meters": match["distance_meters"],
                    "dump_poi": row,
                    "dump_translations": dump_translations_by_poi.get(row["id"], []),
                    "existing_poi": match["record"]["poi"],
                    "existing_translations": match["record"]["translations"],
                })
            progress.update(row_index)
        progress.finish()
        return sorted(coincidences, key=lambda item: item["distance_meters"])

    def report_existing_poi_coincidences(self, coincidences, threshold_meters):
        if not coincidences:
            self.stdout.write(f"No potential existing POI coincidences within {threshold_meters:g}m.")
            return

        self.stdout.write(f"Potential existing POI coincidences within {threshold_meters:g}m:")
        for index, coincidence in enumerate(coincidences, start=1):
            dump_poi = coincidence["dump_poi"]
            existing_poi = coincidence["existing_poi"]
            self.stdout.write(
                f"{index}. distance={coincidence['distance_meters']:.2f}m "
                f"dump_id={dump_poi['id']} existing_id={existing_poi.id if existing_poi else '-'} "
                f"coordinates=({dump_poi['gps_latitude']}, {dump_poi['gps_longitude']})"
            )
            self.stdout.write("   dump translations:")
            self.write_translation_lines(coincidence["dump_translations"], indent="     ")
            self.stdout.write("   existing translations:")
            self.write_translation_lines(coincidence["existing_translations"], indent="     ")

    def write_translation_lines(self, translations, indent):
        if not translations:
            self.stdout.write(f"{indent}-")
            return
        for translation in translations:
            if isinstance(translation, dict):
                language_code = translation["language_code"]
                title = translation["title"]
                description = translation["description"]
            else:
                language_code = translation.language_code
                title = translation.title
                description = translation.description
            self.stdout.write(
                f"{indent}[{language_code}] title={self.compact_report_text(title)!r} "
                f"description={self.compact_report_text(description, 220)!r}"
            )

    def compact_report_text(self, value, max_length=140):
        text = " ".join((value or "").split())
        if len(text) <= max_length:
            return text
        return text[: max_length - 3] + "..."
