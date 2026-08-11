import json
import math
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.gis.geos import GEOSGeometry, Point, Polygon
from django.db import transaction
from django.http import JsonResponse
from django.db.models import Count, Q
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ParseError, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .country_codes import alpha3_to_alpha2
from .models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryMedia,
    ItineraryTranslation,
    POI,
    POIMedia,
    POITranslation,
    Route,
    RouteMedia,
    RouteStage,
    RouteTranslation,
)
from .serializers import (
    CategorySerializer,
    CategoryTranslationSerializer,
    ItineraryMediaSerializer,
    ItinerarySerializer,
    ItineraryTranslationSerializer,
    POIMediaSerializer,
    POISerializer,
    POITranslationSerializer,
    RouteMediaSerializer,
    RouteSerializer,
    RouteTranslationSerializer,
    UserSerializer,
    select_translation,
    user_role,
)

DEFAULT_COUNTRY_BOUNDARIES_PATH = Path(__file__).resolve().parent / "data" / "geoboundaries_adm0.geojson"
COUNTRY_CODE_PROPERTY_NAMES = (
    "ISO_A2",
    "iso_a2",
    "country_code",
    "COUNTRY_CODE",
    "code",
    "shapeISO",
    "shapeGroup",
    "ISO_A3",
    "iso_a3",
    "ADM0_A3",
)
COUNTRY_BOUNDS_OVERRIDES = {
    # Keep map previews focused on the regions users expect here, not overseas territories.
    "AU": [[-43.75, 112.90], [-10.00, 153.70]],
    "CL": [[-56.00, -75.75], [-17.50, -66.40]],
    "DK": [[54.45, 7.70], [57.85, 15.25]],
    "EC": [[-5.05, -81.10], [1.70, -75.10]],
    "GB": [[49.85, -8.65], [60.86, 1.78]],
    "FR": [[41.30, -5.15], [51.10, 9.57]],
    "NO": [[57.95, 4.50], [71.20, 31.20]],
}
FULL_COUNTRY_BOUNDS_OVERRIDES = {
    # geoBoundaries lists Greenland separately as GL; use the broader Danish realm only for fallback.
    "DK": [[54.45, -73.10], [83.65, 15.25]],
}


class IsEditorOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active)


class IsAdminRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and user_role(request.user) == "admin"
        )


class ManagementApiViewSet(viewsets.ModelViewSet):
    permission_classes = [IsEditorOrAdmin]


def current_user_payload(user):
    return UserSerializer(user).data


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
@ensure_csrf_cookie
def csrf_token(request):
    return Response({"detail": "CSRF cookie set.", "csrfToken": get_token(request)})


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login_view(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    user = authenticate(request, username=username, password=password)
    if user is None or not user.is_active:
        return Response({"detail": "Invalid username or password."}, status=status.HTTP_400_BAD_REQUEST)
    login(request, user)
    return Response(current_user_payload(user))


@csrf_exempt
def logout_view(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Use POST."}, status=405)
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({"detail": "Logged out."})
    logout(request)
    return JsonResponse({"detail": "Logged out."})


@api_view(["GET"])
@permission_classes([IsEditorOrAdmin])
def current_user_view(request):
    return Response(current_user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsEditorOrAdmin])
def change_password_view(request):
    current_password = request.data.get("current_password") or ""
    new_password = request.data.get("new_password") or ""
    if not request.user.check_password(current_password):
        raise ValidationError({"current_password": "Current password is incorrect."})
    try:
        validate_password(new_password, request.user)
    except DjangoValidationError as error:
        raise ValidationError({"new_password": list(error.messages)})
    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)
    return Response({"detail": "Password changed."})


class UserViewSet(ManagementApiViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAdminRole]
    queryset = get_user_model().objects.order_by("id")

    @action(detail=True, methods=["post"])
    def deactivate(self, request, *args, **kwargs):
        user = self.get_object()
        if user == request.user:
            raise ValidationError({"detail": "You cannot deactivate your own account."})
        user.is_active = False
        user.save(update_fields=["is_active"])
        return Response(current_user_payload(user))

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user == request.user:
            raise ValidationError({"detail": "You cannot delete your own account."})
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def country_code_from_boundary_properties(properties):
    for property_name in COUNTRY_CODE_PROPERTY_NAMES:
        value = (properties.get(property_name) or "").strip().upper()
        if len(value) == 2 and value.isalpha():
            return value
        if len(value) == 3:
            code = alpha3_to_alpha2(value)
            if code:
                return code
    return ""


