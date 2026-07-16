from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0014_itineraryisochronejob"),
    ]

    operations = [
        migrations.AddField(
            model_name="itineraryisochrone",
            name="simplify_tolerance_meters",
            field=models.PositiveIntegerField(default=25),
        ),
        migrations.AddField(
            model_name="itineraryisochrone",
            name="smooth_iterations",
            field=models.PositiveSmallIntegerField(default=2),
        ),
        migrations.AddField(
            model_name="itineraryisochronejob",
            name="simplify_tolerance_meters",
            field=models.PositiveIntegerField(default=25),
        ),
        migrations.AddField(
            model_name="itineraryisochronejob",
            name="smooth_iterations",
            field=models.PositiveSmallIntegerField(default=2),
        ),
    ]
