from django.contrib import admin

from .models import (
    Category,
    CategoryTranslation,
    Itinerary,
    ItineraryIsochrone,
    ItineraryIsochroneJob,
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


class POITranslationInline(admin.TabularInline):
    model = POITranslation
    fields = ["language_code", "title", "description", "slug", "is_reference"]
    extra = 1


class POIMediaInline(admin.TabularInline):
    model = POIMedia
    extra = 1


class POIMediaTranslationInline(admin.TabularInline):
    model = POIMediaTranslation
    fields = ["language_code", "caption"]
    extra = 1


@admin.register(POI)
class POIAdmin(admin.ModelAdmin):
    list_display = ["id", "enabled", "country_code", "gps_latitude", "gps_longitude", "website", "phone", "email", "updated_at"]
    list_filter = ["enabled", "country_code", "categories"]
    search_fields = ["translations__title", "translations__slug", "website", "phone", "email"]
    filter_horizontal = ["categories"]
    inlines = [POITranslationInline, POIMediaInline]


class CategoryTranslationInline(admin.TabularInline):
    model = CategoryTranslation
    extra = 1


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["id", "slug", "created_at"]
    search_fields = ["slug", "translations__name"]
    inlines = [CategoryTranslationInline]


@admin.register(POITranslation)
class POITranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "poi", "language_code", "title", "slug", "is_reference"]
    list_filter = ["language_code", "is_reference"]
    search_fields = ["title", "description", "slug"]


@admin.register(CategoryTranslation)
class CategoryTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "category", "language_code", "name"]
    list_filter = ["language_code"]
    search_fields = ["name"]


@admin.register(POIMedia)
class POIMediaAdmin(admin.ModelAdmin):
    list_display = ["id", "poi", "media_type", "position", "is_primary", "url"]
    list_filter = ["media_type", "is_primary"]
    search_fields = ["url", "translations__caption"]
    inlines = [POIMediaTranslationInline]


@admin.register(POIMediaTranslation)
class POIMediaTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "media", "language_code", "caption"]
    list_filter = ["language_code"]
    search_fields = ["caption"]


class ItineraryTranslationInline(admin.TabularInline):
    model = ItineraryTranslation
    fields = ["language_code", "title", "description", "slug", "is_reference"]
    extra = 1


class RouteTranslationInline(admin.TabularInline):
    model = RouteTranslation
    fields = ["language_code", "title", "description", "slug", "is_reference"]
    extra = 1


class RouteMediaInline(admin.TabularInline):
    model = RouteMedia
    extra = 1


class ItineraryMediaInline(admin.TabularInline):
    model = ItineraryMedia
    extra = 1


class RouteMediaTranslationInline(admin.TabularInline):
    model = RouteMediaTranslation
    fields = ["language_code", "caption"]
    extra = 1


class ItineraryMediaTranslationInline(admin.TabularInline):
    model = ItineraryMediaTranslation
    fields = ["language_code", "caption"]
    extra = 1


class RouteStageInline(admin.TabularInline):
    model = RouteStage
    fields = ["stage_number", "itinerary"]
    extra = 0


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    list_display = ["id", "title", "slug", "enabled", "updated_at", "created_at"]
    list_filter = ["enabled"]
    search_fields = ["translations__title", "translations__description", "translations__slug"]
    inlines = [RouteTranslationInline, RouteStageInline, RouteMediaInline]

    @admin.display(description="title")
    def title(self, obj):
        translation = obj.translations.filter(is_reference=True).first() or obj.translations.order_by(
            "language_code"
        ).first()
        return translation.title if translation else ""

    @admin.display(description="slug")
    def slug(self, obj):
        translation = obj.translations.filter(is_reference=True).first() or obj.translations.order_by(
            "language_code"
        ).first()
        return translation.slug if translation else ""


@admin.register(Itinerary)
class ItineraryAdmin(admin.ModelAdmin):
    list_display = ["id", "slug", "route_memberships", "enabled", "updated_at", "created_at"]
    list_filter = ["enabled", "routes"]
    search_fields = ["translations__title", "translations__description", "translations__slug"]
    inlines = [ItineraryTranslationInline, ItineraryMediaInline]

    @admin.display(description="slug")
    def slug(self, obj):
        translation = obj.translations.filter(is_reference=True).first() or obj.translations.order_by(
            "language_code"
        ).first()
        return translation.slug if translation else ""

    @admin.display(description="routes")
    def route_memberships(self, obj):
        return ", ".join(
            f"{stage.route} #{stage.stage_number}"
            for stage in obj.route_stages.select_related("route").order_by("route__id", "stage_number")
        )


@admin.register(ItineraryIsochrone)
class ItineraryIsochroneAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "itinerary",
        "minutes",
        "mode",
        "provider",
        "source_segment_count",
        "sample_distance_meters",
        "simplify_tolerance_meters",
        "smooth_iterations",
        "generated_at",
    ]
    list_filter = ["mode", "minutes", "provider"]
    search_fields = ["itinerary__translations__title", "source_route_hash"]
    readonly_fields = ["generated_at"]


@admin.register(ItineraryIsochroneJob)
class ItineraryIsochroneJobAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "itinerary",
        "status",
        "priority",
        "mode",
        "requested_manually",
        "estimated_request_count",
        "provider_request_count",
        "simplify_tolerance_meters",
        "smooth_iterations",
        "attempts",
        "not_before",
        "updated_at",
    ]
    list_filter = ["status", "priority", "mode", "requested_manually"]
    search_fields = ["itinerary__translations__title", "source_route_hash", "last_error"]
    readonly_fields = ["created_at", "updated_at", "started_at", "completed_at"]


@admin.register(RouteStage)
class RouteStageAdmin(admin.ModelAdmin):
    list_display = ["id", "route", "itinerary", "stage_number", "updated_at", "created_at"]
    list_filter = ["route"]
    search_fields = ["route__translations__title", "itinerary__translations__title"]


@admin.register(RouteMedia)
class RouteMediaAdmin(admin.ModelAdmin):
    list_display = ["id", "route", "media_type", "position", "is_primary", "url"]
    list_filter = ["media_type", "is_primary"]
    search_fields = ["url", "translations__caption", "route__translations__title"]
    inlines = [RouteMediaTranslationInline]


@admin.register(RouteMediaTranslation)
class RouteMediaTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "media", "language_code", "caption"]
    list_filter = ["language_code"]
    search_fields = ["caption"]


@admin.register(ItineraryMedia)
class ItineraryMediaAdmin(admin.ModelAdmin):
    list_display = ["id", "itinerary", "media_type", "position", "is_primary", "url"]
    list_filter = ["media_type", "is_primary"]
    search_fields = ["url", "translations__caption", "itinerary__translations__title"]
    inlines = [ItineraryMediaTranslationInline]


@admin.register(ItineraryMediaTranslation)
class ItineraryMediaTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "media", "language_code", "caption"]
    list_filter = ["language_code"]
    search_fields = ["caption"]


@admin.register(ItineraryTranslation)
class ItineraryTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "itinerary", "language_code", "title", "slug", "is_reference"]
    list_filter = ["language_code", "is_reference"]
    search_fields = ["title", "description", "slug"]


@admin.register(RouteTranslation)
class RouteTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "route", "language_code", "title", "slug", "is_reference"]
    list_filter = ["language_code", "is_reference"]
    search_fields = ["title", "description", "slug"]
