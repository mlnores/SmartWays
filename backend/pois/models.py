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
    footprint = models.MultiPolygonField(srid=4326, null=True, blank=True)
    website = models.URLField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
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


class POIMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        DOCUMENT = "document", "Document"
        LINK = "link", "Link"
        OTHER = "other", "Other"

    poi = models.ForeignKey(
        POI,
        related_name="media",
        on_delete=models.CASCADE,
    )
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.IMAGE)
    url = models.URLField(max_length=1000, blank=True)
    file = models.FileField(upload_to="poi-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["poi"],
                condition=models.Q(is_primary=True),
                name="unique_primary_media_per_poi",
            ),
        ]
        indexes = [
            models.Index(fields=["media_type"], name="pois_poimed_media_t_f87a71_idx"),
            models.Index(fields=["position"], name="pois_poimed_positio_2be32b_idx"),
            models.Index(fields=["is_primary"], name="pois_poimed_is_prim_565904_idx"),
        ]

    def __str__(self):
        return f"{self.get_media_type_display()} for POI {self.poi_id}"

    @property
    def public_url(self):
        if self.url:
            return self.url
        if self.file:
            return self.file.url
        return ""


class POIMediaTranslation(models.Model):
    media = models.ForeignKey(
        POIMedia,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    caption = models.TextField(blank=True)

    class Meta:
        ordering = ["language_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["media", "language_code"],
                name="unique_poi_media_translation_language",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_poimtr_languag_12b70f_idx"),
        ]

    def __str__(self):
        return f"Caption for media {self.media_id} ({self.language_code})"


class Fest(models.Model):
    enabled = models.BooleanField(default=True)
    country_code = models.CharField(max_length=2, blank=True, validators=[country_code_validator])
    location = models.PointField(srid=4326)
    footprint = models.MultiPolygonField(srid=4326, null=True, blank=True)
    website = models.URLField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    categories = models.ManyToManyField(
        "FestCategory",
        related_name="fests",
        blank=True,
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["enabled"], name="pois_fest_enabled_idx"),
            models.Index(fields=["country_code"], name="pois_fest_country_idx"),
            models.Index(fields=["created_at"], name="pois_fest_created_idx"),
        ]

    def __str__(self):
        translation = self.translations.filter(is_reference=True).first() or self.translations.order_by(
            "language_code"
        ).first()
        return translation.title if translation else f"Fest {self.pk}"

    @property
    def gps_latitude(self):
        return self.location.y if self.location else None

    @property
    def gps_longitude(self):
        return self.location.x if self.location else None


class FestTranslation(models.Model):
    fest = models.ForeignKey(
        Fest,
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
                fields=["fest", "language_code"],
                name="unique_fest_translation_lang",
            ),
            models.UniqueConstraint(
                fields=["language_code", "slug"],
                name="unique_fest_slug_per_lang",
            ),
            models.UniqueConstraint(
                fields=["fest"],
                condition=models.Q(is_reference=True),
                name="unique_reference_fest_trans",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_festtr_lang_idx"),
            models.Index(fields=["slug"], name="pois_festtr_slug_idx"),
        ]

    def __str__(self):
        return f"{self.title} ({self.language_code})"

    def save(self, *args, **kwargs):
        if self.is_reference and self.fest_id:
            FestTranslation.objects.filter(fest_id=self.fest_id, is_reference=True).exclude(pk=self.pk).update(
                is_reference=False
            )
        super().save(*args, **kwargs)


class FestCategory(models.Model):
    slug = models.SlugField(max_length=120, unique=True, validators=[slug_validator])
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        ordering = ["slug"]
        verbose_name_plural = "fest categories"

    def __str__(self):
        translation = self.translations.order_by("language_code").first()
        return translation.name if translation else self.slug


class FestCategoryTranslation(models.Model):
    category = models.ForeignKey(
        FestCategory,
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
                name="unique_fest_cat_trans_lang",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_festcat_lang_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.language_code})"


class FestMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        DOCUMENT = "document", "Document"
        LINK = "link", "Link"
        OTHER = "other", "Other"

    fest = models.ForeignKey(
        Fest,
        related_name="media",
        on_delete=models.CASCADE,
    )
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.IMAGE)
    url = models.URLField(max_length=1000, blank=True)
    file = models.FileField(upload_to="fest-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["fest"],
                condition=models.Q(is_primary=True),
                name="unique_primary_media_per_fest",
            ),
        ]
        indexes = [
            models.Index(fields=["media_type"], name="pois_festmed_type_idx"),
            models.Index(fields=["position"], name="pois_festmed_pos_idx"),
            models.Index(fields=["is_primary"], name="pois_festmed_primary_idx"),
        ]

    def __str__(self):
        return f"{self.get_media_type_display()} for fest {self.fest_id}"

    @property
    def public_url(self):
        if self.url:
            return self.url
        if self.file:
            return self.file.url
        return ""


