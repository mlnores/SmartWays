import math
from pathlib import Path
import sys
import time

from django.core.management.base import CommandError
from django.db import transaction

from pois.management.commands.import_rurallure_dump import Command as RurallureDumpImportCommand
from pois.models import Category, CategoryTranslation, Itinerary, POI, POIMedia, POITranslation


EARTH_RADIUS_METERS = 6371000


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
    def __init__(self, coordinates, max_distance_meters):
        self.max_distance_meters = max_distance_meters
        self.cell_size = max(max_distance_meters, 1)
        self.grid = {}
        for coordinate in coordinates:
            key = self.grid_key(coordinate)
            self.grid.setdefault(key, []).append(coordinate)

    @classmethod
    def from_database(cls, max_distance_meters):
        coordinates = [
            (poi.location.x, poi.location.y)
            for poi in POI.objects.only("location")
            if poi.location
        ]
        return cls(coordinates, max_distance_meters)

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
                    distance = haversine_meters(point, candidate)
                    if distance <= self.max_distance_meters and (nearest is None or distance < nearest):
                        nearest = distance
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
            proximity_stats = self.existing_poi_proximity_stats(
                filtered_data["public.point_of_interest"],
                self.parse_existing_poi_distance_thresholds(options["existing_poi_distance_meters"]),
            )
            for key, value in proximity_stats.items():
                self.stdout.write(f"{key}: {value}")
            return

        country_boundaries_path = Path(options["country_boundaries"]).expanduser().resolve()
        if not options["skip_country_annotation"] and not country_boundaries_path.exists():
            raise CommandError(
                "Country boundaries file not found: "
                f"{country_boundaries_path}. Download geoBoundaries ADM0 GeoJSON there, pass "
                "--country-boundaries, or use --skip-country-annotation."
            )

        if not options["clear"] and any(
            model.objects.exists() for model in (POI, POITranslation, Category, CategoryTranslation, POIMedia)
        ):
            raise CommandError("Target POI tables are not empty. Re-run with --clear or start from an empty database.")

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
