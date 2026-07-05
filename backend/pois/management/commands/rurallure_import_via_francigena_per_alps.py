from pathlib import Path

from pois.management.geojson_route_import import BaseGeojsonRouteImportCommand


class Command(BaseGeojsonRouteImportCommand):
    help = "Import Via Francigena per Alps GeoJSON route files as one continuous itinerary."
    route_title = "Via Francigena per Alps"
    route_slug = "via-francigena-per-alps"
    source_dir = (
        Path(__file__).resolve().parents[4]
        / "routes_data"
        / "wp5_routes"
        / "wp5_routes"
        / "italy"
        / "via francigena per alps"
    )