class FestMediaTranslation(models.Model):
    media = models.ForeignKey(
        FestMedia,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    caption = models.TextField(blank=True)

    class Meta:
        ordering = ["language_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["media", "language_code"],
                name="unique_fest_media_trans_lang",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_festmtr_lang_idx"),
        ]

    def __str__(self):
        return f"Caption for media {self.media_id} ({self.language_code})"


class FestEdition(models.Model):
    fest = models.ForeignKey(
        Fest,
        related_name="editions",
        on_delete=models.CASCADE,
    )
    year = models.PositiveIntegerField()
    notes = models.TextField(blank=True)
    is_cancelled = models.BooleanField(default=False)

    class Meta:
        ordering = ["year"]
        constraints = [
            models.UniqueConstraint(fields=["fest", "year"], name="unique_fest_edition_year"),
        ]
        indexes = [
            models.Index(fields=["year"], name="pois_fested_year_idx"),
            models.Index(fields=["is_cancelled"], name="pois_fested_cancel_idx"),
        ]

    def __str__(self):
        return f"{self.fest} ({self.year})"


class FestDate(models.Model):
    edition = models.ForeignKey(
        FestEdition,
        related_name="dates",
        on_delete=models.CASCADE,
    )
    date = models.DateField()

    class Meta:
        ordering = ["date"]
        constraints = [
            models.UniqueConstraint(fields=["edition", "date"], name="unique_fest_edition_date"),
        ]
        indexes = [
            models.Index(fields=["date"], name="pois_festdate_date_idx"),
        ]

    def __str__(self):
        return self.date.isoformat()


class RouteMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        DOCUMENT = "document", "Document"
        LINK = "link", "Link"
        OTHER = "other", "Other"

    route = models.ForeignKey(
        "Route",
        related_name="media",
        on_delete=models.CASCADE,
    )
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.IMAGE)
    url = models.URLField(max_length=1000, blank=True)
    file = models.FileField(upload_to="route-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["route"],
                condition=models.Q(is_primary=True),
                name="unique_primary_media_per_route",
            ),
        ]
        indexes = [
            models.Index(fields=["media_type"], name="pois_routem_media_t_983cab_idx"),
            models.Index(fields=["position"], name="pois_routem_positio_102b54_idx"),
            models.Index(fields=["is_primary"], name="pois_routem_is_prim_481f2c_idx"),
        ]

    def __str__(self):
        return f"{self.get_media_type_display()} for route {self.route_id}"

    @property
    def public_url(self):
        if self.url:
            return self.url
        if self.file:
            return self.file.url
        return ""


class RouteMediaTranslation(models.Model):
    media = models.ForeignKey(
        RouteMedia,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    caption = models.TextField(blank=True)

    class Meta:
        ordering = ["language_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["media", "language_code"],
                name="unique_route_media_translation_language",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_routmt_languag_68e5c1_idx"),
        ]

    def __str__(self):
        return f"Caption for route media {self.media_id} ({self.language_code})"


class ItineraryMedia(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        DOCUMENT = "document", "Document"
        LINK = "link", "Link"
        OTHER = "other", "Other"

    itinerary = models.ForeignKey(
        "Itinerary",
        related_name="media",
        on_delete=models.CASCADE,
    )
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.IMAGE)
    url = models.URLField(max_length=1000, blank=True)
    file = models.FileField(upload_to="itinerary-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveBigIntegerField(null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["itinerary"],
                condition=models.Q(is_primary=True),
                name="unique_primary_media_per_itinerary",
            ),
        ]
        indexes = [
            models.Index(fields=["media_type"], name="pois_itinme_media_t_d2f5fb_idx"),
            models.Index(fields=["position"], name="pois_itinme_positio_40b1f4_idx"),
            models.Index(fields=["is_primary"], name="pois_itinme_is_prim_0d5744_idx"),
        ]

    def __str__(self):
        return f"{self.get_media_type_display()} for itinerary {self.itinerary_id}"

    @property
    def public_url(self):
        if self.url:
            return self.url
        if self.file:
            return self.file.url
        return ""


class ItineraryMediaTranslation(models.Model):
    media = models.ForeignKey(
        ItineraryMedia,
        related_name="translations",
        on_delete=models.CASCADE,
    )
    language_code = models.CharField(max_length=8, validators=[language_code_validator])
    caption = models.TextField(blank=True)

    class Meta:
        ordering = ["language_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["media", "language_code"],
                name="unique_itinerary_media_translation_language",
            ),
        ]
        indexes = [
            models.Index(fields=["language_code"], name="pois_itinmt_languag_ae9e60_idx"),
        ]

    def __str__(self):
        return f"Caption for itinerary media {self.media_id} ({self.language_code})"


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
