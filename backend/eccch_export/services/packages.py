import json
from zipfile import ZIP_DEFLATED, ZipFile

from .geojson import itineraries_geojson, pois_geojson, routes_geojson
from .jsonld import graph_jsonld


def write_json(zip_file, name, payload):
    zip_file.writestr(name, json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))


def build_dataset_package(output_file, request=None, include_drafts=False):
    with ZipFile(output_file, "w", compression=ZIP_DEFLATED) as zip_file:
        write_json(zip_file, "dataset.jsonld", graph_jsonld(request=request, include_drafts=include_drafts))
        write_json(zip_file, "pois.geojson", pois_geojson(request=request, include_drafts=include_drafts))
        write_json(zip_file, "itineraries.geojson", itineraries_geojson(request=request, include_drafts=include_drafts))
        write_json(zip_file, "routes.geojson", routes_geojson(request=request, include_drafts=include_drafts))

