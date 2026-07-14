from django.core.management.base import BaseCommand

from eccch_export.models import SemanticAnnotation, VocabularyMapping
from pois.models import Category, Itinerary, POI, Route


class Command(BaseCommand):
    help = "Generate baseline semantic annotations from curated vocabulary mappings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing category_mapping annotations before generating new ones.",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            deleted, _ = SemanticAnnotation.objects.filter(method="category_mapping").delete()
            self.stdout.write(f"Deleted {deleted} existing category_mapping annotations.")

        created = 0
        created += self.annotate_pois_from_categories()
        created += self.annotate_direct_mappings("route", Route.objects.values_list("id", flat=True))
        created += self.annotate_direct_mappings("itinerary", Itinerary.objects.values_list("id", flat=True))
        created += self.annotate_direct_mappings("category", Category.objects.values_list("id", flat=True))
        self.stdout.write(self.style.SUCCESS(f"Generated {created} semantic annotations."))

    def annotate_pois_from_categories(self):
        created = 0
        mappings_by_category = {}
        for mapping in VocabularyMapping.objects.filter(source_type="category"):
            mappings_by_category.setdefault(mapping.source_id, []).append(mapping)

        queryset = POI.objects.prefetch_related("categories")
        for poi in queryset.iterator():
            for category in poi.categories.all():
                for mapping in mappings_by_category.get(category.id, []):
                    _, was_created = SemanticAnnotation.objects.get_or_create(
                        subject_type="poi",
                        subject_id=poi.id,
                        predicate="dcterms:type",
                        object_uri=mapping.target_uri,
                        source_field=f"category:{category.slug}",
                        method="category_mapping",
                        defaults={
                            "object_label": mapping.target_label,
                            "confidence": mapping.confidence,
                            "review_status": "accepted" if mapping.reviewed else "candidate",
                            "payload": {
                                "category_id": category.id,
                                "mapping_relation": mapping.relation,
                                "vocabulary": mapping.vocabulary,
                            },
                        },
                    )
                    created += int(was_created)
        return created

    def annotate_direct_mappings(self, source_type, source_ids):
        created = 0
        for mapping in VocabularyMapping.objects.filter(source_type=source_type, source_id__in=source_ids):
            _, was_created = SemanticAnnotation.objects.get_or_create(
                subject_type=source_type,
                subject_id=mapping.source_id,
                predicate="skos:mappingRelation",
                object_uri=mapping.target_uri,
                source_field="vocabulary_mapping",
                method="manual_mapping",
                defaults={
                    "object_label": mapping.target_label,
                    "confidence": mapping.confidence,
                    "review_status": "accepted" if mapping.reviewed else "candidate",
                    "payload": {
                        "mapping_relation": mapping.relation,
                        "vocabulary": mapping.vocabulary,
                    },
                },
            )
            created += int(was_created)
        return created

