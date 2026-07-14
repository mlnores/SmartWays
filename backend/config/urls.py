from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.urls import include, path


def home(_request):
    return JsonResponse(
        {
            "name": "SmartWays POI Backend",
            "api": "/api/",
            "admin": "/admin/",
            "endpoints": {
                "pois": "/api/pois/",
                "poi_translations": "/api/poi-translations/",
                "categories": "/api/categories/",
                "category_translations": "/api/category-translations/",
                "poi_images": "/api/poi-images/",
                "buffer_pois": "/api/buffer-pois/",
                "eccch": "/api/eccch/",
            },
        }
    )


urlpatterns = [
    path("", home, name="home"),
    path("admin/", admin.site.urls),
    path("api/", include("pois.urls")),
    path("api/eccch/", include("eccch_export.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
