import django.contrib.gis.db.models.fields
import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pois", "0014_festcategory_fest_festcategorytranslation_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="CountryBoundary",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "country_code",
                    models.CharField(
                        max_length=2,
                        validators=[
                            django.core.validators.RegexValidator(
                                message="Use ISO 3166-1 alpha-2 country codes like 'ES', 'PT', or 'FR'.",
                                regex="^[A-Z]{2}$",
                            )
                        ],
                    ),
                ),
                ("name", models.CharField(blank=True, max_length=255)),
                ("geometry", django.contrib.gis.db.models.fields.PolygonField(srid=4326)),
            ],
            options={
                "verbose_name_plural": "country boundaries",
                "ordering": ["country_code", "id"],
                "indexes": [models.Index(fields=["country_code"], name="pois_country_code_idx")],
            },
        ),
    ]
