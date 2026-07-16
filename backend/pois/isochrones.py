import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict
from math import ceil

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.db import transaction
from django.utils import timezone


DEFAULT_ISOCHRONE_MINUTES = (10, 20, 30)
DEFAULT_ISOCHRONE_PROFILE = "foot-walking"
DEFAULT_ISOCHRONE_PROVIDER_URL = "https://api.openrouteservice.org/v2/isochrones/{profile}"
DEFAULT_ISOCHRONE_SAMPLE_DISTANCE_METERS = 1000
DEFAULT_ISOCHRONE_BATCH_SIZE = 5
DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS = 25
DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS = 2
EARTH_RADIUS_METERS = 6371008.8
METERS_PER_DEGREE = 111320


def normalize_coordinates(coordinates):
    normalized = []
    if not isinstance(coordinates, list):
        return normalized
    for coordinate in coordinates:
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue
        try:
            lng = float(coordinate[0])
            lat = float(coordinate[1])
        except (TypeError, ValueError):
            continue
        if -180 <= lng <= 180 and -90 <= lat <= 90:
            normalized.append([lng, lat])
    return normalized


def selected_walking_segment_geometries(itinerary_json):
    if not isinstance(itinerary_json, dict):
        return []

    geometries = []
    for segment in itinerary_json.get("segments") or []:
        if not isinstance(segment, dict):
            continue
        route = segment.get("selectedWalkingRoute") or {}
        geometry = route.get("geometry") if isinstance(route, dict) else None
        if not isinstance(geometry, dict):
            continue
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates")
        if geometry_type == "LineString":
            line = normalize_coordinates(coordinates)
            if len(line) >= 2:
                geometries.append({"type": "LineString", "coordinates": line})
        elif geometry_type == "MultiLineString" and isinstance(coordinates, list):
            for line_coordinates in coordinates:
                line = normalize_coordinates(line_coordinates)
                if len(line) >= 2:
                    geometries.append({"type": "LineString", "coordinates": line})
    return geometries


