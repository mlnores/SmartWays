from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from pois.views import poi_browser


def home(_request):
    return JsonResponse(
        {
            "name": "SmartWays POI Backend",
            "api": "/api/",
            "admin": "/admin/",
            "poi_browser": "/pois/",
            "endpoints": {
                "pois": "/api/pois/",
                "poi_translations": "/api/poi-translations/",
                "categories": "/api/categories/",
                "category_translations": "/api/category-translations/",
                "poi_images": "/api/poi-images/",
                "buffer_pois": "/api/buffer-pois/",
            },
        }
    )


urlpatterns = [
    path("", home, name="home"),
    path("pois/", poi_browser, name="poi-browser"),
    path("admin/", admin.site.urls),
    path("api/", include("pois.urls")),
]
