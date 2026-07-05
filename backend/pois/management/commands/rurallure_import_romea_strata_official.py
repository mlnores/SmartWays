from pathlib import Path

from pois.management.gpx_route_import import BaseGpxRouteImportCommand


class Command(BaseGpxRouteImportCommand):
    help = "Import official Romea Strata GPX route files as routes with numbered itineraries."
    base_route_title = "Romea Strata Official"
    base_route_slug = "romea-strata-official"
    source_dir = Path(__file__).resolve().parents[4] / "routes_data" / "romea_strata_official"