def source_route_hash(geometries):
    payload = json.dumps(geometries, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def haversine_distance(left, right):
    left_lng, left_lat = [math.radians(value) for value in left[:2]]
    right_lng, right_lat = [math.radians(value) for value in right[:2]]
    dlat = right_lat - left_lat
    dlng = right_lng - left_lng
    a = math.sin(dlat / 2) ** 2 + math.cos(left_lat) * math.cos(right_lat) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * math.asin(math.sqrt(a))


def interpolate_coordinate(left, right, fraction):
    return [
        left[0] + (right[0] - left[0]) * fraction,
        left[1] + (right[1] - left[1]) * fraction,
    ]


def sample_line_coordinates(coordinates, sample_distance_meters):
    if len(coordinates) < 2:
        return []

    spacing = max(1, int(sample_distance_meters))
    samples = [coordinates[0]]
    next_sample_at = spacing
    distance_so_far = 0

    for start, end in zip(coordinates, coordinates[1:]):
        segment_length = haversine_distance(start, end)
        if segment_length <= 0:
            continue
        while next_sample_at <= distance_so_far + segment_length:
            fraction = (next_sample_at - distance_so_far) / segment_length
            samples.append(interpolate_coordinate(start, end, fraction))
            next_sample_at += spacing
        distance_so_far += segment_length

    if samples[-1] != coordinates[-1]:
        samples.append(coordinates[-1])
    return samples


def sample_walking_geometries(geometries, sample_distance_meters, max_locations=None):
    samples = []
    for geometry in geometries:
        samples.extend(sample_line_coordinates(geometry["coordinates"], sample_distance_meters))

    deduplicated = []
    seen = set()
    for lng, lat in samples:
        key = (round(lng, 6), round(lat, 6))
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append([lng, lat])

    if max_locations and len(deduplicated) > max_locations:
        if max_locations == 1:
            return [deduplicated[0]]
        step = (len(deduplicated) - 1) / (max_locations - 1)
        return [deduplicated[round(index * step)] for index in range(max_locations)]
    return deduplicated


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


class IsochroneProviderError(RuntimeError):
    pass


class OpenRouteServiceIsochroneProvider:
    def __init__(self, url=None, api_key=None, profile=DEFAULT_ISOCHRONE_PROFILE, timeout=60, pause_seconds=0):
        self.url = (url or os.environ.get("ISOCHRONE_PROVIDER_URL") or DEFAULT_ISOCHRONE_PROVIDER_URL).format(
            profile=profile
        )
        self.api_key = api_key or os.environ.get("ISOCHRONE_API_KEY") or os.environ.get("ORS_API_KEY") or ""
        self.profile = profile
        self.timeout = timeout
        self.pause_seconds = pause_seconds

    @property
    def name(self):
        return "openrouteservice"

    def fetch(self, locations, minutes, batch_size=5):
        if not self.api_key:
            raise IsochroneProviderError("Set ISOCHRONE_API_KEY or ORS_API_KEY before generating real isochrones.")

        polygons_by_minute = defaultdict(list)
        ranges = [int(minute) * 60 for minute in minutes]
        for batch in chunked(locations, max(1, batch_size)):
            payload = {
                "locations": batch,
                "range": ranges,
                "range_type": "time",
            }
            response = self._post(payload)
            for feature in response.get("features") or []:
                minute = self._feature_minutes(feature)
                if minute not in minutes:
                    continue
                geometry = feature.get("geometry")
                if geometry:
                    polygons_by_minute[minute].append(geometry)
            if self.pause_seconds:
                time.sleep(self.pause_seconds)
        return polygons_by_minute

    def _post(self, payload):
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Accept": "application/json, application/geo+json",
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise IsochroneProviderError(f"Isochrone provider returned HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise IsochroneProviderError(f"Isochrone provider request failed: {error.reason}") from error

    def _feature_minutes(self, feature):
        properties = feature.get("properties") or {}
        value = properties.get("value", properties.get("range"))
        try:
            return int(round(float(value) / 60))
        except (TypeError, ValueError):
            return None


def geometry_collection_to_multipolygon(
    geometries,
    simplify_tolerance_meters=DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS,
    smooth_iterations=DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS,
):
    geos_geometries = []
    for geometry in geometries:
        geos_geometry = GEOSGeometry(json.dumps(geometry), srid=4326)
        if geos_geometry.empty:
            continue
        if not geos_geometry.valid:
            geos_geometry = geos_geometry.buffer(0)
        geos_geometries.append(geos_geometry)

    if not geos_geometries:
        return None

    union = geos_geometries[0]
    for geos_geometry in geos_geometries[1:]:
        union = union.union(geos_geometry)
    if union.empty:
        return None
    if union.geom_type == "Polygon":
        return postprocess_multipolygon(MultiPolygon(union, srid=4326), simplify_tolerance_meters, smooth_iterations)
    if union.geom_type == "MultiPolygon":
        union.srid = 4326
        return postprocess_multipolygon(union, simplify_tolerance_meters, smooth_iterations)
    polygons = [geometry for geometry in union if geometry.geom_type == "Polygon"]
    if not polygons:
        return None
    return postprocess_multipolygon(MultiPolygon(*polygons, srid=4326), simplify_tolerance_meters, smooth_iterations)


def postprocess_multipolygon(geometry, simplify_tolerance_meters, smooth_iterations):
    if simplify_tolerance_meters:
        geometry = geometry.simplify(float(simplify_tolerance_meters) / METERS_PER_DEGREE, preserve_topology=True)
        geometry = coerce_to_multipolygon(geometry)

    if geometry and smooth_iterations:
        geometry = smooth_multipolygon(geometry, int(smooth_iterations))

    if geometry and not geometry.valid:
        geometry = geometry.buffer(0)
        geometry = coerce_to_multipolygon(geometry)

    return geometry if geometry and not geometry.empty else None


def coerce_to_multipolygon(geometry):
    if geometry is None or geometry.empty:
        return None
    if geometry.geom_type == "Polygon":
        return MultiPolygon(geometry, srid=4326)
    if geometry.geom_type == "MultiPolygon":
        geometry.srid = 4326
        return geometry
    polygons = [part for part in geometry if part.geom_type == "Polygon"]
    return MultiPolygon(*polygons, srid=4326) if polygons else None


def smooth_multipolygon(geometry, iterations):
    payload = json.loads(geometry.geojson)
    smoothed = smooth_geojson_geometry(payload, iterations)
    result = GEOSGeometry(json.dumps(smoothed), srid=4326)
    if result.geom_type == "Polygon":
        result = MultiPolygon(result, srid=4326)
    result.srid = 4326
    return result


def smooth_geojson_geometry(geometry, iterations):
    if geometry.get("type") == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": smooth_polygon_coordinates(geometry.get("coordinates") or [], iterations),
        }
    if geometry.get("type") == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                smooth_polygon_coordinates(polygon, iterations)
                for polygon in geometry.get("coordinates") or []
            ],
        }
    return geometry


