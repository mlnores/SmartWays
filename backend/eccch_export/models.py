from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone


class ExportSubjectType(models.TextChoices):
    ROUTE = "route", "Route"
    ITINERARY = "itinerary", "Itinerary"
    POI = "poi", "POI"
    CATEGORY = "category", "Category"
    MEDIA = "media", "Media"


class MappingRelation(models.TextChoices):
    EXACT = "exactMatch", "Exact match"
    CLOSE = "closeMatch", "Close match"
    BROAD = "broadMatch", "Broad match"
    NARROW = "narrowMatch", "Narrow match"
    RELATED = "relatedMatch", "Related match"


class AnnotationStatus(models.TextChoices):
    CANDIDATE = "candidate", "Candidate"
    ACCEPTED = "accepted", "Accepted"
    REJECTED = "rejected", "Rejected"


class VocabularyMapping(models.Model):
    source_type = models.CharField(max_length=20, choices=ExportSubjectType.choices)
    source_id = models.PositiveBigIntegerField()
    vocabulary = models.CharField(max_length=80)
    target_uri = models.URLField(max_length=1000)
    target_label = models.CharField(max_length=255, blank=True)
    relation = models.CharField(
        max_length=20,
        choices=MappingRelation.choices,
        default=MappingRelation.CLOSE,
    )
    confidence = models.FloatField(default=1.0, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)])
    reviewed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["source_type", "source_id", "vocabulary", "target_uri"]
        indexes = [
            models.Index(fields=["source_type", "source_id"]),
            models.Index(fields=["vocabulary"]),
            models.Index(fields=["target_uri"]),
            models.Index(fields=["reviewed"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_id", "vocabulary", "target_uri", "relation"],
                name="unique_eccch_vocabulary_mapping",
            ),
        ]

    def __str__(self):
        label = self.target_label or self.target_uri
        return f"{self.source_type}:{self.source_id} {self.relation} {label}"


class SemanticAnnotation(models.Model):
    subject_type = models.CharField(max_length=20, choices=ExportSubjectType.choices)
    subject_id = models.PositiveBigIntegerField()
    predicate = models.CharField(max_length=120)
    object_uri = models.URLField(max_length=1000)
    object_label = models.CharField(max_length=255, blank=True)
    source_field = models.CharField(max_length=120, blank=True)
    method = models.CharField(max_length=80, default="manual")
    confidence = models.FloatField(default=1.0, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)])
    review_status = models.CharField(
        max_length=20,
        choices=AnnotationStatus.choices,
        default=AnnotationStatus.CANDIDATE,
    )
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["subject_type", "subject_id", "predicate", "object_uri"]
        indexes = [
            models.Index(fields=["subject_type", "subject_id"]),
            models.Index(fields=["predicate"]),
            models.Index(fields=["object_uri"]),
            models.Index(fields=["review_status"]),
            models.Index(fields=["method"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["subject_type", "subject_id", "predicate", "object_uri", "source_field", "method"],
                name="unique_eccch_semantic_annotation",
            ),
        ]

    def __str__(self):
        label = self.object_label or self.object_uri
        return f"{self.subject_type}:{self.subject_id} {self.predicate} {label}"
