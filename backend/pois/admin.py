from django.contrib import admin

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


class POITranslationInline(admin.TabularInline):
    model = POITranslation
    extra = 1


class POIImageInline(admin.TabularInline):
    model = POIImage
    extra = 1


@admin.register(POI)
class POIAdmin(admin.ModelAdmin):
    list_display = ["id", "enabled", "gps_latitude", "gps_longitude", "website", "updated_at"]
    list_filter = ["enabled", "categories"]
    search_fields = ["translations__title", "translations__slug", "website"]
    filter_horizontal = ["categories"]
    inlines = [POITranslationInline, POIImageInline]


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
    list_display = ["id", "poi", "language_code", "title", "slug"]
    list_filter = ["language_code"]
    search_fields = ["title", "description", "slug"]


@admin.register(CategoryTranslation)
class CategoryTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "category", "language_code", "name"]
    list_filter = ["language_code"]
    search_fields = ["name"]


@admin.register(POIImage)
class POIImageAdmin(admin.ModelAdmin):
    list_display = ["id", "poi", "position", "is_primary", "image_url"]
    list_filter = ["is_primary"]
    search_fields = ["image_url"]


class ItineraryTranslationInline(admin.TabularInline):
    model = ItineraryTranslation
    extra = 1


class RouteTranslationInline(admin.TabularInline):
    model = RouteTranslation
    extra = 1


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    list_display = ["id", "title", "slug", "enabled", "updated_at", "created_at"]
    list_filter = ["enabled"]
    search_fields = ["translations__title", "translations__description", "translations__slug"]
    inlines = [RouteTranslationInline]

    @admin.display(description="title")
    def title(self, obj):
        translation = obj.translations.order_by("language_code").first()
        return translation.title if translation else ""

    @admin.display(description="slug")
    def slug(self, obj):
        translation = obj.translations.order_by("language_code").first()
        return translation.slug if translation else ""


@admin.register(Itinerary)
class ItineraryAdmin(admin.ModelAdmin):
    list_display = ["id", "slug", "route", "stage_number", "enabled", "updated_at", "created_at"]
    list_filter = ["enabled", "route"]
    search_fields = ["translations__title", "translations__description", "translations__slug"]
    inlines = [ItineraryTranslationInline]

    @admin.display(description="slug")
    def slug(self, obj):
        translation = obj.translations.order_by("language_code").first()
        return translation.slug if translation else ""


@admin.register(ItineraryTranslation)
class ItineraryTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "itinerary", "language_code", "title", "slug"]
    list_filter = ["language_code"]
    search_fields = ["title", "description", "slug"]


@admin.register(RouteTranslation)
class RouteTranslationAdmin(admin.ModelAdmin):
    list_display = ["id", "route", "language_code", "title", "slug"]
    list_filter = ["language_code"]
    search_fields = ["title", "description", "slug"]
