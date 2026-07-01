# Generated for the initial SmartWays POI backend foundation.
from django.contrib.gis.db import models as gis_models
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import pois.models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Category",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=120, unique=True, validators=[pois.models.slug_validator])),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
            ],
            options={
                "verbose_name_plural": "categories",
                "ordering": ["slug"],
            },
        ),
        migrations.CreateModel(
            name="POI",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("location", gis_models.PointField(srid=4326)),
                ("website", models.URLField(blank=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("categories", models.ManyToManyField(blank=True, related_name="pois", to="pois.category")),
            ],
            options={
                "ordering": ["id"],
            },
        ),
        migrations.CreateModel(
            name="CategoryTranslation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("language_code", models.CharField(max_length=8, validators=[pois.models.language_code_validator])),
                ("name", models.CharField(max_length=255)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="translations",
                        to="pois.category",
                    ),
                ),
            ],
            options={
                "ordering": ["language_code", "name"],
            },
        ),
        migrations.CreateModel(
            name="POIImage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image_url", models.URLField(max_length=1000)),
                ("position", models.PositiveIntegerField(default=0)),
                ("is_primary", models.BooleanField(default=False)),
                (
                    "poi",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="images",
                        to="pois.poi",
                    ),
                ),
            ],
            options={
                "ordering": ["position", "id"],
            },
        ),
        migrations.CreateModel(
            name="POITranslation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("language_code", models.CharField(max_length=8, validators=[pois.models.language_code_validator])),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
                ("slug", models.SlugField(max_length=255, validators=[pois.models.slug_validator])),
                (
                    "poi",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="translations",
                        to="pois.poi",
                    ),
                ),
            ],
            options={
                "ordering": ["language_code", "title"],
            },
        ),
        migrations.AddIndex(
            model_name="categorytranslation",
            index=models.Index(fields=["language_code"], name="pois_catego_languag_1ebb08_idx"),
        ),
        migrations.AddConstraint(
            model_name="categorytranslation",
            constraint=models.UniqueConstraint(
                fields=("category", "language_code"),
                name="unique_category_translation_language",
            ),
        ),
        migrations.AddIndex(
            model_name="poi",
            index=models.Index(fields=["enabled"], name="pois_poi_enabled_4f9c1f_idx"),
        ),
        migrations.AddIndex(
            model_name="poi",
            index=models.Index(fields=["created_at"], name="pois_poi_created_67f944_idx"),
        ),
        migrations.AddIndex(
            model_name="poiimage",
            index=models.Index(fields=["position"], name="pois_poiima_positio_8f58b3_idx"),
        ),
        migrations.AddIndex(
            model_name="poiimage",
            index=models.Index(fields=["is_primary"], name="pois_poiima_is_prim_9a1275_idx"),
        ),
        migrations.AddConstraint(
            model_name="poiimage",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_primary=True),
                fields=("poi",),
                name="unique_primary_image_per_poi",
            ),
        ),
        migrations.AddIndex(
            model_name="poitranslation",
            index=models.Index(fields=["language_code"], name="pois_poitra_languag_fbe131_idx"),
        ),
        migrations.AddIndex(
            model_name="poitranslation",
            index=models.Index(fields=["slug"], name="pois_poitra_slug_f2c1cd_idx"),
        ),
        migrations.AddConstraint(
            model_name="poitranslation",
            constraint=models.UniqueConstraint(
                fields=("poi", "language_code"),
                name="unique_poi_translation_language",
            ),
        ),
        migrations.AddConstraint(
            model_name="poitranslation",
            constraint=models.UniqueConstraint(
                fields=("language_code", "slug"),
                name="unique_poi_translation_slug_per_language",
            ),
        ),
    ]
