from django.conf import settings
from django.contrib.gis.geos import Point
from rest_framework import serializers

from .models import Category, CategoryTranslation, POI, POIImage, POITranslation


def select_translation(translations, language_code):
    translations = list(translations)
    if not translations:
        return None

    for translation in translations:
        if translation.language_code == language_code:
            return translation

    for translation in translations:
        if translation.language_code == settings.LANGUAGE_CODE:
            return translation

    return translations[0]


class POITranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = POITranslation
        fields = ["id", "poi", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]


class CategoryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategoryTranslation
        fields = ["id", "category", "language_code", "name"]
        read_only_fields = ["id"]


class NestedCategoryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategoryTranslation
        fields = ["id", "language_code", "name"]
        read_only_fields = ["id"]


class POIImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = POIImage
        fields = ["id", "poi", "image_url", "position", "is_primary"]
        read_only_fields = ["id"]


class NestedPOITranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = POITranslation
        fields = ["id", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]


class NestedPOIImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = POIImage
        fields = ["id", "image_url", "position", "is_primary"]
        read_only_fields = ["id"]


class CategorySerializer(serializers.ModelSerializer):
    translations = NestedCategoryTranslationSerializer(many=True, required=False)
    name = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "slug", "name", "created_at", "translations"]
        read_only_fields = ["id", "created_at"]

    def get_name(self, obj):
        language = self.context.get("language")
        translation = select_translation(obj.translations.all(), language)
        return translation.name if translation else None

    def create(self, validated_data):
        translations = validated_data.pop("translations", [])
        category = Category.objects.create(**validated_data)
        for translation_data in translations:
            CategoryTranslation.objects.create(category=category, **translation_data)
        return category

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        instance.slug = validated_data.get("slug", instance.slug)
        instance.save()

        if translations is not None:
            instance.translations.all().delete()
            for translation_data in translations:
                CategoryTranslation.objects.create(category=instance, **translation_data)

        return instance


class NestedCategorySerializer(CategorySerializer):
    class Meta(CategorySerializer.Meta):
        fields = ["id", "slug", "name", "translations"]


class POISerializer(serializers.ModelSerializer):
    gps_latitude = serializers.FloatField(required=False)
    gps_longitude = serializers.FloatField(required=False)
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    translations = NestedPOITranslationSerializer(many=True, required=False)
    images = NestedPOIImageSerializer(many=True, required=False)
    categories = NestedCategorySerializer(many=True, read_only=True)
    category_ids = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        source="categories",
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = POI
        fields = [
            "id",
            "enabled",
            "gps_latitude",
            "gps_longitude",
            "website",
            "created_at",
            "updated_at",
            "title",
            "description",
            "slug",
            "translations",
            "categories",
            "category_ids",
            "images",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_title(self, obj):
        translation = self._localized_translation(obj)
        return translation.title if translation else None

    def get_description(self, obj):
        translation = self._localized_translation(obj)
        return translation.description if translation else None

    def get_slug(self, obj):
        translation = self._localized_translation(obj)
        return translation.slug if translation else None

    def _localized_translation(self, obj):
        language = self.context.get("language")
        return select_translation(obj.translations.all(), language)

    def validate(self, attrs):
        latitude = attrs.pop("gps_latitude", None)
        longitude = attrs.pop("gps_longitude", None)

        if self.instance is None and (latitude is None or longitude is None):
            raise serializers.ValidationError(
                {"gps_latitude": "This field is required.", "gps_longitude": "This field is required."}
            )

        if latitude is not None or longitude is not None:
            if latitude is None:
                latitude = self.instance.gps_latitude
            if longitude is None:
                longitude = self.instance.gps_longitude

            if not -90 <= latitude <= 90:
                raise serializers.ValidationError({"gps_latitude": "Latitude must be between -90 and 90."})
            if not -180 <= longitude <= 180:
                raise serializers.ValidationError({"gps_longitude": "Longitude must be between -180 and 180."})

            attrs["location"] = Point(longitude, latitude, srid=4326)

        return attrs

    def create(self, validated_data):
        translations = validated_data.pop("translations", [])
        images = validated_data.pop("images", [])
        categories = validated_data.pop("categories", [])
        poi = POI.objects.create(**validated_data)
        poi.categories.set(categories)

        for translation_data in translations:
            POITranslation.objects.create(poi=poi, **translation_data)
        for image_data in images:
            POIImage.objects.create(poi=poi, **image_data)

        return poi

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        images = validated_data.pop("images", None)
        categories = validated_data.pop("categories", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if categories is not None:
            instance.categories.set(categories)
        if translations is not None:
            instance.translations.all().delete()
            for translation_data in translations:
                POITranslation.objects.create(poi=instance, **translation_data)
        if images is not None:
            instance.images.all().delete()
            for image_data in images:
                POIImage.objects.create(poi=instance, **image_data)

        return instance
