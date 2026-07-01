from django.contrib.gis.db import models
from django.core.validators import RegexValidator
from django.utils import timezone


language_code_validator = RegexValidator(
    regex=r"^[a-z]{2}(-[A-Z]{2})?$",
    message="Use ISO language codes like 'en', 'es', or 'pt-PT'.",
)

slug_validator = RegexValidator(
    regex=r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$",
    message="Use lowercase letters, numbers, hyphens, and underscores only.",
)


class POI(models.Model):
    enabled = models.BooleanField(default=True)
    location = models.PointField(srid=4326)
    website = models.URLField(blank=True)
    categories = models.ManyToManyField(
        "Category",
        related_name="pois",
        blank=True,
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["enabled"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        translation = self.translations.order_by("language_code").first()
        return translation.title if translation else f"POI {self.pk}"

    @property
    def gps_latitude(self):
        return self.location.y if self.location else None

    @property
    def gps_longitude(self):
        return self.location.x if self.location else None


class POITranslation(models.Model):
    poi = models.ForeignKey(
        POI,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    slug = models.SlugField(max_length=255, validators=[slug_validator])

    class Meta:
        ordering = ["language_code", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["poi", "language_code"],
                name="unique_poi_translation_language",
            ),
            models.UniqueConstraint(
                fields=["language_code", "slug"],
                name="unique_poi_translation_slug_per_language",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"]),
            models.Index(fields=["slug"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.language_code})"


class Category(models.Model):
    slug = models.SlugField(max_length=120, unique=True, validators=[slug_validator])
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        ordering = ["slug"]
        verbose_name_plural = "categories"

    def __str__(self):
        translation = self.translations.order_by("language_code").first()
        return translation.name if translation else self.slug


class CategoryTranslation(models.Model):
    category = models.ForeignKey(
        Category,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["language_code", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["category", "language_code"],
                name="unique_category_translation_language",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.language_code})"


class POIImage(models.Model):
    poi = models.ForeignKey(
        POI,
        related_name="images",
        on_delete=models.CASCADE,
    )
    image_url = models.URLField(max_length=1000)
    position = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["poi"],
                condition=models.Q(is_primary=True),
                name="unique_primary_image_per_poi",
            ),
        ]
        indexes = [
            models.Index(fields=["position"]),
            models.Index(fields=["is_primary"]),
        ]

    def __str__(self):
        return f"Image for POI {self.poi_id}"
