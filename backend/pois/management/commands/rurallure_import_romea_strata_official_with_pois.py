import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from django.contrib.gis.geos import Point
from django.core.management.base import CommandError
from django.utils import timezone

from pois.management.commands.import_rurallure_dump import (
    CountryBoundaryLookup,
    DEFAULT_COUNTRY_BOUNDARIES_PATH,
    normalized_category_key,
    unique_slug,
)
from pois.management.gpx_route_import import BaseGpxRouteImportCommand
from pois.models import Category, CategoryTranslation, POI, POIMedia, POITranslation


SOURCE_LANGUAGE_HINTS = {
    "en": {
        "and",
        "are",
        "as",
        "at",
        "built",
        "by",
        "castle",
        "cathedral",
        "church",
        "city",
        "first",
        "for",
        "from",
        "hall",
        "house",
        "in",
        "is",
        "lake",
        "length",
        "longest",
        "medieval",
        "monument",
        "museum",
        "of",
        "park",
        "rebuilt",
        "river",
        "square",
        "the",
        "through",
        "town",
        "trail",
        "was",
        "with",
    },
    "it": {
        "abbazia",
        "al",
        "alla",
        "borgo",
        "castello",
        "chiesa",
        "con",
        "del",
        "della",
        "delle",
        "di",
        "duomo",
        "il",
        "la",
        "monastero",
        "museo",
        "parco",
        "piazza",
        "ponte",
        "santuario",
        "sentiero",
    },
    "de": {
        "am",
        "burg",
        "das",
        "denkmal",
        "der",
        "die",
        "kirche",
        "kloster",
        "museum",
        "rathaus",
        "schloss",
        "und",
        "von",
        "zu",
    },
    "cs": {
        "areal",
        "hrad",
        "je",
        "kostel",
        "muzeum",
        "na",
        "obce",
        "penzion",
        "pro",
        "restaurace",
        "se",
        "v",
        "ve",
        "z",
    },
    "pl": {
        "do",
        "jest",
        "kościół",
        "muzeum",
        "na",
        "oraz",
        "park",
        "po",
        "w",
        "we",
        "zamek",
        "z",
    },
}


DIACRITIC_LANGUAGE_HINTS = {
    "de": set("äöüß"),
    "it": set("àèéìòù"),
}

NAME_LANGUAGE_CODES = {"en", "it", "de"}


def normalized_words(value):
    pattern = r"[a-zàèéìòùäöüßáčďěíňóřšťúůýžąćęłńóśźż]+"
    return re.findall(pattern, (value or "").lower())


def language_scores(value, weight, language_codes=None, use_diacritics=False):
    scores = Counter()
    words = normalized_words(value)
    if not words:
        return scores

    word_set = set(words)
    for language_code, hints in SOURCE_LANGUAGE_HINTS.items():
        if language_codes is not None and language_code not in language_codes:
            continue
        matches = word_set & hints
        if matches:
            scores[language_code] += weight * len(matches)

    if not use_diacritics:
        return scores

    lower_value = (value or "").lower()
    for language_code, characters in DIACRITIC_LANGUAGE_HINTS.items():
        if language_codes is not None and language_code not in language_codes:
            continue
        matches = characters & set(lower_value)
        if matches:
            scores[language_code] += weight * len(matches)

    return scores


def detect_language(name, description, fallback_language):
    scores = Counter()
    scores.update(language_scores(description, 3, use_diacritics=True))
    scores.update(language_scores(name, 1, language_codes=NAME_LANGUAGE_CODES))
    if not scores:
        return fallback_language, "fallback", 0

    ranked = scores.most_common(2)
    best_language, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0
    if best_score >= 3 and best_score >= second_score + 2:
        return best_language, "high", best_score
    if best_score >= 2 and best_score > second_score:
        return best_language, "medium", best_score
    return fallback_language, "fallback", best_score


def poi_fingerprint(waypoint):
    lon, lat = waypoint.coordinates
    normalized_name = normalized_category_key(waypoint.name)
    normalized_category = normalized_category_key(waypoint.category_name)
    return (round(lon, 6), round(lat, 6), normalized_name, normalized_category)


