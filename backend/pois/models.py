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

country_code_validator = RegexValidator(
    regex=r"^[A-Z]{2}$",
    message="Use ISO 3166-1 alpha-2 country codes like 'ES', 'PT', or 'FR'.",
)


class POI(models.Model):
    enabled = models.BooleanField(default=True)
    country_code = models.CharField(max_length=2, blank=True, validators=[country_code_validator])
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
            models.Index(fields=["enabled"], name="pois_poi_enabled_4f9c1f_idx"),
            models.Index(fields=["country_code"], name="pois_poi_country_27d5ea_idx"),
            models.Index(fields=["created_at"], name="pois_poi_created_67f944_idx"),
        ]

    def __str__(self):
        translation = self.translations.filter(is_reference=True).first() or self.translations.order_by(
            "language_code"
        ).first()
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
    is_reference = models.BooleanField(default=False)

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
            models.UniqueConstraint(
                fields=["poi"],
                condition=models.Q(is_reference=True),
                name="unique_reference_poi_translation",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_poitra_languag_fbe131_idx"),
            models.Index(fields=["slug"], name="pois_poitra_slug_f2c1cd_idx"),
        ]

    def __str__(self):
        return f"{self.title} ({self.language_code})"

    def save(self, *args, **kwargs):
        if self.is_reference and self.poi_id:
            POITranslation.objects.filter(poi_id=self.poi_id, is_reference=True).exclude(pk=self.pk).update(
                is_reference=False
            )
        super().save(*args, **kwargs)


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
            models.Index(fields=["language_code"], name="pois_catego_languag_1ebb08_idx"),
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
            models.Index(fields=["position"], name="pois_poiima_positio_8f58b3_idx"),
            models.Index(fields=["is_primary"], name="pois_poiima_is_prim_9a1275_idx"),
        ]

    def __str__(self):
        return f"Image for POI {self.poi_id}"


class Route(models.Model):
    enabled = models.BooleanField(default=True)
    itineraries = models.ManyToManyField(
        "Itinerary",
        through="RouteStage",
        related_name="routes",
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
        translation = self.translations.filter(is_reference=True).first() or self.translations.order_by(
            "language_code"
        ).first()
        return translation.title if translation else f"Route {self.pk}"


class RouteTranslation(models.Model):
    route = models.ForeignKey(
        Route,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    slug = models.SlugField(max_length=255, validators=[slug_validator], blank=True)
    is_reference = models.BooleanField(default=False)

    class Meta:
        ordering = ["language_code", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["route", "language_code"],
                name="unique_route_translation_language",
            ),
            models.UniqueConstraint(
                fields=["language_code", "slug"],
                name="unique_route_translation_slug_per_language",
            ),
            models.UniqueConstraint(
                fields=["route"],
                condition=models.Q(is_reference=True),
                name="unique_reference_route_translation",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"]),
            models.Index(fields=["slug"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.language_code})"

    def save(self, *args, **kwargs):
        if self.is_reference and self.route_id:
            RouteTranslation.objects.filter(route_id=self.route_id, is_reference=True).exclude(pk=self.pk).update(
                is_reference=False
            )
        super().save(*args, **kwargs)


class Itinerary(models.Model):
    enabled = models.BooleanField(default=True)
    itinerary_json = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        verbose_name_plural = "itineraries"
        indexes = [
            models.Index(fields=["enabled"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        translation = self.translations.filter(is_reference=True).first() or self.translations.order_by(
            "language_code"
        ).first()
        return translation.title if translation else f"Itinerary {self.pk}"


class RouteStage(models.Model):
    route = models.ForeignKey(
        Route,
        related_name="stages",
        on_delete=models.CASCADE,
    )
    itinerary = models.ForeignKey(
        Itinerary,
        related_name="route_stages",
        on_delete=models.CASCADE,
    )
    stage_number = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["route", "stage_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["route", "stage_number"],
                name="unique_stage_number_per_route",
            ),
            models.UniqueConstraint(
                fields=["route", "itinerary"],
                name="unique_itinerary_per_route",
            ),
        ]
        indexes = [
            models.Index(fields=["route", "stage_number"]),
            models.Index(fields=["itinerary"]),
        ]

    def __str__(self):
        return f"{self.route} stage {self.stage_number}: {self.itinerary}"


class ItineraryTranslation(models.Model):
    itinerary = models.ForeignKey(
        Itinerary,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    slug = models.SlugField(max_length=255, validators=[slug_validator], blank=True)
    is_reference = models.BooleanField(default=False)

    class Meta:
        ordering = ["language_code", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["itinerary", "language_code"],
                name="unique_itinerary_translation_language",
            ),
            models.UniqueConstraint(
                fields=["itinerary"],
                condition=models.Q(is_reference=True),
                name="unique_reference_itinerary_translation",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"]),
            models.Index(fields=["slug"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.language_code})"

    def save(self, *args, **kwargs):
        if self.is_reference and self.itinerary_id:
            ItineraryTranslation.objects.filter(
                itinerary_id=self.itinerary_id, is_reference=True
            ).exclude(pk=self.pk).update(is_reference=False)
        super().save(*args, **kwargs)