@lru_cache(maxsize=1)
def country_bounds_by_code():
    country_boundaries_path = configured_country_boundaries_path()
    if not country_boundaries_path.exists():
        return {}

    with country_boundaries_path.open(encoding="utf-8") as geojson_file:
        payload = json.load(geojson_file)

    raw_features = payload.get("features") if payload.get("type") == "FeatureCollection" else [payload]
    bounds = {}
    for feature in raw_features or []:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        country_code = country_code_from_boundary_properties(properties)
        if not country_code or not geometry:
            continue

        boundary = GEOSGeometry(json.dumps(geometry), srid=4326)
        if boundary.empty:
            continue

        min_lon, min_lat, max_lon, max_lat = boundary.extent
        bounds[country_code] = [[min_lat, min_lon], [max_lat, max_lon]]
    bounds.update(FULL_COUNTRY_BOUNDS_OVERRIDES)
    return bounds


@lru_cache(maxsize=1)
def country_boundaries_by_code():
    country_boundaries_path = configured_country_boundaries_path()
    if not country_boundaries_path.exists():
        return {}

    with country_boundaries_path.open(encoding="utf-8") as geojson_file:
        payload = json.load(geojson_file)

    raw_features = payload.get("features") if payload.get("type") == "FeatureCollection" else [payload]
    boundaries = {}
    for feature in raw_features or []:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        country_code = country_code_from_boundary_properties(properties)
        if not country_code or not geometry:
            continue

        boundary = GEOSGeometry(json.dumps(geometry), srid=4326)
        if boundary.empty:
            continue
        boundaries.setdefault(country_code, []).append((boundary.extent, boundary))
    return boundaries


def configured_country_boundaries_path():
    configured_path = getattr(settings, "COUNTRY_BOUNDARIES_PATH", "")
    return Path(configured_path) if configured_path else DEFAULT_COUNTRY_BOUNDARIES_PATH


def country_code_for_point(latitude, longitude):
    point = Point(longitude, latitude, srid=4326)
    for country_code, boundaries in country_boundaries_by_code().items():
        for extent, boundary in boundaries:
            min_lon, min_lat, max_lon, max_lat = extent
            if not (min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat):
                continue
            if boundary.covers(point):
                return country_code
    return ""


def point_inside_bounds(latitude, longitude, bounds):
    (min_lat, min_lon), (max_lat, max_lon) = bounds
    return min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon


def focused_or_full_country_bounds(country_code, latitude=None, longitude=None):
    full_bounds = country_bounds_by_code().get(country_code)
    focused_bounds = COUNTRY_BOUNDS_OVERRIDES.get(country_code)
    if not full_bounds:
        return None
    if not focused_bounds:
        return full_bounds
    if latitude is not None and longitude is not None and not point_inside_bounds(latitude, longitude, focused_bounds):
        return full_bounds
    return focused_bounds


def cors_json_response(data, status=200):
    response = JsonResponse(data, status=status)
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def buffer_geometry_from_geojson(geometry):
    if not isinstance(geometry, dict):
        raise ValueError("Buffer geometry must be a GeoJSON object.")

    if geometry.get("type") == "Feature":
        geometry = geometry.get("geometry")

    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Buffer geometry must be a Polygon or MultiPolygon.")

    buffer_geometry = GEOSGeometry(json.dumps(geometry), srid=4326)
    if buffer_geometry.empty:
        raise ValueError("Buffer geometry must not be empty.")
    return buffer_geometry


@csrf_exempt
def buffer_poi_lookup(request):
    if request.method == "OPTIONS":
        return cors_json_response({})

    if not request.user.is_authenticated or not request.user.is_active:
        return cors_json_response({"detail": "Authentication credentials were not provided."}, status=401)

    if request.method != "POST":
        return cors_json_response({"detail": "Use POST."}, status=405)

    try:
        payload = JSONParser().parse(request)
        buffer_geometry = buffer_geometry_from_geojson(payload.get("buffer"))
        language = payload.get("language") or payload.get("lang")
        limit = int(payload.get("limit") or payload.get("count") or 100)
        if limit < 1 or limit > 200:
            raise ValueError("Limit must be between 1 and 200.")
    except (ParseError, TypeError, ValueError) as error:
        return cors_json_response({"detail": str(error)}, status=400)

    queryset = (
        POI.objects.filter(location__within=buffer_geometry)
        .prefetch_related("translations", "media", "media__translations", "categories", "categories__translations")
        .order_by("id")[:limit]
    )
    pois = [poi_for_buffer_response(poi, language) for poi in queryset]
    return cors_json_response({"results": pois})


mock_poi_lookup = buffer_poi_lookup


