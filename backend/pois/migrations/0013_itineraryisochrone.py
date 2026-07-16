from django.contrib.gis.db import models
from django.db import migrations
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0012_poi_phone_poi_email"),
    ]

    operations = [
        migrations.CreateModel(
            name="ItineraryIsochrone",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("minutes", models.PositiveSmallIntegerField()),
                ("mode", models.CharField(default="foot", max_length=40)),
                ("provider", models.CharField(blank=True, max_length=120)),
                ("geometry", models.MultiPolygonField(srid=4326)),
                ("source_route_hash", models.CharField(max_length=64)),
                ("source_segment_count", models.PositiveIntegerField(default=0)),
                ("sample_distance_meters", models.PositiveIntegerField(default=1000)),
                ("generated_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "itinerary",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="isochrones",
                        to="pois.itinerary",
                    ),
                ),
            ],
            options={
                "ordering": ["itinerary_id", "mode", "minutes"],
            },
        ),
        migrations.AddConstraint(
            model_name="itineraryisochrone",
            constraint=models.UniqueConstraint(
                fields=("itinerary", "mode", "minutes"),
                name="unique_itinerary_isochrone",
            ),
        ),
        migrations.AddIndex(
            model_name="itineraryisochrone",
            index=models.Index(fields=["itinerary", "mode"], name="pois_itiso_itin_mode_idx"),
        ),
        migrations.AddIndex(
            model_name="itineraryisochrone",
            index=models.Index(fields=["minutes"], name="pois_itiso_minutes_idx"),
        ),
        migrations.AddIndex(
            model_name="itineraryisochrone",
            index=models.Index(fields=["source_route_hash"], name="pois_itiniso_hash_972a78_idx"),
        ),
    ]
