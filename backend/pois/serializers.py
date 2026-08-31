import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Point
from django.contrib.gis.geos.error import GEOSException
from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryMedia,
    ItineraryMediaTranslation,
    ItineraryTranslation,
    POI,
    POIMedia,
    POIMediaTranslation,
    POITranslation,
    Route,
    RouteMedia,
    RouteMediaTranslation,
    RouteStage,
    RouteTranslation,
)


ADMIN_GROUP_NAME = "Admins"
EDITOR_GROUP_NAME = "Editors"


def user_role(user):
    if user.is_superuser or user.is_staff or user.groups.filter(name=ADMIN_GROUP_NAME).exists():
        return "admin"
    return "editor"


def apply_user_role(user, role):
    admins, _ = Group.objects.get_or_create(name=ADMIN_GROUP_NAME)
    editors, _ = Group.objects.get_or_create(name=EDITOR_GROUP_NAME)
    user.groups.remove(admins, editors)
    if role == "admin":
        user.is_staff = True
        user.groups.add(admins)
    else:
        user.is_staff = False
        user.groups.add(editors)


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


def geometry_as_geojson(geometry):
    if not geometry:
        return None
    return json.loads(geometry.geojson)


def validate_geojson_position(position):
    if not isinstance(position, (list, tuple)) or len(position) < 2:
        raise serializers.ValidationError("Each footprint coordinate must be a [longitude, latitude] position.")
    try:
        longitude = float(position[0])
        latitude = float(position[1])
    except (TypeError, ValueError):
        raise serializers.ValidationError("Footprint coordinates must be numeric.")
    if not -180 <= longitude <= 180:
        raise serializers.ValidationError("Footprint longitude values must be between -180 and 180.")
    if not -90 <= latitude <= 90:
        raise serializers.ValidationError("Footprint latitude values must be between -90 and 90.")


def validate_geojson_positions(value):
    if not isinstance(value, list):
        raise serializers.ValidationError("Footprint coordinates must be arrays.")
    if value and isinstance(value[0], (int, float)):
        validate_geojson_position(value)
        return
    for child in value:
        validate_geojson_positions(child)


def footprint_from_geojson(value):
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise serializers.ValidationError("Footprint must be a GeoJSON Polygon or MultiPolygon.")

    geometry = value.get("geometry") if value.get("type") == "Feature" else value
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise serializers.ValidationError("Footprint must be a GeoJSON Polygon or MultiPolygon.")
    validate_geojson_positions(geometry.get("coordinates"))

    try:
        footprint = GEOSGeometry(json.dumps(geometry), srid=4326)
    except (GEOSException, TypeError, ValueError) as error:
        raise serializers.ValidationError(f"Footprint is not valid GeoJSON: {error}")

    if footprint.empty:
        raise serializers.ValidationError("Footprint must not be empty.")
    if footprint.geom_type == "Polygon":
        footprint = MultiPolygon(footprint, srid=4326)
    if footprint.geom_type != "MultiPolygon":
        raise serializers.ValidationError("Footprint must be a Polygon or MultiPolygon.")
    if not footprint.valid:
        raise serializers.ValidationError(f"Footprint geometry is invalid: {footprint.valid_reason}.")
    return footprint


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


class UserSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=["admin", "editor"], required=False)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "email", "role", "is_active", "password"]
        read_only_fields = ["id"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["role"] = user_role(instance)
        return data

    def create(self, validated_data):
        role = validated_data.pop("role", "editor")
        password = validated_data.pop("password", "")
        user = get_user_model()(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        apply_user_role(user, role)
        user.save(update_fields=["is_staff"])
        return user

    def update(self, instance, validated_data):
        role = validated_data.pop("role", None)
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        if role:
            apply_user_role(instance, role)
        instance.save()
        return instance


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


class POIMediaTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = POIMediaTranslation
        fields = ["id", "language_code", "caption"]
        read_only_fields = ["id"]


def sync_media_translations(media, translations, translation_model=POIMediaTranslation):
    if translations is None:
        return
    media.translations.all().delete()
    for translation in translations:
        language_code = (translation.get("language_code") or "").strip()
        caption = (translation.get("caption") or "").strip()
        if language_code and caption:
            translation_model.objects.create(
                media=media,
                language_code=language_code,
                caption=caption,
            )


class POIMediaSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    translations = POIMediaTranslationSerializer(many=True, required=False)

    class Meta:
        model = POIMedia
        fields = [
            "id",
            "poi",
            "media_type",
            "url",
            "file",
            "file_url",
            "image_url",
            "original_filename",
            "content_type",
            "size",
            "position",
            "is_primary",
            "translations",
        ]
        read_only_fields = ["id", "file_url", "image_url", "original_filename", "content_type", "size"]
        extra_kwargs = {
            "url": {"required": False, "allow_blank": True},
            "file": {"required": False, "write_only": True},
        }

    def to_internal_value(self, data):
        mutable = data.copy() if hasattr(data, "copy") else dict(data)
        translations = mutable.get("translations")
        if isinstance(translations, str):
            try:
                mutable["translations"] = json.loads(translations)
            except json.JSONDecodeError:
                raise serializers.ValidationError({"translations": "Expected valid JSON."})
        return super().to_internal_value(mutable)

    def get_file_url(self, obj):
        return obj.public_url

    def get_image_url(self, obj):
        return obj.public_url

    def validate(self, attrs):
        if not attrs.get("url") and not attrs.get("file") and self.instance is None:
            raise serializers.ValidationError({"file": "Upload a file or provide a URL."})
        return attrs

    def _apply_file_metadata(self, instance, uploaded_file):
        if not uploaded_file:
            return
        instance.original_filename = uploaded_file.name[:255]
        instance.content_type = getattr(uploaded_file, "content_type", "")[:120]
        instance.size = getattr(uploaded_file, "size", None)

    def _translations_from_initial_data(self, translations):
        if translations is not None:
            return translations
        raw = getattr(self, "initial_data", {}).get("translations") if hasattr(self, "initial_data") else None
        if not isinstance(raw, str):
            return translations
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            raise serializers.ValidationError({"translations": "Expected valid JSON."})
        if not isinstance(parsed, list):
            raise serializers.ValidationError({"translations": "Expected a list."})
        return parsed

    def create(self, validated_data):
        translations = validated_data.pop("translations", None)
        translations = self._translations_from_initial_data(translations)
        uploaded_file = validated_data.get("file")
        instance = super().create(validated_data)
        self._apply_file_metadata(instance, uploaded_file)
        if uploaded_file:
            instance.save(update_fields=["original_filename", "content_type", "size"])
        sync_media_translations(instance, translations)
        return instance

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        translations = self._translations_from_initial_data(translations)
        uploaded_file = validated_data.get("file")
        instance = super().update(instance, validated_data)
        self._apply_file_metadata(instance, uploaded_file)
        if uploaded_file:
            instance.save(update_fields=["original_filename", "content_type", "size"])
        sync_media_translations(instance, translations)
        return instance


class NestedPOITranslationSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = POITranslation
        fields = ["id", "language_code", "title", "description", "slug", "is_reference"]
        read_only_fields = ["id"]
        validators = []


class NestedPOIMediaSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    file_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    translations = POIMediaTranslationSerializer(many=True, required=False)

    class Meta:
        model = POIMedia
        fields = [
            "id",
            "media_type",
            "url",
            "file_url",
            "image_url",
            "original_filename",
            "content_type",
            "size",
            "position",
            "is_primary",
            "translations",
        ]
        read_only_fields = ["file_url", "image_url", "original_filename", "content_type", "size"]
        extra_kwargs = {
            "url": {"required": False, "allow_blank": True},
        }

    def get_file_url(self, obj):
        return obj.public_url

    def get_image_url(self, obj):
        return obj.public_url


class NestedPOIImageSerializer(NestedPOIMediaSerializer):
    class Meta(NestedPOIMediaSerializer.Meta):
        fields = ["id", "image_url", "position", "is_primary"]


class RouteMediaTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteMediaTranslation
        fields = ["id", "language_code", "caption"]
        read_only_fields = ["id"]


class ItineraryMediaTranslationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryMediaTranslation
        fields = ["id", "language_code", "caption"]
        read_only_fields = ["id"]


class ParentMediaSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        fields = [
            "id",
            "media_type",
            "url",
            "file",
            "file_url",
            "image_url",
            "original_filename",
            "content_type",
            "size",
            "position",
            "is_primary",
            "translations",
        ]
        read_only_fields = ["id", "file_url", "image_url", "original_filename", "content_type", "size"]
        extra_kwargs = {
            "url": {"required": False, "allow_blank": True},
            "file": {"required": False, "write_only": True},
        }

    def to_internal_value(self, data):
        mutable = data.copy() if hasattr(data, "copy") else dict(data)
        translations = mutable.get("translations")
        if isinstance(translations, str):
            try:
                mutable["translations"] = json.loads(translations)
            except json.JSONDecodeError:
                raise serializers.ValidationError({"translations": "Expected valid JSON."})
        return super().to_internal_value(mutable)

    def get_file_url(self, obj):
        return obj.public_url

    def get_image_url(self, obj):
        return obj.public_url

    def validate(self, attrs):
        if not attrs.get("url") and not attrs.get("file") and self.instance is None:
            raise serializers.ValidationError({"file": "Upload a file or provide a URL."})
        return attrs

    def _apply_file_metadata(self, instance, uploaded_file):
        if not uploaded_file:
            return
        instance.original_filename = uploaded_file.name[:255]
        instance.content_type = getattr(uploaded_file, "content_type", "")[:120]
        instance.size = getattr(uploaded_file, "size", None)

    def _translations_from_initial_data(self, translations):
        if translations is not None:
            return translations
        raw = getattr(self, "initial_data", {}).get("translations") if hasattr(self, "initial_data") else None
        if not isinstance(raw, str):
            return translations
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            raise serializers.ValidationError({"translations": "Expected valid JSON."})
        if not isinstance(parsed, list):
            raise serializers.ValidationError({"translations": "Expected a list."})
        return parsed

    def create(self, validated_data):
        translations = self._translations_from_initial_data(validated_data.pop("translations", None))
        uploaded_file = validated_data.get("file")
        instance = super().create(validated_data)
        self._apply_file_metadata(instance, uploaded_file)
        if uploaded_file:
            instance.save(update_fields=["original_filename", "content_type", "size"])
        sync_media_translations(instance, translations, self.translation_model)
        return instance

    def update(self, instance, validated_data):
        translations = self._translations_from_initial_data(validated_data.pop("translations", None))
        uploaded_file = validated_data.get("file")
        instance = super().update(instance, validated_data)
        self._apply_file_metadata(instance, uploaded_file)
        if uploaded_file:
            instance.save(update_fields=["original_filename", "content_type", "size"])
        sync_media_translations(instance, translations, self.translation_model)
        return instance


class RouteMediaSerializer(ParentMediaSerializer):
    translations = RouteMediaTranslationSerializer(many=True, required=False)

    class Meta(ParentMediaSerializer.Meta):
        model = RouteMedia
        fields = [
            "id",
            "route",
            "media_type",
            "url",
            "file",
            "file_url",
            "image_url",
            "original_filename",
            "content_type",
            "size",
            "position",
            "is_primary",
            "translations",
        ]

    translation_model = RouteMediaTranslation


class NestedRouteMediaSerializer(RouteMediaSerializer):
    class Meta(RouteMediaSerializer.Meta):
        fields = ParentMediaSerializer.Meta.fields


class ItineraryMediaSerializer(ParentMediaSerializer):
    translations = ItineraryMediaTranslationSerializer(many=True, required=False)

    class Meta(ParentMediaSerializer.Meta):
        model = ItineraryMedia
        fields = [
            "id",
            "itinerary",
            "media_type",
            "url",
            "file",
            "file_url",
            "image_url",
            "original_filename",
            "content_type",
            "size",
            "position",
            "is_primary",
            "translations",
        ]

    translation_model = ItineraryMediaTranslation


class NestedItineraryMediaSerializer(ItineraryMediaSerializer):
    class Meta(ItineraryMediaSerializer.Meta):
        fields = ParentMediaSerializer.Meta.fields


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
    poi_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "slug", "name", "poi_count", "created_at", "translations"]
        read_only_fields = ["id", "created_at"]

    def get_name(self, obj):
        language = self.context.get("language")
        translation = select_translation(obj.translations.all(), language)
        return translation.name if translation else None

    def get_poi_count(self, obj):
        if hasattr(obj, "poi_count"):
            return obj.poi_count
        return obj.pois.count()

    def validate(self, attrs):
        slug = attrs.get("slug", self.instance.slug if self.instance else "")
        if slug:
            queryset = Category.objects.filter(slug=slug)
            if self.instance is not None:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError({"slug": "A category with this slug already exists."})

        translations = attrs.get("translations")
        if translations is not None:
            language_codes = [translation.get("language_code") for translation in translations]
            if len(language_codes) != len(set(language_codes)):
                raise serializers.ValidationError({"translations": "Each language can appear only once."})

        return attrs

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
    footprint = serializers.JSONField(required=False, allow_null=True)
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
            "footprint",
            "website",
            "phone",
            "email",
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

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["footprint"] = geometry_as_geojson(instance.footprint)
        return data

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
            for raw_poi_id in (itinerary.itinerary_json or {}).get("poiIds") or []:
                try:
                    poi_id = int(raw_poi_id)
                except (TypeError, ValueError):
                    continue
                if poi_id in seen:
                    continue
                seen.add(poi_id)
                poi_ids.append(poi_id)
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
        if "footprint" in attrs:
            try:
                attrs["footprint"] = footprint_from_geojson(attrs["footprint"])
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"footprint": error.detail})
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
            media_translations = media_data.pop("translations", None)
            poi_media = POIMedia.objects.create(poi=poi, **media_data)
            sync_media_translations(poi_media, media_translations)

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
            self._sync_media(instance, self._media_payload(media, images))

        return instance

    def _media_payload(self, media, images):
        payload = media if media is not None else images or []
        for item in payload:
            item.setdefault("media_type", POIMedia.MediaType.IMAGE)
        return payload

    def _sync_media(self, poi, media_payload):
        kept_ids = set()
        existing = {item.id: item for item in poi.media.all()}
        if any(media_data.get("is_primary") for media_data in media_payload):
            poi.media.filter(is_primary=True).update(is_primary=False)
        for media_data in media_payload:
            media_id = media_data.pop("id", None)
            translations = media_data.pop("translations", None)
            if media_id and media_id in existing:
                media = existing[media_id]
                for field, value in media_data.items():
                    setattr(media, field, value)
                media.save()
                sync_media_translations(media, translations)
                kept_ids.add(media.id)
            else:
                media = POIMedia.objects.create(poi=poi, **media_data)
                sync_media_translations(media, translations)
                kept_ids.add(media.id)

        poi.media.exclude(id__in=kept_ids).delete()


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
    media = NestedItineraryMediaSerializer(many=True, required=False)

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
            "media",
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
            route = Route.objects.filter(id=route_id).first()
            if route is None:
                raise serializers.ValidationError({"route": "Route does not exist."})
            if route.enabled:
                raise serializers.ValidationError({"route": "Public routes cannot be edited. Add or remove itineraries only while a route is a draft."})
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
        media = validated_data.pop("media", [])
        route_id = validated_data.pop("route", None)
        stage_number = self.initial_data.get("stage_number")
        itinerary = Itinerary.objects.create(**validated_data)
        for translation_data in translations:
            ItineraryTranslation.objects.create(itinerary=itinerary, **translation_data)
        self._sync_media(itinerary, media)
        if route_id is not None:
            RouteStage.objects.create(route_id=route_id, itinerary=itinerary, stage_number=stage_number)
        return itinerary

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        media = validated_data.pop("media", None)
        route_id = validated_data.pop("route", serializers.empty)
        stage_number = self.initial_data.get("stage_number", serializers.empty)

        if route_id is not serializers.empty:
            existing_stages = list(instance.route_stages.select_related("route"))
            public_routes = [stage.route for stage in existing_stages if stage.route.enabled]
            if public_routes:
                raise serializers.ValidationError({"route": "Public route memberships cannot be edited."})
            if route_id is not None:
                route = Route.objects.filter(id=route_id).first()
                if route and route.enabled:
                    raise serializers.ValidationError({"route": "Public routes cannot be edited. Add or remove itineraries only while a route is a draft."})

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
        if media is not None:
            self._sync_media(instance, media)

        return instance

    def _sync_media(self, itinerary, media_payload):
        kept_ids = set()
        existing = {item.id: item for item in itinerary.media.all()}
        if any(media_data.get("is_primary") for media_data in media_payload):
            itinerary.media.filter(is_primary=True).update(is_primary=False)
        for media_data in media_payload:
            media_id = media_data.pop("id", None)
            translations = media_data.pop("translations", None)
            if media_id and media_id in existing:
                media = existing[media_id]
                for field, value in media_data.items():
                    setattr(media, field, value)
                media.save()
                sync_media_translations(media, translations, ItineraryMediaTranslation)
                kept_ids.add(media.id)
            else:
                media = ItineraryMedia.objects.create(itinerary=itinerary, **media_data)
                sync_media_translations(media, translations, ItineraryMediaTranslation)
                kept_ids.add(media.id)
        itinerary.media.exclude(id__in=kept_ids).delete()


class RouteSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    slug = serializers.SerializerMethodField()
    itinerary_count = serializers.SerializerMethodField()
    translations = NestedRouteTranslationSerializer(many=True, required=False)
    media = NestedRouteMediaSerializer(many=True, required=False)

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
            "media",
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
        media = validated_data.pop("media", [])
        route = Route.objects.create(**validated_data)
        for translation_data in translations:
            RouteTranslation.objects.create(route=route, **translation_data)
        self._sync_media(route, media)
        return route

    def update(self, instance, validated_data):
        translations = validated_data.pop("translations", None)
        media = validated_data.pop("media", None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if translations is not None:
            instance.translations.all().delete()
            for translation_data in translations:
                RouteTranslation.objects.create(route=instance, **translation_data)
        if media is not None:
            self._sync_media(instance, media)

        return instance

    def _sync_media(self, route, media_payload):
        kept_ids = set()
        existing = {item.id: item for item in route.media.all()}
        if any(media_data.get("is_primary") for media_data in media_payload):
            route.media.filter(is_primary=True).update(is_primary=False)
        for media_data in media_payload:
            media_id = media_data.pop("id", None)
            translations = media_data.pop("translations", None)
            if media_id and media_id in existing:
                media = existing[media_id]
                for field, value in media_data.items():
                    setattr(media, field, value)
                media.save()
                sync_media_translations(media, translations, RouteMediaTranslation)
                kept_ids.add(media.id)
            else:
                media = RouteMedia.objects.create(route=route, **media_data)
                sync_media_translations(media, translations, RouteMediaTranslation)
                kept_ids.add(media.id)
        route.media.exclude(id__in=kept_ids).delete()
