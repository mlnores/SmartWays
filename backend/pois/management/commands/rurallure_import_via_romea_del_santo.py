from pathlib import Path

from pois.management.geojson_route_import import BaseGeojsonRouteImportCommand


class Command(BaseGeojsonRouteImportCommand):
    help = "Import Via Romea del Santo GeoJSON route files as one continuous itinerary."
    route_title = "Via Romea del Santo"
    route_slug = "via-romea-del-santo"
    source_dir = (
        Path(__file__).resolve().parents[4]
        / "routes_data"
        / "wp5_routes"
        / "wp5_routes"
        / "italy"
        / "via romea del santo"
    )
