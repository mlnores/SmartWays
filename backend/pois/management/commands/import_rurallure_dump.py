import csv
from collections import defaultdict
from pathlib import Path

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from pois.models import Category, CategoryTranslation, POI, POIImage, POITranslation


COPY_TABLES = {
    "public.category",
    "public.category_translation",
    "public.file_uploaded",
    "public.image_point_of_interest",
    "public.languages",
    "public.point_of_interest",
    "public.point_of_interest_category",
    "public.point_of_interest_translation",
}

DEFAULT_IMAGE_BASE_URL = "https://rurallure-web-files-prod.s3.eu-west-2.amazonaws.com/images/"


def copy_value(value):
    if value == r"\N":
        return None

    return (
        value.replace(r"\\", "\\")
        .replace(r"\t", "\t")
        .replace(r"\n", "\n")
        .replace(r"\r", "\r")
    )


def parse_copy_header(line):
    prefix = "COPY "
    marker = " FROM stdin;"
    if not line.startswith(prefix) or not line.endswith(marker):
        return None

    table_and_columns = line[len(prefix) : -len(marker)]
    table_name, columns_text = table_and_columns.split(" (", 1)
    columns = [column.strip().strip('"') for column in columns_text[:-1].split(",")]
    return table_name, columns


def iter_copy_rows(path, wanted_tables):
    current_table = None
    current_columns = None

    with path.open(encoding="utf-8", newline="") as dump_file:
        for raw_line in dump_file:
            line = raw_line.rstrip("\n")

            if current_table is None:
                header = parse_copy_header(line)
                if header is None:
                    continue

                table_name, columns = header
                if table_name in wanted_tables:
                    current_table = table_name
                    current_columns = columns
                continue

            if line == r"\.":
                current_table = None
                current_columns = None
                continue

            values = next(csv.reader([line], delimiter="\t", quoting=csv.QUOTE_NONE))
            yield current_table, dict(zip(current_columns, [copy_value(value) for value in values]))


def parse_bool(value, default=False):
    if value is None:
        return default
    return value == "t"


def parse_decimal(value):
    if value is None:
        return None
    return float(value)


def valid_language_code(value):
    if not value or len(value) > 8:
        return None

    parts = value.split("-")
    if len(parts) == 1 and len(parts[0]) == 2 and parts[0].islower():
        return value
    if (
        len(parts) == 2
        and len(parts[0]) == 2
        and parts[0].islower()
        and len(parts[1]) == 2
        and parts[1].isupper()
    ):
        return value

    return None


def unique_slug(raw_value, used_slugs, fallback, max_length):
    base = slugify(raw_value or "")
    if not base:
        base = slugify(fallback)
    if not base:
        base = "item"

    base = base[:max_length].strip("-_") or "item"
    candidate = base
    suffix = 2

    while candidate in used_slugs:
        suffix_text = f"-{suffix}"
        candidate = f"{base[: max_length - len(suffix_text)]}{suffix_text}".strip("-_")
        suffix += 1

    used_slugs.add(candidate)
    return candidate


