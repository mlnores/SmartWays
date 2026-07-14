from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0011_itinerarymedia_itinerarymediatranslation_routemedia_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="poi",
            name="phone",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="poi",
            name="email",
            field=models.EmailField(blank=True, max_length=254),
        ),
    ]
