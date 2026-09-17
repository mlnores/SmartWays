from pathlib import Path

from django.conf import settings
from django.contrib.gis.gdal import DataSource
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from pois.country_codes import alpha3_to_alpha2
from pois.models import CountryBoundary


COUNTRY_CODE_FIELDS = (
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
COUNTRY_NAME_FIELDS = ("shapeName", "name", "NAME", "ADMIN")


def first_property(properties, field_names):
    for field_name in field_names:
        value = properties.get(field_name)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def country_code_from_properties(properties):
    for field_name in COUNTRY_CODE_FIELDS:
        value = str(properties.get(field_name) or "").strip().upper()
        if len(value) == 2 and value.isalpha():
            return value
        if len(value) == 3:
            if value == "XKX":
                return "XK"
            country_code = alpha3_to_alpha2(value)
            if country_code:
                return country_code
    return ""


def polygon_geometries(geometry):
    geometry_type = geometry.geom_type.name
    if geometry_type in {"Polygon", "Polygon25D"}:
        yield geometry
        return
    if geometry_type in {"MultiPolygon", "MultiPolygon25D", "GeometryCollection", "GeometryCollection25D"}:
        for index in range(len(geometry)):
            yield from polygon_geometries(geometry[index])


class Command(BaseCommand):
    help = "Import full-resolution country polygons into the spatial database."

    def add_arguments(self, parser):
        parser.add_argument(
            "path",
            nargs="?",
            default=getattr(settings, "COUNTRY_BOUNDARIES_PATH", ""),
            help="GeoJSON country-boundary file (defaults to COUNTRY_BOUNDARIES_PATH).",
        )
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Skip the import when the country-boundary table already contains rows.",
        )

    def handle(self, *args, **options):
        if options["if_empty"] and CountryBoundary.objects.exists():
            self.stdout.write("Country boundaries are already present; skipping import.")
            return

        raw_path = options["path"]
        if not raw_path:
            raise CommandError("Provide a GeoJSON path or configure COUNTRY_BOUNDARIES_PATH.")
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            raise CommandError(f"Country-boundary file not found: {path}")

        self.stdout.write(f"Reading country boundaries from {path}...")
        data_source = DataSource(str(path))
        if len(data_source) == 0:
            raise CommandError(f"No layers found in {path}")

        imported = 0
        skipped = 0
        with transaction.atomic():
            CountryBoundary.objects.all().delete()
            layer = data_source[0]
            for feature in layer:
                properties = {field_name: feature.get(field_name) for field_name in feature.fields}
                country_code = country_code_from_properties(properties)
                if not country_code:
                    skipped += 1
                    continue
                country_name = first_property(properties, COUNTRY_NAME_FIELDS)
                geometry = feature.geom
                if geometry is None:
                    skipped += 1
                    continue

                for polygon in polygon_geometries(geometry):
                    polygon = polygon.clone()
                    if polygon.srid != 4326:
                        polygon.transform(4326)
                    geos_polygon = polygon.geos
                    if geos_polygon.empty:
                        continue
                    CountryBoundary.objects.create(
                        country_code=country_code,
                        name=country_name,
                        geometry=geos_polygon,
                    )
                    imported += 1

        if imported == 0:
            raise CommandError("The source contained no recognized country polygons.")
        self.stdout.write(self.style.SUCCESS(f"Imported {imported} polygons; skipped {skipped} features."))