def smooth_polygon_coordinates(polygon_coordinates, iterations):
    return [smooth_ring(ring, iterations) for ring in polygon_coordinates if isinstance(ring, list)]


def smooth_ring(ring, iterations):
    points = [point[:2] for point in ring if isinstance(point, list) and len(point) >= 2]
    if len(points) < 4:
        return ring
    if points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        return ring

    for _ in range(max(0, iterations)):
        next_points = []
        for index, current in enumerate(points):
            following = points[(index + 1) % len(points)]
            next_points.append([
                current[0] * 0.75 + following[0] * 0.25,
                current[1] * 0.75 + following[1] * 0.25,
            ])
            next_points.append([
                current[0] * 0.25 + following[0] * 0.75,
                current[1] * 0.25 + following[1] * 0.75,
            ])
        points = next_points
    return [*points, points[0]]


def itinerary_walking_geometries_and_hash(itinerary):
    geometries = selected_walking_segment_geometries(itinerary.itinerary_json)
    return geometries, source_route_hash(geometries) if geometries else ""


def estimate_request_count(location_count, batch_size=DEFAULT_ISOCHRONE_BATCH_SIZE):
    if location_count <= 0:
        return 0
    return ceil(location_count / max(1, int(batch_size)))


def itinerary_isochrones_are_current(itinerary, minutes=None, mode="foot", route_hash=None):
    minutes = list(minutes or DEFAULT_ISOCHRONE_MINUTES)
    if route_hash is None:
        _, route_hash = itinerary_walking_geometries_and_hash(itinerary)
    if not route_hash:
        return False
    from .models import ItineraryIsochrone

    return (
        ItineraryIsochrone.objects.filter(
            itinerary=itinerary,
            mode=mode,
            source_route_hash=route_hash,
            minutes__in=minutes,
        ).count()
        == len(minutes)
    )


def invalidate_itinerary_isochrones(itinerary, mode="foot"):
    from .models import ItineraryIsochrone, ItineraryIsochroneJob

    ItineraryIsochrone.objects.filter(itinerary=itinerary, mode=mode).delete()
    ItineraryIsochroneJob.objects.filter(
        itinerary=itinerary,
        mode=mode,
        status__in=[ItineraryIsochroneJob.Status.PENDING, ItineraryIsochroneJob.Status.RUNNING],
    ).update(
        status=ItineraryIsochroneJob.Status.CANCELLED,
        last_error="Cancelled because the itinerary changed.",
        completed_at=timezone.now(),
    )