class Command(BaseCommand):
    help = "Import POIs from the RurAllure PostgreSQL dump into the current Django schema."

    def add_arguments(self, parser):
        parser.add_argument(
            "dump_path",
            nargs="?",
            default=str(Path(__file__).resolve().parents[4] / "POI_data" / "dump-rurallure_db.sql"),
            help="Path to dump-rurallure_db.sql.",
        )
        parser.add_argument(
            "--image-base-url",
            default=DEFAULT_IMAGE_BASE_URL,
            help="Base URL prepended to file_uploaded.filename for POI images.",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing POI, category, translation, and image rows before importing.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse the dump and report import counts without writing rows.",
        )

    def handle(self, *args, **options):
        dump_path = Path(options["dump_path"]).expanduser().resolve()
        if not dump_path.exists():
            raise CommandError(f"Dump file not found: {dump_path}")

        data = self.load_dump_data(dump_path)
        self.stdout.write(f"Parsed {dump_path}")

        if options["dry_run"]:
            self.report_loaded_data(data)
            return

        if not options["clear"] and any(
            model.objects.exists() for model in (POI, POITranslation, Category, CategoryTranslation, POIImage)
        ):
            raise CommandError("Target POI tables are not empty. Re-run with --clear or start from an empty database.")

        with transaction.atomic():
            if options["clear"]:
                POIImage.objects.all().delete()
                POITranslation.objects.all().delete()
                POI.objects.all().delete()
                CategoryTranslation.objects.all().delete()
                Category.objects.all().delete()

            stats = self.import_data(data, options["image_base_url"])

        self.stdout.write(self.style.SUCCESS("Import completed."))
        for key, value in stats.items():
            self.stdout.write(f"{key}: {value}")

    def load_dump_data(self, dump_path):
        data = {table_name: [] for table_name in COPY_TABLES}
        for table_name, row in iter_copy_rows(dump_path, COPY_TABLES):
            data[table_name].append(row)
        return data

    def report_loaded_data(self, data):
        for table_name in sorted(data):
            self.stdout.write(f"{table_name}: {len(data[table_name])}")

    def import_data(self, data, image_base_url):
        imported_at = timezone.now()
        language_codes = self.build_language_codes(data["public.languages"])
        categories_by_source_id, category_stats = self.import_categories(
            data["public.category"],
            data["public.category_translation"],
            language_codes,
            imported_at,
        )
        pois_by_source_id, poi_stats = self.import_pois(data["public.point_of_interest"], imported_at)
        translation_stats = self.import_poi_translations(
            data["public.point_of_interest_translation"],
            language_codes,
            pois_by_source_id,
        )
        relation_stats = self.import_category_relations(
            data["public.point_of_interest_category"],
            pois_by_source_id,
            categories_by_source_id,
        )
        image_stats = self.import_images(
            data["public.file_uploaded"],
            data["public.image_point_of_interest"],
            pois_by_source_id,
            image_base_url,
        )

        return {
            **category_stats,
            **poi_stats,
            **translation_stats,
            **relation_stats,
            **image_stats,
        }

    def build_language_codes(self, rows):
        language_codes = {}
        for row in rows:
            code = valid_language_code(row["iso_639_1_code"])
            if code:
                language_codes[row["id"]] = code
        return language_codes

    def import_categories(self, category_rows, translation_rows, language_codes, imported_at):
        names_by_category = defaultdict(list)
        for row in translation_rows:
            language_code = language_codes.get(row["language_id"])
            if language_code:
                names_by_category[row["category_id"]].append((language_code, row["description"]))

        used_category_slugs = set()
        categories_by_source_id = {}
        categories = []

        for row in category_rows:
            source_id = row["id"]
            names = names_by_category.get(source_id, [])
            english_name = next((name for language, name in names if language == "en"), None)
            first_name = names[0][1] if names else None
            category = Category(
                slug=unique_slug(english_name or first_name, used_category_slugs, f"category-{source_id}", 120),
                created_at=imported_at,
            )
            categories_by_source_id[source_id] = category
            categories.append(category)

        Category.objects.bulk_create(categories)

        translation_objects = []
        seen_translations = set()
        for source_id, names in names_by_category.items():
            category = categories_by_source_id.get(source_id)
            if not category:
                continue

            for language_code, name in names:
                key = (category.pk, language_code)
                if key in seen_translations:
                    continue
                seen_translations.add(key)
                translation_objects.append(
                    CategoryTranslation(
                        category=category,
                        language_code=language_code,
                        name=(name or category.slug)[:255],
                    )
                )

        CategoryTranslation.objects.bulk_create(translation_objects)

        return categories_by_source_id, {
            "categories_created": len(categories),
            "category_translations_created": len(translation_objects),
        }

    def import_pois(self, rows, imported_at):
        pois_by_source_id = {}
        pois = []
        skipped_without_coordinates = 0
        skipped_disabled = 0

        for row in rows:
            if not parse_bool(row["enabled"], default=True):
                skipped_disabled += 1
                continue

            latitude = parse_decimal(row["gps_latitude"])
            longitude = parse_decimal(row["gps_longitude"])
            if latitude is None or longitude is None:
                skipped_without_coordinates += 1
                continue

            poi = POI(
                enabled=True,
                location=Point(longitude, latitude, srid=4326),
                website=(row["website"] or "")[:200],
                created_at=imported_at,
                updated_at=imported_at,
            )
            pois_by_source_id[row["id"]] = poi
            pois.append(poi)

        POI.objects.bulk_create(pois)
        if pois:
            POI.objects.filter(pk__in=[poi.pk for poi in pois]).update(
                created_at=imported_at,
                updated_at=imported_at,
            )

        return pois_by_source_id, {
            "pois_created": len(pois),
            "pois_skipped_disabled": skipped_disabled,
            "pois_skipped_without_coordinates": skipped_without_coordinates,
        }

    def import_poi_translations(self, rows, language_codes, pois_by_source_id):
        used_slugs_by_language = defaultdict(set)
        seen_poi_languages = set()
        reference_pois = set()
        translations = []
        skipped = 0

        for row in rows:
            poi = pois_by_source_id.get(row["point_of_interest_id"])
            language_code = language_codes.get(row["language_id"])
            if not poi or not language_code:
                skipped += 1
                continue

            key = (poi.pk, language_code)
            if key in seen_poi_languages:
                skipped += 1
                continue
            seen_poi_languages.add(key)

            title = (row["title"] or "Untitled POI")[:255]
            slug = unique_slug(
                row["slug"] or title,
                used_slugs_by_language[language_code],
                f"poi-{row['point_of_interest_id']}",
                255,
            )
            is_reference = poi.pk not in reference_pois
            reference_pois.add(poi.pk)
            translations.append(
                POITranslation(
                    poi=poi,
                    language_code=language_code,
                    title=title,
                    description=row["description"] or "",
                    slug=slug,
                    is_reference=is_reference,
                )
            )

        POITranslation.objects.bulk_create(translations)

        return {
            "poi_translations_created": len(translations),
            "poi_translations_skipped": skipped,
        }

    def import_category_relations(self, rows, pois_by_source_id, categories_by_source_id):
        through_model = POI.categories.through
        relation_objects = []
        seen_relations = set()
        skipped = 0

        for row in rows:
            poi = pois_by_source_id.get(row["point_of_interest_id"])
            category = categories_by_source_id.get(row["category_id"])
            if not poi or not category:
                skipped += 1
                continue

            key = (poi.pk, category.pk)
            if key in seen_relations:
                continue
            seen_relations.add(key)
            relation_objects.append(through_model(poi_id=poi.pk, category_id=category.pk))

        through_model.objects.bulk_create(relation_objects)

        return {
            "poi_category_relations_created": len(relation_objects),
            "poi_category_relations_skipped": skipped,
        }

    def import_images(self, file_rows, image_rows, pois_by_source_id, image_base_url):
        filenames_by_source_id = {
            row["id"]: row["filename"]
            for row in file_rows
            if row["filename"]
        }
        images_by_poi = defaultdict(list)
        skipped = 0

        for row in image_rows:
            poi = pois_by_source_id.get(row["point_of_interest_id"])
            filename = filenames_by_source_id.get(row["file_uploaded_id"])
            if not poi or not filename:
                skipped += 1
                continue

            images_by_poi[poi.pk].append(
                (
                    int(row["position"] or 0),
                    POIImage(
                        poi=poi,
                        image_url=f"{image_base_url.rstrip('/')}/{filename}",
                        position=int(row["position"] or 0),
                    ),
                )
            )

        image_objects = []
        for poi_id, poi_images in images_by_poi.items():
            ordered_images = sorted(poi_images, key=lambda item: item[0])
            for index, (_position, image) in enumerate(ordered_images):
                image.is_primary = index == 0
                image_objects.append(image)

        POIImage.objects.bulk_create(image_objects)

        return {
            "poi_images_created": len(image_objects),
            "poi_images_skipped": skipped,
        }
