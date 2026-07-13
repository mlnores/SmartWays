from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pois", "0008_poimedia"),
    ]

    operations = [
        migrations.AlterField(
            model_name="poimedia",
            name="url",
            field=models.URLField(blank=True, max_length=1000),
        ),
        migrations.AddField(
            model_name="poimedia",
            name="file",
            field=models.FileField(blank=True, upload_to="poi-media/%Y/%m/"),
        ),
        migrations.AddField(
            model_name="poimedia",
            name="original_filename",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="poimedia",
            name="content_type",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="poimedia",
            name="size",
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
    ]
