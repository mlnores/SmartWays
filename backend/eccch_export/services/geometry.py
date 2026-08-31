import json


def geometry_as_geojson(geometry):
    if not geometry:
        return None
    return json.loads(geometry.geojson)


def point_coordinates(point):
    if not point:
        return None
    return [float(point.x), float(point.y)]


def coordinate_from_point_payload(point):
    if not isinstance(point, dict):
        return None
    coordinates = point.get("coordinates") if isinstance(point.get("coordinates"), dict) else {}
    lat = coordinates.get("lat", point.get("lat"))
    lng = coordinates.get("lng", point.get("lng"))
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return None
    return [lng, lat]


def geometry_coordinates(geometry):
    if not isinstance(geometry, dict):
        return []
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return []
    if geometry.get("type") == "LineString":
        return coordinates
    if geometry.get("type") == "MultiLineString":
        merged = []
        for line in coordinates:
            if isinstance(line, list):
                if merged and line and merged[-1] == line[0]:
                    merged.extend(line[1:])
                else:
                    merged.extend(line)
        return merged
    return []


def itinerary_coordinates(itinerary):
    itinerary_json = itinerary.itinerary_json if isinstance(itinerary.itinerary_json, dict) else {}
    coordinates = []
    for segment in itinerary_json.get("segments", []):
        if not isinstance(segment, dict):
            continue
        route = segment.get("selectedWalkingRoute") or {}
        segment_coordinates = geometry_coordinates(route.get("geometry"))
        if segment_coordinates:
            if coordinates and coordinates[-1] == segment_coordinates[0]:
                coordinates.extend(segment_coordinates[1:])
            else:
                coordinates.extend(segment_coordinates)

    if coordinates:
        return normalize_coordinates(coordinates)

    points = [coordinate_from_point_payload(point) for point in itinerary_json.get("points", [])]
    return [point for point in points if point is not None]


def route_coordinates(route):
    coordinates = []
    stages = route.stages.select_related("itinerary").order_by("stage_number", "id")
    for stage in stages:
        stage_coordinates = itinerary_coordinates(stage.itinerary)
        if not stage_coordinates:
            continue
        if coordinates and coordinates[-1] == stage_coordinates[0]:
            coordinates.extend(stage_coordinates[1:])
        else:
            coordinates.extend(stage_coordinates)
    return coordinates


def normalize_coordinates(coordinates):
    normalized = []
    for coordinate in coordinates:
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue
        try:
            normalized.append([float(coordinate[0]), float(coordinate[1])])
        except (TypeError, ValueError):
            continue
    return normalized


def line_geometry(coordinates):
    coordinates = normalize_coordinates(coordinates)
    if len(coordinates) < 2:
        return None
    return {
        "type": "LineString",
        "coordinates": coordinates,
    }
