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
    POIMedia,
    POITranslation,
    Route,
    RouteStage,
    RouteTranslation,
)


def select_translation(translations, language_code):
    translations = list(translations)
    if not translations:
        return None

    if language_code:
        for translation in translations:
            if translation.language_code == language_code:
                return translation

    for translation in translations:
        if getattr(translation, "is_reference", False):
            return translation

    for translation in translations:
        if translation.language_code == settings.LANGUAGE_CODE:
            return translation

    return translations[0]


def slug_from_title(title):
    return slugify(title or "") or "itinerary"


def unique_poi_slug(language_code, title, slug="", poi=None):
    max_length = POITranslation._meta.get_field("slug").max_length
    base = slugify(slug or title or "") or "poi"
    base = base[:max_length].strip("-_") or "poi"
    candidate = base
    suffix = 2
    queryset = POITranslation.objects.filter(language_code=language_code)
    if poi is not None and poi.pk:
        queryset = queryset.exclude(poi=poi)

    while queryset.filter(slug=candidate).exists():
        suffix_text = f"-{suffix}"
        candidate = f"{base[: max_length - len(suffix_text)]}{suffix_text}".strip("-_")
        suffix += 1

    return candidate


def normalize_reference_translation(translations):
    if translations is None or not translations:
        return

    reference_count = sum(1 for translation in translations if translation.get("is_reference"))
    if reference_count > 1:
        raise serializers.ValidationError(
            {"translations": "Only one translation can be marked as reference."}
        )
    if reference_count == 0:
        translations[0]["is_reference"] = True


class POITranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = POITranslation
        fields = ["id", "poi", "language_code", "title", "description", "slug", "is_reference"]
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


class POIMediaSerializer(serializers.ModelSerializer):
    image_url = serializers.URLField(source="url", required=False)

    class Meta:
        model = POIMedia
        fields = ["id", "poi", "media_type", "url", "image_url", "position", "is_primary"]
        read_only_fields = ["id"]


class NestedPOITranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = POITranslation
        fields = ["id", "language_code", "title", "description", "slug", "is_reference"]
        read_only_fields = ["id"]
        validators = []


class NestedPOIMediaSerializer(serializers.ModelSerializer):
    image_url = serializers.URLField(source="url", required=False)

    class Meta:
        model = POIMedia
        fields = ["id", "media_type", "url", "image_url", "position", "is_primary"]
        read_only_fields = ["id"]


class NestedPOIImageSerializer(NestedPOIMediaSerializer):
    class Meta(NestedPOIMediaSerializer.Meta):
        fields = ["id", "image_url", "position", "is_primary"]


class ItineraryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryTranslation
        fields = ["id", "itinerary", "language_code", "title", "description", "slug", "is_reference"]
        read_only_fields = ["id"]


class NestedItineraryTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryTranslation
        fields = ["id", "language_code", "title", "description", "slug", "is_reference"]
        read_only_fields = ["id"]


class RouteTranslationSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = RouteTranslation
        fields = ["id", "route", "language_code", "title", "description", "slug", "is_reference"]
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
        fields = ["id", "language_code", "title", "description", "slug", "is_reference"]
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
    country_code = serializers.CharField(required=False, allow_blank=True, max_length=2)
    gps_latitude = serializers.FloatField(required=False)
    gps_longitude = serializers.FloatField(required=False)
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    translations = NestedPOITranslationSerializer(many=True, required=False)
    media = NestedPOIMediaSerializer(many=True, required=False)
    images = NestedPOIImageSerializer(source="media", many=True, required=False)
    itinerary_inclusions = serializers.SerializerMethodField()
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
            "country_code",
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
            "media",
            "images",
            "itinerary_inclusions",
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

    def get_itinerary_inclusions(self, obj):
        inclusion_map = self.context.get("poi_itinerary_inclusions")
        if inclusion_map is None:
            inclusion_map = self._build_poi_itinerary_inclusions()
            self.context["poi_itinerary_inclusions"] = inclusion_map
        return inclusion_map.get(obj.id, [])

    def _localized_translation(self, obj):
        language = self.context.get("language")
        return select_translation(obj.translations.all(), language)

    def _build_poi_itinerary_inclusions(self):
        inclusions = {}
        language = self.context.get("language")
        itineraries = Itinerary.objects.prefetch_related("translations", "route_stages", "route_stages__route", "route_stages__route__translations")
        for itinerary in itineraries:
            points = (itinerary.itinerary_json or {}).get("points") or []
            poi_ids = []
            seen = set()
            for point in points:
                if not isinstance(point, dict) or point.get("type") != "poi":
                    continue
                try:
                    poi_id = int(point.get("id"))
                except (TypeError, ValueError):
                    continue
                if poi_id in seen:
                    continue
                seen.add(poi_id)
                poi_ids.append(poi_id)
            if not poi_ids:
                continue
            translation = select_translation(itinerary.translations.all(), language)
            stages = list(getattr(itinerary, "_prefetched_objects_cache", {}).get("route_stages", []))
            stage = stages[0] if stages else None
            route_translation = select_translation(stage.route.translations.all(), language) if stage else None
            inclusion = {
                "itinerary": itinerary.id,
                "itinerary_title": translation.title if translation else None,
                "route": stage.route_id if stage else None,
                "route_title": route_translation.title if route_translation else None,
                "stage_number": stage.stage_number if stage else None,
            }
            for poi_id in poi_ids:
                inclusions.setdefault(poi_id, []).append(inclusion)
        return inclusions

    def validate(self, attrs):
        latitude = attrs.pop("gps_latitude", None)
        longitude = attrs.pop("gps_longitude", None)
        normalize_reference_translation(attrs.get("translations"))
        if "country_code" in attrs:
            attrs["country_code"] = (attrs.get("country_code") or "").upper()
            if attrs["country_code"] and (len(attrs["country_code"]) != 2 or not attrs["country_code"].isalpha()):
                raise serializers.ValidationError(
                    {"country_code": "Use a two-letter ISO 3166-1 alpha-2 country code."}
                )
        translations = attrs.get("translations")
        if translations is not None:
            for translation in translations:
                title = (translation.get("title") or "").strip()
                if not title:
                    raise serializers.ValidationError({"translations": "Each POI translation needs a title."})
                translation["title"] = title
                translation["slug"] = unique_poi_slug(
                    translation.get("language_code"),
                    title,
                    translation.get("slug"),
                    self.instance,
                )

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
        media = validated_data.pop("media", None)
        images = validated_data.pop("images", None)
        categories = validated_data.pop("categories", [])
        poi = POI.objects.create(**validated_data)
        poi.categories.set(categories)

        for translation_data in translations:
            POITranslation.objects.create(poi=poi, **translation_data)
        for media_data in self._media_payload(media, images):
            POIMedia.objects.create(poi=poi, **media_data)

        return poi

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        media = validated_data.pop("media", None)
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
        if media is not None or images is not None:
            instance.media.all().delete()
            for media_data in self._media_payload(media, images):
                POIMedia.objects.create(poi=instance, **media_data)

        return instance

    def _media_payload(self, media, images):
        payload = media if media is not None else images or []
        for item in payload:
            item.setdefault("media_type", POIMedia.MediaType.IMAGE)
        return payload


class ItinerarySerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    route = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    route_title = serializers.SerializerMethodField()
    route_slug = serializers.SerializerMethodField()
    stage_number = serializers.SerializerMethodField()
    route_memberships = serializers.SerializerMethodField()
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
            "route_memberships",
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
        stage = self._stage_membership(obj)
        if not stage:
            return None
        translation = select_translation(stage.route.translations.all(), self.context.get("language"))
        return translation.title if translation else None

    def get_route_slug(self, obj):
        stage = self._stage_membership(obj)
        if not stage:
            return None
        translation = select_translation(stage.route.translations.all(), self.context.get("language"))
        return translation.slug if translation else None

    def get_stage_number(self, obj):
        stage = self._stage_membership(obj)
        return stage.stage_number if stage else None

    def get_route_memberships(self, obj):
        memberships = []
        for stage in self._stage_memberships(obj):
            translation = select_translation(stage.route.translations.all(), self.context.get("language"))
            memberships.append({
                "route": stage.route_id,
                "route_title": translation.title if translation else None,
                "route_slug": translation.slug if translation else None,
                "stage_number": stage.stage_number,
            })
        return memberships

    def to_representation(self, instance):
        data = super().to_representation(instance)
        stage = self._stage_membership(instance)
        data["route"] = stage.route_id if stage else None
        return data

    def _localized_translation(self, obj):
        language = self.context.get("language")
        return select_translation(obj.translations.all(), language)

    def _stage_membership(self, obj):
        route_id = self.context.get("route_id")
        stages = self._stage_memberships(obj)
        if route_id:
            for stage in stages:
                if stage.route_id == route_id:
                    return stage
        return stages[0] if stages else None

    def _stage_memberships(self, obj):
        stages = list(getattr(obj, "_prefetched_objects_cache", {}).get("route_stages", []))
        if not stages:
            stages = list(
                obj.route_stages
                .select_related("route")
                .prefetch_related("route__translations")
                .order_by("route_id", "stage_number", "id")
            )
        return sorted(stages, key=lambda stage: (stage.route_id, stage.stage_number, stage.id))

    def validate(self, attrs):
        if not isinstance(attrs.get("itinerary_json", self.instance.itinerary_json if self.instance else None), dict):
            raise serializers.ValidationError({"itinerary_json": "Expected an itinerary JSON object."})

        route_id = attrs.get("route", serializers.empty)
        stage_number = self.initial_data.get("stage_number", serializers.empty)
        if route_id is not serializers.empty and route_id is not None and stage_number is serializers.empty:
            raise serializers.ValidationError({"stage_number": "Stage number is required when an itinerary belongs to a route."})
        if route_id is not serializers.empty and route_id is None and stage_number not in {serializers.empty, None}:
            raise serializers.ValidationError({"route": "Route is required when a stage number is set."})
        if route_id is not serializers.empty and route_id is not None:
            if not isinstance(route_id, int):
                raise serializers.ValidationError({"route": "Route must be an integer id or null."})
            if not Route.objects.filter(id=route_id).exists():
                raise serializers.ValidationError({"route": "Route does not exist."})
            if not isinstance(stage_number, int) or stage_number < 1:
                raise serializers.ValidationError({"stage_number": "Stage number must be a positive integer."})

        translations = attrs.get("translations")
        if self.instance is None and not translations:
            raise serializers.ValidationError({"translations": "At least one itinerary translation is required."})
        if translations is not None:
            normalize_reference_translation(translations)
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
        route_id = validated_data.pop("route", None)
        stage_number = self.initial_data.get("stage_number")
        itinerary = Itinerary.objects.create(**validated_data)
        for translation_data in translations:
            ItineraryTranslation.objects.create(itinerary=itinerary, **translation_data)
        if route_id is not None:
            RouteStage.objects.create(route_id=route_id, itinerary=itinerary, stage_number=stage_number)
        return itinerary

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        route_id = validated_data.pop("route", serializers.empty)
        stage_number = self.initial_data.get("stage_number", serializers.empty)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if route_id is not serializers.empty:
            instance.route_stages.all().delete()
            if route_id is not None:
                RouteStage.objects.create(route_id=route_id, itinerary=instance, stage_number=stage_number)

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
            normalize_reference_translation(translations)
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
