import io
import json

from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET

from pois.models import Itinerary, POI, Route

from .services.geojson import itineraries_geojson, itinerary_feature, poi_feature, pois_geojson, route_feature, routes_geojson
from .services.jsonld import dataset_jsonld, graph_jsonld, itinerary_jsonld, poi_jsonld, route_jsonld
from .services.packages import build_dataset_package


def include_drafts(request):
    return request.GET.get("include_drafts", "").lower() in {"1", "true", "yes"}


def jsonld_response(payload):
    return HttpResponse(
        json.dumps(payload, ensure_ascii=False, indent=2),
        content_type="application/ld+json; charset=utf-8",
    )


@require_GET
def dataset(request):
    return jsonld_response(dataset_jsonld(request=request, include_drafts=include_drafts(request)))


@require_GET
def graph(request):
    return jsonld_response(graph_jsonld(request=request, include_drafts=include_drafts(request)))


@require_GET
def package(request):
    output = io.BytesIO()
    build_dataset_package(output, request=request, include_drafts=include_drafts(request))
    output.seek(0)
    return FileResponse(output, as_attachment=True, filename="smartways-eccch-export.zip")


@require_GET
def poi_detail(request, pk):
    poi = POI.objects.prefetch_related(
        "translations",
        "categories",
        "categories__translations",
        "media",
        "media__translations",
    ).filter(pk=pk).first()
    if poi is None or (poi.enabled is False and not include_drafts(request)):
        raise Http404("POI not found.")
    return jsonld_response(poi_jsonld(poi, request=request))


@require_GET
def itinerary_detail(request, pk):
    itinerary = Itinerary.objects.prefetch_related(
        "translations",
        "media",
        "media__translations",
        "route_stages",
        "route_stages__route",
        "route_stages__route__translations",
    ).filter(pk=pk).first()
    if itinerary is None or (itinerary.enabled is False and not include_drafts(request)):
        raise Http404("Itinerary not found.")
    return jsonld_response(itinerary_jsonld(itinerary, request=request))


@require_GET
def route_detail(request, pk):
    route = Route.objects.prefetch_related(
        "translations",
        "media",
        "media__translations",
        "stages",
        "stages__itinerary",
        "stages__itinerary__translations",
    ).filter(pk=pk).first()
    if route is None or (route.enabled is False and not include_drafts(request)):
        raise Http404("Route not found.")
    return jsonld_response(route_jsonld(route, request=request))


@require_GET
def pois_collection(request):
    return JsonResponse(pois_geojson(request=request, include_drafts=include_drafts(request)))


@require_GET
def itineraries_collection(request):
    return JsonResponse(itineraries_geojson(request=request, include_drafts=include_drafts(request)))


@require_GET
def routes_collection(request):
    return JsonResponse(routes_geojson(request=request, include_drafts=include_drafts(request)))


@require_GET
def poi_geojson(request, pk):
    poi = POI.objects.prefetch_related("translations", "categories").filter(pk=pk).first()
    if poi is None or (poi.enabled is False and not include_drafts(request)):
        raise Http404("POI not found.")
    return JsonResponse({"type": "FeatureCollection", "features": [poi_feature(poi, request)]})


@require_GET
def itinerary_geojson(request, pk):
    itinerary = Itinerary.objects.prefetch_related("translations").filter(pk=pk).first()
    if itinerary is None or (itinerary.enabled is False and not include_drafts(request)):
        raise Http404("Itinerary not found.")
    return JsonResponse({"type": "FeatureCollection", "features": [itinerary_feature(itinerary, request)]})


@require_GET
def route_geojson(request, pk):
    route = Route.objects.prefetch_related("translations", "stages", "stages__itinerary").filter(pk=pk).first()
    if route is None or (route.enabled is False and not include_drafts(request)):
        raise Http404("Route not found.")
    return JsonResponse({"type": "FeatureCollection", "features": [route_feature(route, request)]})

