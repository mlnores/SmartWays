from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0013_itineraryisochrone"),
    ]

    operations = [
        migrations.CreateModel(
            name="ItineraryIsochroneJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("pending", "Pending"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed"), ("skipped", "Skipped"), ("cancelled", "Cancelled")], default="pending", max_length=20)),
                ("priority", models.PositiveSmallIntegerField(choices=[(0, "High"), (50, "Normal"), (100, "Low")], default=50)),
                ("mode", models.CharField(default="foot", max_length=40)),
                ("minutes", models.JSONField(default=list)),
                ("source_route_hash", models.CharField(blank=True, max_length=64)),
                ("sample_distance_meters", models.PositiveIntegerField(default=1000)),
                ("estimated_request_count", models.PositiveIntegerField(default=0)),
                ("provider_request_count", models.PositiveIntegerField(default=0)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("requested_manually", models.BooleanField(default=False)),
                ("last_error", models.TextField(blank=True)),
                ("not_before", models.DateTimeField(default=django.utils.timezone.now)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "itinerary",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="isochrone_jobs",
                        to="pois.itinerary",
                    ),
                ),
            ],
            options={
                "ordering": ["priority", "not_before", "created_at", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="itineraryisochronejob",
            index=models.Index(fields=["status", "priority", "not_before"], name="pois_isojob_queue_idx"),
        ),
        migrations.AddIndex(
            model_name="itineraryisochronejob",
            index=models.Index(fields=["itinerary", "mode"], name="pois_isojob_itin_mode_idx"),
        ),
        migrations.AddIndex(
            model_name="itineraryisochronejob",
            index=models.Index(fields=["source_route_hash"], name="pois_isojob_hash_idx"),
        ),
        migrations.AddIndex(
            model_name="itineraryisochronejob",
            index=models.Index(fields=["completed_at"], name="pois_isojob_done_idx"),
        ),
    ]
