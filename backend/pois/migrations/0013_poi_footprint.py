from django.contrib.gis.db import models as gis_models
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0012_poi_phone_poi_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="poi",
            name="footprint",
            field=gis_models.MultiPolygonField(blank=True, null=True, srid=4326),
        ),
    ]
