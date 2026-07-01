from django.contrib import admin

from .models import Category, CategoryTranslation, POI, POIImage, POITranslation


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
