from django.contrib import admin

from .models import SemanticAnnotation, VocabularyMapping


@admin.register(VocabularyMapping)
class VocabularyMappingAdmin(admin.ModelAdmin):
    list_display = [
        "source_type",
        "source_id",
        "vocabulary",
        "relation",
        "target_label",
        "target_uri",
        "confidence",
        "reviewed",
    ]
    list_filter = ["source_type", "vocabulary", "relation", "reviewed"]
    search_fields = ["source_id", "target_uri", "target_label", "notes"]


@admin.register(SemanticAnnotation)
class SemanticAnnotationAdmin(admin.ModelAdmin):
    list_display = [
        "subject_type",
        "subject_id",
        "predicate",
        "object_label",
        "object_uri",
        "method",
        "confidence",
        "review_status",
    ]
    list_filter = ["subject_type", "predicate", "method", "review_status"]
    search_fields = ["subject_id", "object_uri", "object_label", "source_field"]

