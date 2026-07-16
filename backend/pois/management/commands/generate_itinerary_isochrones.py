from django.core.management.base import BaseCommand, CommandError
from pois.isochrones import (
    DEFAULT_ISOCHRONE_BATCH_SIZE,
    DEFAULT_ISOCHRONE_MINUTES,
    DEFAULT_ISOCHRONE_PROFILE,
    DEFAULT_ISOCHRONE_PROVIDER_URL,
    DEFAULT_ISOCHRONE_SAMPLE_DISTANCE_METERS,
    DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS,
    DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS,
    IsochroneProviderError,
    OpenRouteServiceIsochroneProvider,
    generate_itinerary_isochrones,
    sample_walking_geometries,
    selected_walking_segment_geometries,
    source_route_hash,
)
from pois.models import Itinerary


class Command(BaseCommand):
    help = "Generate real isochrone polygons for public itineraries with saved walking paths."

    def add_arguments(self, parser):
        parser.add_argument("--itinerary", action="append", type=int, help="Only process this itinerary id. Can be repeated.")
        parser.add_argument("--minutes", default=",".join(str(value) for value in DEFAULT_ISOCHRONE_MINUTES))
        parser.add_argument("--mode", default="foot")
        parser.add_argument("--profile", default=DEFAULT_ISOCHRONE_PROFILE)
        parser.add_argument("--provider-url", default="", help=f"Isochrone endpoint URL. Defaults to {DEFAULT_ISOCHRONE_PROVIDER_URL}.")
        parser.add_argument("--api-key", default="")
        parser.add_argument("--sample-distance-meters", type=int, default=DEFAULT_ISOCHRONE_SAMPLE_DISTANCE_METERS)
        parser.add_argument("--simplify-tolerance-meters", type=int, default=DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS)
        parser.add_argument("--smooth-iterations", type=int, default=DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS)
        parser.add_argument("--max-locations-per-itinerary", type=int, default=0)
        parser.add_argument("--batch-size", type=int, default=DEFAULT_ISOCHRONE_BATCH_SIZE)
        parser.add_argument("--timeout", type=int, default=60)
        parser.add_argument("--pause-seconds", type=float, default=0)
        parser.add_argument("--force", action="store_true", help="Regenerate even when the saved route hash has not changed.")
        parser.add_argument("--clear", action="store_true", help="Delete existing rows for processed itineraries before generating.")
        parser.add_argument("--dry-run", action="store_true", help="Report what would be generated without calling the provider.")

    def handle(self, *args, **options):
        minutes = self.parse_minutes(options["minutes"])
        if not minutes:
            raise CommandError("At least one duration is required.")
        if options["sample_distance_meters"] < 1:
            raise CommandError("--sample-distance-meters must be greater than 0.")
        if options["simplify_tolerance_meters"] < 0:
            raise CommandError("--simplify-tolerance-meters must be 0 or greater.")
        if options["smooth_iterations"] < 0:
            raise CommandError("--smooth-iterations must be 0 or greater.")

        processed = skipped = generated = 0
        queryset = Itinerary.objects.filter(enabled=True).order_by("id").only("id", "itinerary_json", "enabled")
        if options["itinerary"]:
            requested_ids = set(options["itinerary"])
            found = {
                itinerary.id: itinerary.enabled
                for itinerary in Itinerary.objects.filter(id__in=requested_ids).only("id", "enabled")
            }
            for itinerary_id in sorted(requested_ids - set(found)):
                skipped += 1
                self.stdout.write(self.style.WARNING(f"Skipping itinerary {itinerary_id}: itinerary does not exist."))
            for itinerary_id, enabled in sorted(found.items()):
                if not enabled:
                    skipped += 1
                    self.stdout.write(self.style.WARNING(f"Skipping itinerary {itinerary_id}: itinerary is not public."))
            queryset = queryset.filter(id__in=options["itinerary"])

        provider = OpenRouteServiceIsochroneProvider(
            url=options["provider_url"] or None,
            api_key=options["api_key"],
            profile=options["profile"],
            timeout=options["timeout"],
            pause_seconds=options["pause_seconds"],
        )

        for itinerary in queryset:
            geometries = selected_walking_segment_geometries(itinerary.itinerary_json)
            if not geometries:
                skipped += 1
                self.stdout.write(f"Skipping itinerary {itinerary.id}: no saved walking paths.")
                continue

            route_hash = source_route_hash(geometries)
            locations = sample_walking_geometries(
                geometries,
                options["sample_distance_meters"],
                max_locations=options["max_locations_per_itinerary"] or None,
            )
            if not locations:
                skipped += 1
                self.stdout.write(f"Skipping itinerary {itinerary.id}: no valid sample locations.")
                continue

            processed += 1
            self.stdout.write(
                f"Itinerary {itinerary.id}: {len(geometries)} walking segment(s), "
                f"{len(locations)} sampled location(s), durations {minutes}."
            )
            if options["dry_run"]:
                continue

            try:
                result = generate_itinerary_isochrones(
                    itinerary,
                    provider=provider,
                    minutes=minutes,
                    mode=options["mode"],
                    sample_distance_meters=options["sample_distance_meters"],
                    simplify_tolerance_meters=options["simplify_tolerance_meters"],
                    smooth_iterations=options["smooth_iterations"],
                    max_locations=options["max_locations_per_itinerary"] or None,
                    batch_size=options["batch_size"],
                    clear=options["clear"],
                    force=options["force"],
                )
            except IsochroneProviderError as error:
                raise CommandError(str(error)) from error

            if result["status"] == "skipped":
                skipped += 1
                self.stdout.write(f"Skipping itinerary {itinerary.id}: {result['reason']}.")
                continue
            generated += result["generated"]

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"Dry run: {processed} itinerary/itineraries would be processed; {skipped} skipped."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Generated {generated} isochrone row(s); {processed} itinerary/itineraries processed; {skipped} skipped."))

    def parse_minutes(self, value):
        minutes = []
        for item in str(value).split(","):
            item = item.strip()
            if not item:
                continue
            try:
                minute = int(item)
            except ValueError as error:
                raise CommandError("--minutes must be a comma-separated list of integers.") from error
            if minute < 1:
                raise CommandError("--minutes values must be greater than 0.")
            if minute not in minutes:
                minutes.append(minute)
        return minutes