def poi_for_buffer_response(poi, language_code):
    translation = select_translation(poi.translations.all(), language_code)
    images = [media for media in poi.media.all() if media.media_type == POIMedia.MediaType.IMAGE]
    categories = list(poi.categories.all())
    primary_image = next((image for image in images if image.is_primary), None)
    image = primary_image or (images[0] if images else None)
    image_urls = [image.public_url for image in images]

    return {
        "id": str(poi.pk),
        "enabled": poi.enabled,
        "label": translation.title if translation else f"POI {poi.pk}",
        "snippet": translation.description if translation else "",
        "imageUrl": image.public_url if image else "",
        "imageUrls": image_urls,
        "media": [
            {
                "type": media.media_type,
                "url": media.public_url,
                "position": media.position,
                "isPrimary": media.is_primary,
            }
            for media in poi.media.all()
        ],
        "lat": poi.gps_latitude,
        "lng": poi.gps_longitude,
        "website": poi.website,
        "phone": poi.phone,
        "email": poi.email,
        "categories": [
            {
                "slug": category.slug,
                "name": category_display_name(category, language_code),
            }
            for category in categories
        ],
    }


def parse_bbox(value):
    try:
        min_lon, min_lat, max_lon, max_lat = [float(part) for part in value.split(",")]
    except (TypeError, ValueError):
        raise ValidationError({"bbox": "Use bbox=min_lon,min_lat,max_lon,max_lat."})

    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValidationError({"bbox": "Minimum coordinates must be lower than maximum coordinates."})
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise ValidationError({"bbox": "Longitude values must be between -180 and 180."})
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise ValidationError({"bbox": "Latitude values must be between -90 and 90."})

    return Polygon.from_bbox((min_lon, min_lat, max_lon, max_lat))


def parse_bbox_values(value):
    try:
        min_lon, min_lat, max_lon, max_lat = [float(part) for part in value.split(",")]
    except (AttributeError, ValueError):
        raise ValidationError({"bbox": "Use bbox=min_lon,min_lat,max_lon,max_lat."})
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValidationError({"bbox": "Minimum coordinates must be lower than maximum coordinates."})
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise ValidationError({"bbox": "Longitude values must be between -180 and 180."})
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise ValidationError({"bbox": "Latitude values must be between -90 and 90."})
    return min_lon, min_lat, max_lon, max_lat


def category_display_name(category, language_code):
    translation = select_translation(category.translations.all(), language_code)
    return translation.name if translation else category.slug


class LanguageContextMixin:
    def get_language(self):
        return self.request.query_params.get("language") or self.request.query_params.get("lang")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["language"] = self.get_language()
        return context

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type"
        return response


def ensure_draft(instance, label):
    if getattr(instance, "enabled", False):
        raise ValidationError({"detail": f"Public {label} cannot be edited or deleted. Marked draft content only is editable."})


def is_turn_to_draft_request(data):
    if set(data.keys()) != {"enabled"}:
        return False
    value = data.get("enabled")
    if isinstance(value, bool):
        return value is False
    if isinstance(value, str):
        return value.lower() in {"false", "0", "no"}
    return False


def request_sets_enabled(data, enabled):
    if "enabled" not in data:
        return False
    value = data.get("enabled")
    if isinstance(value, bool):
        return value is enabled
    if isinstance(value, str):
        normalized = value.lower()
        return normalized in ({"true", "1", "yes"} if enabled else {"false", "0", "no"})
    return False


def poi_ids_from_itinerary_json(itinerary_json):
    if not isinstance(itinerary_json, dict):
        return set()
    poi_ids = set()
    for raw_id in itinerary_json.get("poiIds") or []:
        try:
            poi_ids.add(int(raw_id))
        except (TypeError, ValueError):
            continue
    points = itinerary_json.get("points")
    if not isinstance(points, list):
        return poi_ids

    for point in points:
        if not isinstance(point, dict) or point.get("type") != "poi":
            continue
        raw_id = point.get("id") or point.get("poi_id") or point.get("poiId")
        try:
            poi_ids.add(int(raw_id))
        except (TypeError, ValueError):
            continue
    return poi_ids


def value_references_poi(value, poi_id):
    try:
        return int(value) == poi_id
    except (TypeError, ValueError):
        return False


def point_references_poi(point, poi_id):
    if not isinstance(point, dict) or point.get("type") != "poi":
        return False
    return any(value_references_poi(point.get(key), poi_id) for key in ("id", "poi_id", "poiId"))


def point_lat_lng(point, poi):
    coordinates = point.get("coordinates") if isinstance(point.get("coordinates"), dict) else {}
    lat = coordinates.get("lat", point.get("lat"))
    lng = coordinates.get("lng", point.get("lng"))
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        lat = float(poi.location.y)
        lng = float(poi.location.x)
    return lat, lng


def deleted_poi_waypoint(point, poi, index):
    lat, lng = point_lat_lng(point, poi)
    title = (
        point.get("name")
        or point.get("title")
        or point.get("label")
        or (select_translation(poi.translations.all(), None).title if poi.translations.exists() else "")
        or f"Deleted POI {poi.id}"
    )
    return {
        "id": f"deleted-poi-{poi.id}-{index}",
        "type": "waypoint",
        "label": title,
        "name": title,
        "lat": lat,
        "lng": lng,
        "coordinates": {"lat": lat, "lng": lng},
    }