def ascii_slug_seed(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    return normalized.encode("ascii", "ignore").decode("ascii")


class Command(BaseGpxRouteImportCommand):
    help = (
        "Import official Romea Strata GPX route files and bootstrap POIs from GPX waypoints. "
        "Track points are kept as itinerary route geometry."
    )
    base_route_title = "Romea Strata Official"
    base_route_slug = "romea-strata-official"
    source_dir = Path(__file__).resolve().parents[4] / "routes_data" / "romea_strata_official"

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--poi-fallback-language",
            default="it",
            help="Language used for POI translations when detection is inconclusive.",
        )
        parser.add_argument(
            "--clear-pois",
            action="store_true",
            help="Delete existing POIs, POI translations, categories, and category translations before import.",
        )
        parser.add_argument(
            "--language-report",
            action="store_true",
            help="Print language detection confidence counts and examples during dry runs.",
        )
        parser.add_argument(
            "--country-boundaries",
            default=str(DEFAULT_COUNTRY_BOUNDARIES_PATH),
            help="Path to a geoBoundaries ADM0 GeoJSON file used to annotate POIs with physical country codes.",
        )
        parser.add_argument(
            "--skip-country-annotation",
            action="store_true",
            help="Import POIs without deriving country codes from boundary polygons.",
        )

    def write_extra_dry_run(self, source_dir, prepared_routes, options):
        waypoint_count = 0
        unique_waypoints = {}
        category_names = Counter()
        language_counts = Counter()
        examples = defaultdict(list)
        fallback_language = options["poi_fallback_language"].strip() or "it"

        for _, stages in prepared_routes:
            for stage in stages:
                for waypoint in stage.waypoints:
                    waypoint_count += 1
                    if waypoint.category_name:
                        category_names[waypoint.category_name] += 1
                    unique_waypoints.setdefault(poi_fingerprint(waypoint), waypoint)
                    language_code, confidence, score = detect_language(
                        waypoint.name,
                        waypoint.description,
                        fallback_language,
                    )
                    language_counts[(language_code, confidence)] += 1
                    if options["language_report"] and len(examples[(language_code, confidence)]) < 8:
                        examples[(language_code, confidence)].append((waypoint, score))

        self.stdout.write(f"GPX waypoint POIs found: {waypoint_count}")
        self.stdout.write(f"Unique GPX waypoint POIs after deduplication: {len(unique_waypoints)}")
        self.stdout.write(f"Distinct GPX category labels: {len(category_names)}")
        if options["skip_country_annotation"]:
            self.stdout.write("Country annotation: skipped")
        else:
            country_boundaries_path = Path(options["country_boundaries"]).expanduser().resolve()
            self.stdout.write(f"Country annotation boundaries: {country_boundaries_path}")
        for name, count in category_names.most_common(20):
            self.stdout.write(f"  {count}: {name}")

        if options["language_report"]:
            self.stdout.write("Language detection:")
            for (language_code, confidence), count in sorted(language_counts.items()):
                self.stdout.write(f"  {language_code}/{confidence}: {count}")
            for key, values in sorted(examples.items()):
                language_code, confidence = key
                self.stdout.write(f"Examples for {language_code}/{confidence}:")
                for waypoint, score in values:
                    self.stdout.write(
                        f"  score={score} name={waypoint.name!r} type={waypoint.category_name!r} "
                        f"desc={waypoint.description[:120]!r}"
                    )

    def before_import(self, source_dir, prepared_routes, options):
        if options["clear_pois"]:
            POIMedia.objects.all().delete()
            POITranslation.objects.all().delete()
            POI.objects.all().delete()
            CategoryTranslation.objects.all().delete()
            Category.objects.all().delete()
            return

        if any(model.objects.exists() for model in (POI, POITranslation, Category, CategoryTranslation, POIMedia)):
            raise CommandError(
                "Target POI/category tables are not empty. Re-run with --clear-pois or start from an empty database."
            )

    def import_extra_content(self, source_dir, prepared_routes, options, itinerary_by_stage_path=None):
        fallback_language = options["poi_fallback_language"].strip() or "it"
        imported_at = timezone.now()
        country_lookup = self.country_lookup(options)
        unique_waypoints = {}
        for _, stages in prepared_routes:
            for stage in stages:
                for waypoint in stage.waypoints:
                    if waypoint.name and waypoint.coordinates:
                        unique_waypoints.setdefault(poi_fingerprint(waypoint), waypoint)

        waypoints = list(unique_waypoints.values())
        category_by_key = self.import_categories(waypoints, imported_at)
        poi_by_fingerprint, poi_stats = self.import_pois(
            waypoints,
            category_by_key,
            fallback_language,
            imported_at,
            country_lookup,
        )
        link_stats = self.link_pois_to_itineraries(
            prepared_routes,
            itinerary_by_stage_path or {},
            poi_by_fingerprint,
        )
        return {
            "poi_waypoints_imported": len(unique_waypoints),
            **poi_stats,
            **link_stats,
        }

    def country_lookup(self, options):
        if options["skip_country_annotation"]:
            return None
        country_boundaries_path = Path(options["country_boundaries"]).expanduser().resolve()
        if not country_boundaries_path.exists():
            raise CommandError(
                "Country boundaries file not found: "
                f"{country_boundaries_path}. Pass --country-boundaries or use --skip-country-annotation."
            )
        self.stdout.write(f"Loading country boundaries from {country_boundaries_path}...")
        return CountryBoundaryLookup.from_geojson(country_boundaries_path, {})

    def import_categories(self, waypoints, imported_at):
        category_by_key = {}
        used_slugs = set(Category.objects.values_list("slug", flat=True))

        for waypoint in waypoints:
            category_name = waypoint.category_name.strip()
            if not category_name:
                continue
            key = normalized_category_key(category_name)
            if key in category_by_key:
                continue
            category = Category.objects.create(
                slug=unique_slug(
                    ascii_slug_seed(category_name),
                    used_slugs,
                    f"category-{len(category_by_key) + 1}",
                    120,
                ),
                created_at=imported_at,
            )
            category_by_key[key] = category
            CategoryTranslation.objects.create(category=category, language_code="it", name=category_name[:255])
        return category_by_key

    def import_pois(self, waypoints, category_by_key, fallback_language, imported_at, country_lookup):
        used_slugs_by_language = defaultdict(lambda: set(POITranslation.objects.values_list("slug", flat=True)))
        through_model = POI.categories.through
        poi_count = 0
        without_country = 0
        relation_objects = []
        translations = []
        confidence_counts = Counter()
        poi_by_fingerprint = {}

        total = len(waypoints)
        for index, waypoint in enumerate(waypoints, start=1):
            lon, lat = waypoint.coordinates
            location = Point(lon, lat, srid=4326)
            country_code = country_lookup.country_code_for_point(location) if country_lookup else ""
            if country_lookup and not country_code:
                without_country += 1
            poi = POI.objects.create(
                enabled=True,
                country_code=country_code,
                location=location,
                created_at=imported_at,
                updated_at=imported_at,
            )
            poi_by_fingerprint[poi_fingerprint(waypoint)] = poi
            poi_count += 1

            category = category_by_key.get(normalized_category_key(waypoint.category_name))
            if category:
                relation_objects.append(through_model(poi_id=poi.pk, category_id=category.pk))

            language_code, confidence, _score = detect_language(
                waypoint.name,
                waypoint.description,
                fallback_language,
            )
            confidence_counts[f"poi_language_{language_code}_{confidence}"] += 1
            slug = unique_slug(
                ascii_slug_seed(waypoint.name),
                used_slugs_by_language[language_code],
                f"romea-strata-poi-{index}",
                255,
            )
            translations.append(
                POITranslation(
                    poi=poi,
                    language_code=language_code,
                    title=waypoint.name[:255],
                    description=waypoint.description,
                    slug=slug,
                    is_reference=True,
                )
            )
            if index == 1 or index == total or index % 100 == 0:
                self.write_progress("Importing POIs", index, total)

        through_model.objects.bulk_create(relation_objects)
        POITranslation.objects.bulk_create(translations)
        return poi_by_fingerprint, {
            "pois_created": poi_count,
            "pois_without_country": without_country,
            "poi_category_relations_created": len(relation_objects),
            "poi_translations_created": len(translations),
            **confidence_counts,
        }

    def link_pois_to_itineraries(self, prepared_routes, itinerary_by_stage_path, poi_by_fingerprint):
        updated_itinerary_count = 0
        linked_poi_count = 0
        skipped_waypoint_count = 0

        for _, stages in prepared_routes:
            for stage in stages:
                itinerary = itinerary_by_stage_path.get(str(stage.path))
                if itinerary is None:
                    skipped_waypoint_count += len(stage.waypoints)
                    continue

                existing_ids = []
                seen_ids = set()
                for raw_id in (itinerary.itinerary_json or {}).get("poiIds") or []:
                    try:
                        poi_id = int(raw_id)
                    except (TypeError, ValueError):
                        continue
                    if poi_id in seen_ids:
                        continue
                    seen_ids.add(poi_id)
                    existing_ids.append(poi_id)

                added_ids = []
                for waypoint in stage.waypoints:
                    poi = poi_by_fingerprint.get(poi_fingerprint(waypoint))
                    if poi is None:
                        skipped_waypoint_count += 1
                        continue
                    if poi.id in seen_ids:
                        continue
                    seen_ids.add(poi.id)
                    added_ids.append(poi.id)

                if not added_ids:
                    continue
                itinerary.itinerary_json["poiIds"] = existing_ids + added_ids
                itinerary.save(update_fields=["itinerary_json", "updated_at"])
                updated_itinerary_count += 1
                linked_poi_count += len(added_ids)

        return {
            "itineraries_linked_to_pois": updated_itinerary_count,
            "itinerary_poi_links_created": linked_poi_count,
            "itinerary_poi_links_skipped_without_poi": skipped_waypoint_count,
        }
