from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from pois.models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryTranslation,
    POI,
    POIImage,
    POITranslation,
    Route,
    RouteTranslation,
)


class Command(BaseCommand):
    help = "Delete POIs, itineraries, routes, and their dependent metadata."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Confirm deletion. Required unless --dry-run is used.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report counts without deleting anything.",
        )
        parser.add_argument(
            "--keep-categories",
            action="store_true",
            help="Keep categories and category translations while deleting POIs, itineraries, and routes.",
        )

    def handle(self, *args, **options):
        if not options["dry_run"] and not options["yes"]:
            raise CommandError("This command deletes content data. Re-run with --yes to confirm.")

        counts = {
            "poi_images": POIImage.objects.count(),
            "poi_translations": POITranslation.objects.count(),
            "pois": POI.objects.count(),
            "itinerary_translations": ItineraryTranslation.objects.count(),
            "itineraries": Itinerary.objects.count(),
            "route_translations": RouteTranslation.objects.count(),
            "routes": Route.objects.count(),
        }
        if not options["keep_categories"]:
            counts.update(
                {
                    "category_translations": CategoryTranslation.objects.count(),
                    "categories": Category.objects.count(),
                }
            )

        if options["dry_run"]:
            self.stdout.write("Rows that would be deleted:")
            for key, value in counts.items():
                self.stdout.write(f"{key}: {value}")
            return

        with transaction.atomic():
            POIImage.objects.all().delete()
            POITranslation.objects.all().delete()
            POI.objects.all().delete()
            ItineraryTranslation.objects.all().delete()
            Itinerary.objects.all().delete()
            RouteTranslation.objects.all().delete()
            Route.objects.all().delete()
            if not options["keep_categories"]:
                CategoryTranslation.objects.all().delete()
                Category.objects.all().delete()

        self.stdout.write(self.style.SUCCESS("Deleted content data."))
        for key, value in counts.items():
            self.stdout.write(f"{key}: {value}")