def itinerary_json_without_poi(itinerary_json, poi):
    if not isinstance(itinerary_json, dict):
        return itinerary_json, False
    changed = False
    cleaned = {**itinerary_json}

    if isinstance(cleaned.get("poiIds"), list):
        poi_ids = [raw_id for raw_id in cleaned["poiIds"] if not value_references_poi(raw_id, poi.id)]
        if len(poi_ids) != len(cleaned["poiIds"]):
            cleaned["poiIds"] = poi_ids
            changed = True

    if isinstance(cleaned.get("points"), list):
        points = []
        for index, point in enumerate(cleaned["points"]):
            if point_references_poi(point, poi.id):
                points.append(deleted_poi_waypoint(point, poi, index))
                changed = True
            else:
                points.append(point)
        cleaned["points"] = points

    return cleaned, changed


def remove_deleted_poi_from_itineraries(poi):
    for itinerary in Itinerary.objects.only("id", "itinerary_json"):
        itinerary_json, changed = itinerary_json_without_poi(itinerary.itinerary_json, poi)
        if not changed:
            continue
        itinerary.itinerary_json = itinerary_json
        itinerary.save(update_fields=["itinerary_json", "updated_at"])


def itinerary_ids_containing_poi(poi_id, enabled=None):
    queryset = Itinerary.objects.all()
    if enabled is not None:
        queryset = queryset.filter(enabled=enabled)
    return [
        itinerary.id
        for itinerary in queryset.only("id", "itinerary_json")
        if poi_id in poi_ids_from_itinerary_json(itinerary.itinerary_json)
    ]


def cascade_poi_to_draft(poi):
    itinerary_ids = itinerary_ids_containing_poi(poi.id, enabled=True)
    if not itinerary_ids:
        return

    Itinerary.objects.filter(id__in=itinerary_ids, enabled=True).update(enabled=False)
    route_ids = (
        RouteStage.objects
        .filter(itinerary_id__in=itinerary_ids, route__enabled=True)
        .values_list("route_id", flat=True)
        .distinct()
    )
    Route.objects.filter(id__in=route_ids).update(enabled=False)


def cascade_itinerary_to_public(itinerary):
    poi_ids = poi_ids_from_itinerary_json(itinerary.itinerary_json)
    if poi_ids:
        POI.objects.filter(id__in=poi_ids, enabled=False).update(enabled=True)


def cascade_route_to_public(route):
    itineraries = list(route.stages.select_related("itinerary").all())
    itinerary_ids = [stage.itinerary_id for stage in itineraries]
    if itinerary_ids:
        Itinerary.objects.filter(id__in=itinerary_ids, enabled=False).update(enabled=True)

    poi_ids = set()
    for stage in itineraries:
        poi_ids.update(poi_ids_from_itinerary_json(stage.itinerary.itinerary_json))
    if poi_ids:
        POI.objects.filter(id__in=poi_ids, enabled=False).update(enabled=True)


class DraftOnlyMutationMixin:
    draft_label = "item"

    def ensure_instance_is_draft(self, instance):
        ensure_draft(instance, self.draft_label)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if getattr(instance, "enabled", False) and not is_turn_to_draft_request(request.data):
            self.ensure_instance_is_draft(instance)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.ensure_instance_is_draft(self.get_object())
        return super().destroy(request, *args, **kwargs)


class DraftParentOnlyMutationMixin(DraftOnlyMutationMixin):
    parent_attribute = ""

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = serializer.validated_data.get(self.parent_attribute)
        if parent is not None:
            ensure_draft(parent, self.draft_label)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def ensure_instance_is_draft(self, instance):
        parent = getattr(instance, self.parent_attribute)
        ensure_draft(parent, self.draft_label)


