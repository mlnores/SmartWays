from pathlib import Path

from django.core.management.base import BaseCommand

from eccch_export.services.packages import build_dataset_package


class Command(BaseCommand):
    help = "Export SmartWays routes, itineraries, POIs, media, mappings, and annotations as an ECCCH package."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            default="smartways-eccch-export.zip",
            help="Output ZIP path.",
        )
        parser.add_argument(
            "--include-drafts",
            action="store_true",
            help="Include draft routes, itineraries, and POIs.",
        )

    def handle(self, *args, **options):
        output = Path(options["output"]).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("wb") as output_file:
            build_dataset_package(output_file, include_drafts=options["include_drafts"])
        self.stdout.write(self.style.SUCCESS(f"ECCCH export written to {output}"))

