from django.conf import settings
from django.contrib.gis.geos import Point
from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryTranslation,
    POI,
    POIImage,
    POITranslation,
    Route,
    RouteTranslation,
)


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


def slug_from_title(title):
    return slugify(title or "") or "itinerary"


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


class ItineraryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryTranslation
        fields = ["id", "itinerary", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]


class NestedItineraryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryTranslation
        fields = ["id", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]


class RouteTranslationSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = RouteTranslation
        fields = ["id", "route", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]
        validators = []

    def validate(self, attrs):
        title = (attrs.get("title") or "").strip()
        if not title:
            raise serializers.ValidationError({"title": "This field may not be blank."})
        attrs["title"] = title
        if not attrs.get("slug"):
            attrs["slug"] = slug_from_title(title)
        return attrs


class NestedRouteTranslationSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = RouteTranslation
        fields = ["id", "language_code", "title", "description", "slug"]
        read_only_fields = ["id"]
        validators = []


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


class ItinerarySerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    route_title = serializers.SerializerMethodField()
    route_slug = serializers.SerializerMethodField()
    translations = NestedItineraryTranslationSerializer(many=True, required=False)

    class Meta:
        model = Itinerary
        fields = [
            "id",
            "enabled",
            "route",
            "route_title",
            "route_slug",
            "stage_number",
            "itinerary_json",
            "created_at",
            "updated_at",
            "title",
            "description",
            "slug",
            "translations",
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

    def get_route_title(self, obj):
        if not obj.route_id:
            return None
        translation = select_translation(obj.route.translations.all(), self.context.get("language"))
        return translation.title if translation else None

    def get_route_slug(self, obj):
        if not obj.route_id:
            return None
        translation = select_translation(obj.route.translations.all(), self.context.get("language"))
        return translation.slug if translation else None

    def _localized_translation(self, obj):
        language = self.context.get("language")
        return select_translation(obj.translations.all(), language)

    def validate(self, attrs):
        if not isinstance(attrs.get("itinerary_json", self.instance.itinerary_json if self.instance else None), dict):
            raise serializers.ValidationError({"itinerary_json": "Expected an itinerary JSON object."})

        route = attrs.get("route", self.instance.route if self.instance else None)
        stage_number = attrs.get("stage_number", self.instance.stage_number if self.instance else None)
        if route is not None and stage_number is None:
            raise serializers.ValidationError({"stage_number": "Stage number is required when an itinerary belongs to a route."})
        if route is None and stage_number is not None:
            raise serializers.ValidationError({"route": "Route is required when a stage number is set."})

        translations = attrs.get("translations")
        if self.instance is None and not translations:
            raise serializers.ValidationError({"translations": "At least one itinerary translation is required."})
        if translations is not None:
            for translation in translations:
                title = (translation.get("title") or "").strip()
                if not title:
                    raise serializers.ValidationError({"translations": "Each itinerary translation needs a title."})
                translation["title"] = title
                if not translation.get("slug"):
                    translation["slug"] = slug_from_title(title)

        return attrs

    def create(self, validated_data):
        translations = validated_data.pop("translations", [])
        itinerary = Itinerary.objects.create(**validated_data)
        for translation_data in translations:
            ItineraryTranslation.objects.create(itinerary=itinerary, **translation_data)
        return itinerary

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if translations is not None:
            instance.translations.all().delete()
            for translation_data in translations:
                ItineraryTranslation.objects.create(itinerary=instance, **translation_data)

        return instance


class RouteSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    itinerary_count = serializers.SerializerMethodField()
    translations = NestedRouteTranslationSerializer(many=True, required=False)

    class Meta:
        model = Route
        fields = [
            "id",
            "enabled",
            "created_at",
            "updated_at",
            "title",
            "description",
            "slug",
            "itinerary_count",
            "translations",
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

    def get_itinerary_count(self, obj):
        return obj.itineraries.count()

    def _localized_translation(self, obj):
        language = self.context.get("language")
        return select_translation(obj.translations.all(), language)

    def validate(self, attrs):
        translations = attrs.get("translations")
        if self.instance is None and not translations:
            raise serializers.ValidationError({"translations": "At least one route translation is required."})
        if translations is not None:
            for translation in translations:
                title = (translation.get("title") or "").strip()
                if not title:
                    raise serializers.ValidationError({"translations": "Each route translation needs a title."})
                translation["title"] = title
                if not translation.get("slug"):
                    translation["slug"] = slug_from_title(title)

        return attrs

    def create(self, validated_data):
        translations = validated_data.pop("translations", [])
        route = Route.objects.create(**validated_data)
        for translation_data in translations:
            RouteTranslation.objects.create(route=route, **translation_data)
        return route

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if translations is not None:
            instance.translations.all().delete()
            for translation_data in translations:
                RouteTranslation.objects.create(route=instance, **translation_data)

        return instance