class POIViewSet(DraftOnlyMutationMixin, LanguageContextMixin, ManagementApiViewSet):
    draft_label = "POI"
    serializer_class = POISerializer
    map_individual_limit = 250
    map_cluster_limit = 80

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            poi = self.get_object()
            self.ensure_instance_is_draft(poi)
            remove_deleted_poi_from_itineraries(poi)
            self.perform_destroy(poi)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def update(self, request, *args, **kwargs):
        if is_turn_to_draft_request(request.data):
            with transaction.atomic():
                poi = self.get_object()
                response = super().update(request, *args, **kwargs)
                cascade_poi_to_draft(poi)
                return response
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        queryset = (
            POI.objects.all()
            .prefetch_related(
                "translations",
                "media",
                "media__translations",
                "categories",
                "categories__translations",
            )
            .distinct()
        )

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        country = (self.request.query_params.get("country") or self.request.query_params.get("country_code") or "").strip()
        if country:
            if len(country) != 2 or not country.isalpha():
                raise ValidationError({"country": "Use a two-letter ISO 3166-1 alpha-2 country code."})
            queryset = queryset.filter(country_code=country.upper())

        ids = (self.request.query_params.get("ids") or "").strip()
        if ids:
            try:
                poi_ids = [int(value) for value in ids.split(",") if value.strip()]
            except ValueError:
                raise ValidationError({"ids": "Use a comma-separated list of POI ids."})
            queryset = queryset.filter(id__in=poi_ids)

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        category = self.request.query_params.get("category")
        if category:
            if category.isdigit():
                queryset = queryset.filter(categories__id=int(category))
            else:
                queryset = queryset.filter(categories__slug=category)

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(categories__slug__icontains=query)
                | Q(categories__translations__name__icontains=query)
            )

        bbox = self.request.query_params.get("bbox")
        if bbox:
            queryset = queryset.filter(location__within=parse_bbox(bbox))

        return queryset.distinct()

    @action(detail=False, methods=["get"])
    def countries(self, request):
        country_codes = (
            POI.objects.exclude(country_code="")
            .order_by("country_code")
            .values_list("country_code", flat=True)
            .distinct()
        )
        return Response({"results": list(country_codes)})

    @action(detail=False, methods=["get"])
    def map(self, request):
        bbox_value = request.query_params.get("bbox") or "-180,-90,180,90"
        min_lon, min_lat, max_lon, max_lat = parse_bbox_values(bbox_value)
        queryset = self.get_queryset().filter(location__within=Polygon.from_bbox((min_lon, min_lat, max_lon, max_lat)))
        total_count = queryset.count()
        individual_limit = self._positive_int_query_param("individual_limit", self.map_individual_limit, 1, 1000)
        cluster_limit = self._positive_int_query_param("cluster_limit", self.map_cluster_limit, 4, 400)
        zoom = self._positive_int_query_param("zoom", 0, 0, 24)

        if total_count <= individual_limit or zoom >= 14:
            pois = queryset.order_by("id")[:individual_limit]
            serializer = self.get_serializer(pois, many=True)
            return Response({
                "count": total_count,
                "mode": "pois",
                "results": [
                    {
                        "type": "poi",
                        "poi": poi,
                    }
                    for poi in serializer.data
                ],
            })

        clusters = self._cluster_pois_for_bbox(queryset, (min_lon, min_lat, max_lon, max_lat), cluster_limit)
        return Response({
            "count": total_count,
            "mode": "clusters",
            "results": clusters,
        })

    def _positive_int_query_param(self, name, default, minimum, maximum):
        value = self.request.query_params.get(name)
        if value in {None, ""}:
            return default
        try:
            parsed = int(value)
        except ValueError:
            raise ValidationError({name: f"Use an integer between {minimum} and {maximum}."})
        if parsed < minimum or parsed > maximum:
            raise ValidationError({name: f"Use an integer between {minimum} and {maximum}."})
        return parsed

    def _cluster_pois_for_bbox(self, queryset, bbox, cluster_limit):
        min_lon, min_lat, max_lon, max_lat = bbox
        columns = max(1, math.ceil(math.sqrt(cluster_limit)))
        rows = max(1, math.ceil(cluster_limit / columns))
        lon_span = max_lon - min_lon
        lat_span = max_lat - min_lat
        cells = {}

        for poi_id, location in queryset.order_by("id").values_list("id", "location"):
            if location is None:
                continue
            longitude = location.x
            latitude = location.y
            column = min(columns - 1, max(0, int((longitude - min_lon) / lon_span * columns))) if lon_span else 0
            row = min(rows - 1, max(0, int((latitude - min_lat) / lat_span * rows))) if lat_span else 0
            key = (column, row)
            cell = cells.setdefault(key, {
                "type": "cluster",
                "count": 0,
                "lat_sum": 0.0,
                "lng_sum": 0.0,
                "poi_ids": [],
            })
            cell["count"] += 1
            cell["lat_sum"] += latitude
            cell["lng_sum"] += longitude
            if len(cell["poi_ids"]) < 10:
                cell["poi_ids"].append(poi_id)

        clusters = []
        for cell in cells.values():
            count = cell["count"]
            clusters.append({
                "type": "cluster",
                "count": count,
                "lat": cell["lat_sum"] / count,
                "lng": cell["lng_sum"] / count,
                "poi_ids": cell["poi_ids"],
            })
        return sorted(clusters, key=lambda cluster: (-cluster["count"], cluster["lat"], cluster["lng"]))

    @action(detail=False, methods=["get"], url_path="country-bounds")
    def country_bounds(self, request):
        country = (request.query_params.get("country") or request.query_params.get("country_code") or "").strip().upper()
        if len(country) != 2 or not country.isalpha():
            raise ValidationError({"country": "Use a two-letter ISO 3166-1 alpha-2 country code."})

        latitude = None
        longitude = None
        lat_value = request.query_params.get("lat")
        lng_value = request.query_params.get("lng")
        if lat_value is not None or lng_value is not None:
            try:
                latitude = float(lat_value)
                longitude = float(lng_value)
            except (TypeError, ValueError):
                raise ValidationError({"coordinates": "Use numeric lat and lng query parameters."})

            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValidationError({"coordinates": "Latitude must be between -90 and 90; longitude between -180 and 180."})

        bounds = focused_or_full_country_bounds(country, latitude, longitude)
        if not bounds:
            raise ValidationError({"country": f"No country bounds are available for {country}."})

        return Response({"country": country, "bounds": bounds})

    @action(detail=False, methods=["get"], url_path="country-at")
    def country_at(self, request):
        try:
            latitude = float(request.query_params.get("lat"))
            longitude = float(request.query_params.get("lng"))
        except (TypeError, ValueError):
            raise ValidationError({"coordinates": "Use numeric lat and lng query parameters."})

        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValidationError({"coordinates": "Latitude must be between -90 and 90; longitude between -180 and 180."})

        return Response({"country": country_code_for_point(latitude, longitude)})


class POITranslationViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "POI"
    parent_attribute = "poi"
    serializer_class = POITranslationSerializer
    queryset = POITranslation.objects.select_related("poi").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        poi_id = self.request.query_params.get("poi")

        if language:
            queryset = queryset.filter(language_code=language)
        if poi_id:
            queryset = queryset.filter(poi_id=poi_id)

        return queryset


class ItineraryViewSet(DraftOnlyMutationMixin, LanguageContextMixin, ManagementApiViewSet):
    draft_label = "itinerary"
    serializer_class = ItinerarySerializer

    def update(self, request, *args, **kwargs):
        if is_turn_to_draft_request(request.data):
            with transaction.atomic():
                itinerary = self.get_object()
                Route.objects.filter(stages__itinerary=itinerary, enabled=True).distinct().update(enabled=False)
                return super().update(request, *args, **kwargs)
        if request_sets_enabled(request.data, True):
            with transaction.atomic():
                response = super().update(request, *args, **kwargs)
                itinerary = self.get_object()
                if itinerary.enabled:
                    cascade_itinerary_to_public(itinerary)
                return response
        return super().update(request, *args, **kwargs)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        route = self.request.query_params.get("route")
        if route and route.isdigit():
            context["route_id"] = int(route)
        return context

    def get_queryset(self):
        queryset = Itinerary.objects.prefetch_related(
            "translations",
            "media",
            "media__translations",
            "route_stages",
            "route_stages__route",
            "route_stages__route__translations",
        ).distinct()

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        route = self.request.query_params.get("route")
        if route:
            if route.lower() in {"none", "null", "unassigned"}:
                queryset = queryset.filter(route_stages__isnull=True)
            elif route.isdigit():
                queryset = queryset.filter(route_stages__route_id=int(route)).order_by("route_stages__stage_number", "id")
            else:
                raise ValidationError({"route": "Use a route id or null."})

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(translations__description__icontains=query)
            )

        return queryset.distinct()