def enqueue_itinerary_isochrone_job(
    itinerary,
    *,
    minutes=None,
    mode="foot",
    manual=False,
    sample_distance_meters=DEFAULT_ISOCHRONE_SAMPLE_DISTANCE_METERS,
    simplify_tolerance_meters=DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS,
    smooth_iterations=DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS,
    batch_size=DEFAULT_ISOCHRONE_BATCH_SIZE,
    force=False,
):
    from .models import ItineraryIsochroneJob

    minutes = list(minutes or DEFAULT_ISOCHRONE_MINUTES)
    geometries, route_hash = itinerary_walking_geometries_and_hash(itinerary)
    if not geometries:
        return None, "no saved walking paths"
    if not force and itinerary_isochrones_are_current(itinerary, minutes, mode, route_hash):
        return None, "isochrones are already current"

    locations = sample_walking_geometries(geometries, sample_distance_meters)
    if not locations:
        return None, "no valid sample locations"

    priority = ItineraryIsochroneJob.Priority.HIGH if manual else ItineraryIsochroneJob.Priority.NORMAL
    existing = (
        ItineraryIsochroneJob.objects.filter(
            itinerary=itinerary,
            mode=mode,
            status=ItineraryIsochroneJob.Status.PENDING,
            source_route_hash=route_hash,
        )
        .order_by("priority", "created_at")
        .first()
    )
    defaults = {
        "minutes": minutes,
        "source_route_hash": route_hash,
        "sample_distance_meters": sample_distance_meters,
        "simplify_tolerance_meters": simplify_tolerance_meters,
        "smooth_iterations": smooth_iterations,
        "estimated_request_count": estimate_request_count(len(locations), batch_size),
        "priority": min(priority, existing.priority) if existing else priority,
        "requested_manually": manual or (existing.requested_manually if existing else False),
        "last_error": "",
        "not_before": timezone.now(),
    }
    if existing:
        for field, value in defaults.items():
            setattr(existing, field, value)
        existing.save(update_fields=[*defaults.keys(), "updated_at"])
        return existing, "updated existing pending job"

    job = ItineraryIsochroneJob.objects.create(
        itinerary=itinerary,
        mode=mode,
        status=ItineraryIsochroneJob.Status.PENDING,
        **defaults,
    )
    return job, "queued"


def generate_itinerary_isochrones(
    itinerary,
    *,
    provider,
    minutes=None,
    mode="foot",
    sample_distance_meters=DEFAULT_ISOCHRONE_SAMPLE_DISTANCE_METERS,
    simplify_tolerance_meters=DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS,
    smooth_iterations=DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS,
    max_locations=None,
    batch_size=DEFAULT_ISOCHRONE_BATCH_SIZE,
    clear=False,
    force=False,
):
    minutes = list(minutes or DEFAULT_ISOCHRONE_MINUTES)
    from .models import ItineraryIsochrone

    geometries, route_hash = itinerary_walking_geometries_and_hash(itinerary)
    if not geometries:
        return {"status": "skipped", "reason": "no saved walking paths", "generated": 0, "request_count": 0}

    if not clear and not force and itinerary_isochrones_are_current(itinerary, minutes, mode, route_hash):
        return {"status": "skipped", "reason": "isochrones are already current", "generated": 0, "request_count": 0}

    locations = sample_walking_geometries(geometries, sample_distance_meters, max_locations=max_locations)
    if not locations:
        return {"status": "skipped", "reason": "no valid sample locations", "generated": 0, "request_count": 0}

    request_count = estimate_request_count(len(locations), batch_size)
    polygons_by_minute = provider.fetch(locations, minutes, batch_size=batch_size)
    generated = 0

    with transaction.atomic():
        if clear:
            ItineraryIsochrone.objects.filter(itinerary=itinerary, mode=mode).delete()
        for minute in minutes:
            geometry = geometry_collection_to_multipolygon(
                polygons_by_minute.get(minute, []),
                simplify_tolerance_meters=simplify_tolerance_meters,
                smooth_iterations=smooth_iterations,
            )
            if geometry is None:
                continue
            ItineraryIsochrone.objects.update_or_create(
                itinerary=itinerary,
                mode=mode,
                minutes=minute,
                defaults={
                    "provider": provider.name,
                    "geometry": geometry,
                    "source_route_hash": route_hash,
                    "source_segment_count": len(geometries),
                    "sample_distance_meters": sample_distance_meters,
                    "simplify_tolerance_meters": simplify_tolerance_meters,
                    "smooth_iterations": smooth_iterations,
                    "generated_at": timezone.now(),
                },
            )
            generated += 1

    return {
        "status": "completed" if generated else "skipped",
        "reason": "" if generated else "provider returned no usable polygons",
        "generated": generated,
        "request_count": request_count,
        "location_count": len(locations),
        "segment_count": len(geometries),
        "source_route_hash": route_hash,
    }
