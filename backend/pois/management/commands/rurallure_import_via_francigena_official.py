from pathlib import Path

from pois.management.gpx_route_import import BaseGpxRouteImportCommand, GpxRoutePlan, natural_sort_key


class Command(BaseGpxRouteImportCommand):
    help = "Import official Via Francigena GPX path files as one route with numbered itineraries."
    base_route_title = "Via Francigena Official"
    base_route_slug = "via-francigena-official"
    source_key = "via_francigena_official_gpx"
    source_kind = "via-francigena-official-gpx-import"
    source_dir = Path(__file__).resolve().parents[4] / "routes_data" / "via_francigena_official"

    def build_route_plans(self, source_dir, include_variants=False):
        files = []
        for directory in sorted((path for path in source_dir.iterdir() if path.is_dir()), key=natural_sort_key):
            files.extend(self.importable_files(directory, include_variants))

        if not files:
            return []

        return [
            GpxRoutePlan(
                title=self.base_route_title,
                slug=self.base_route_slug,
                description="",
                files=files,
            )
        ]