class RouteViewSet(DraftOnlyMutationMixin, LanguageContextMixin, ManagementApiViewSet):
    draft_label = "route"
    serializer_class = RouteSerializer

    def update(self, request, *args, **kwargs):
        if request_sets_enabled(request.data, True):
            with transaction.atomic():
                response = super().update(request, *args, **kwargs)
                route = self.get_object()
                if route.enabled:
                    cascade_route_to_public(route)
                return response
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        queryset = Route.objects.prefetch_related(
            "translations",
            "media",
            "media__translations",
            "stages",
            "stages__itinerary",
            "stages__itinerary__translations",
        ).distinct()

        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            if enabled.lower() not in {"true", "false", "1", "0"}:
                raise ValidationError({"enabled": "Use true or false."})
            queryset = queryset.filter(enabled=enabled.lower() in {"true", "1"})

        language = self.get_language()
        if language and self.action == "list":
            queryset = queryset.filter(translations__language_code=language)

        query = (self.request.query_params.get("q") or self.request.query_params.get("search") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(translations__title__icontains=query)
                | Q(translations__description__icontains=query)
            )

        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="reorder-itineraries")
    def reorder_itineraries(self, request, pk=None):
        route = self.get_object()
        ensure_draft(route, "route")
        raw_items = request.data.get("itineraries")
        if not isinstance(raw_items, list) or not raw_items:
            raise ValidationError({"itineraries": "Provide a non-empty list of itinerary stage assignments."})

        assignments = []
        seen_ids = set()
        seen_stages = set()
        for item in raw_items:
            if not isinstance(item, dict):
                raise ValidationError({"itineraries": "Each assignment must be an object."})
            itinerary_id = item.get("id")
            stage_number = item.get("stage_number")
            if not isinstance(itinerary_id, int) or not isinstance(stage_number, int):
                raise ValidationError({"itineraries": "Each assignment needs integer id and stage_number values."})
            if stage_number < 1:
                raise ValidationError({"stage_number": "Stage numbers must be positive."})
            if itinerary_id in seen_ids:
                raise ValidationError({"itineraries": "Itinerary ids must not repeat."})
            if stage_number in seen_stages:
                raise ValidationError({"stage_number": "Stage numbers must not repeat."})
            seen_ids.add(itinerary_id)
            seen_stages.add(stage_number)
            assignments.append((itinerary_id, stage_number))

        with transaction.atomic():
            route_stages = {
                stage.itinerary_id: stage
                for stage in route.stages.select_for_update().filter(itinerary_id__in=seen_ids)
            }
            missing_ids = seen_ids - set(route_stages)
            if missing_ids:
                raise ValidationError({"itineraries": "All itineraries must belong to this route."})

            temporary_offset = 1000000
            for index, (itinerary_id, _) in enumerate(assignments, start=1):
                stage = route_stages[itinerary_id]
                stage.stage_number = temporary_offset + index
                stage.save(update_fields=["stage_number", "updated_at"])

            for itinerary_id, stage_number in assignments:
                stage = route_stages[itinerary_id]
                stage.stage_number = stage_number
                stage.save(update_fields=["stage_number", "updated_at"])

        queryset = (
            Itinerary.objects.filter(route_stages__route=route)
            .prefetch_related("translations", "route_stages", "route_stages__route", "route_stages__route__translations")
            .order_by("route_stages__stage_number", "id")
        )
        context = self.get_serializer_context()
        context["route_id"] = route.id
        serializer = ItinerarySerializer(queryset, many=True, context=context)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="remove-itinerary")
    def remove_itinerary(self, request, pk=None):
        route = self.get_object()
        ensure_draft(route, "route")
        itinerary_id = request.data.get("itinerary")
        if not isinstance(itinerary_id, int):
            raise ValidationError({"itinerary": "Provide an itinerary id."})

        with transaction.atomic():
            route_stage = route.stages.select_for_update().select_related("itinerary").filter(itinerary_id=itinerary_id).first()
            if route_stage is None:
                raise ValidationError({"itinerary": "Itinerary does not belong to this route."})

            itinerary = route_stage.itinerary
            route_stage.delete()

            remaining_stages = list(
                route.stages.select_for_update()
                .order_by("stage_number", "id")
            )
            temporary_offset = 1000000
            for index, remaining in enumerate(remaining_stages, start=1):
                remaining.stage_number = temporary_offset + index
                remaining.save(update_fields=["stage_number", "updated_at"])

            for index, remaining in enumerate(remaining_stages, start=1):
                remaining.stage_number = index
                remaining.save(update_fields=["stage_number", "updated_at"])

        serializer = ItinerarySerializer(itinerary, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="add-itineraries")
    def add_itineraries(self, request, pk=None):
        route = self.get_object()
        ensure_draft(route, "route")
        itinerary_ids = request.data.get("itineraries")
        if not isinstance(itinerary_ids, list) or not itinerary_ids:
            raise ValidationError({"itineraries": "Provide a non-empty list of itinerary ids."})
        if any(not isinstance(itinerary_id, int) for itinerary_id in itinerary_ids):
            raise ValidationError({"itineraries": "Itinerary ids must be integers."})

        itinerary_ids = list(dict.fromkeys(itinerary_ids))
        itineraries = {
            itinerary.id: itinerary
            for itinerary in Itinerary.objects.filter(id__in=itinerary_ids)
        }
        missing_ids = set(itinerary_ids) - set(itineraries)
        if missing_ids:
            raise ValidationError({"itineraries": "Every itinerary id must exist."})

        with transaction.atomic():
            existing_ids = set(
                route.stages.select_for_update()
                .filter(itinerary_id__in=itinerary_ids)
                .values_list("itinerary_id", flat=True)
            )
            max_stage_number = (
                route.stages.select_for_update()
                .order_by("-stage_number")
                .values_list("stage_number", flat=True)
                .first()
                or 0
            )
            next_stage_number = max_stage_number + 1
            for itinerary_id in itinerary_ids:
                if itinerary_id in existing_ids:
                    continue
                RouteStage.objects.create(
                    route=route,
                    itinerary=itineraries[itinerary_id],
                    stage_number=next_stage_number,
                )
                next_stage_number += 1

        queryset = (
            Itinerary.objects.filter(id__in=itinerary_ids)
            .prefetch_related("translations", "route_stages", "route_stages__route", "route_stages__route__translations")
            .order_by("id")
        )
        serializer = ItinerarySerializer(queryset, many=True, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)


class RouteTranslationViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "route"
    parent_attribute = "route"
    serializer_class = RouteTranslationSerializer
    queryset = RouteTranslation.objects.select_related("route").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        route_id = self.request.query_params.get("route")

        if language:
            queryset = queryset.filter(language_code=language)
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        return queryset


class ItineraryTranslationViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "itinerary"
    parent_attribute = "itinerary"
    serializer_class = ItineraryTranslationSerializer
    queryset = ItineraryTranslation.objects.select_related("itinerary").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        itinerary_id = self.request.query_params.get("itinerary")

        if language:
            queryset = queryset.filter(language_code=language)
        if itinerary_id:
            queryset = queryset.filter(itinerary_id=itinerary_id)

        return queryset


class CategoryViewSet(LanguageContextMixin, ManagementApiViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.prefetch_related("translations").annotate(poi_count=Count("pois", distinct=True)).all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.get_language()

        if language:
            queryset = queryset.filter(translations__language_code=language)

        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        source = self.get_object()
        target_id = request.data.get("target")
        if not target_id:
            raise ValidationError({"target": "Select the category to merge into."})

        try:
            target = Category.objects.get(pk=target_id)
        except Category.DoesNotExist as exc:
            raise ValidationError({"target": "Target category does not exist."}) from exc

        if source.pk == target.pk:
            raise ValidationError({"target": "Choose a different target category."})

        with transaction.atomic():
            for poi in source.pois.all():
                poi.categories.add(target)
            source.delete()

        serializer = self.get_serializer(target)
        return Response(serializer.data)


class CategoryTranslationViewSet(ManagementApiViewSet):
    serializer_class = CategoryTranslationSerializer
    queryset = CategoryTranslation.objects.select_related("category").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        language = self.request.query_params.get("language") or self.request.query_params.get("lang")
        category_id = self.request.query_params.get("category")

        if language:
            queryset = queryset.filter(language_code=language)
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        return queryset


class POIMediaViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "POI"
    parent_attribute = "poi"
    serializer_class = POIMediaSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    queryset = POIMedia.objects.select_related("poi").prefetch_related("translations").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        poi_id = self.request.query_params.get("poi")

        if poi_id:
            queryset = queryset.filter(poi_id=poi_id)

        return queryset

    def perform_create(self, serializer):
        media = serializer.save()
        if media.is_primary:
            POIMedia.objects.filter(poi=media.poi, is_primary=True).exclude(pk=media.pk).update(is_primary=False)

    def perform_update(self, serializer):
        media = serializer.save()
        if media.is_primary:
            POIMedia.objects.filter(poi=media.poi, is_primary=True).exclude(pk=media.pk).update(is_primary=False)


class RouteMediaViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "route"
    parent_attribute = "route"
    serializer_class = RouteMediaSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    queryset = RouteMedia.objects.select_related("route").prefetch_related("translations").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        route_id = self.request.query_params.get("route")
        if route_id:
            queryset = queryset.filter(route_id=route_id)
        return queryset

    def perform_create(self, serializer):
        media = serializer.save()
        if media.is_primary:
            RouteMedia.objects.filter(route=media.route, is_primary=True).exclude(pk=media.pk).update(is_primary=False)

    def perform_update(self, serializer):
        media = serializer.save()
        if media.is_primary:
            RouteMedia.objects.filter(route=media.route, is_primary=True).exclude(pk=media.pk).update(is_primary=False)


class ItineraryMediaViewSet(DraftParentOnlyMutationMixin, ManagementApiViewSet):
    draft_label = "itinerary"
    parent_attribute = "itinerary"
    serializer_class = ItineraryMediaSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    queryset = ItineraryMedia.objects.select_related("itinerary").prefetch_related("translations").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        itinerary_id = self.request.query_params.get("itinerary")
        if itinerary_id:
            queryset = queryset.filter(itinerary_id=itinerary_id)
        return queryset

    def perform_create(self, serializer):
        media = serializer.save()
        if media.is_primary:
            ItineraryMedia.objects.filter(itinerary=media.itinerary, is_primary=True).exclude(pk=media.pk).update(is_primary=False)

    def perform_update(self, serializer):
        media = serializer.save()
        if media.is_primary:
            ItineraryMedia.objects.filter(itinerary=media.itinerary, is_primary=True).exclude(pk=media.pk).update(is_primary=False)
