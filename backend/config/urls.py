from django.contrib import admin
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
            },
        }
    )


urlpatterns = [
    path("", home, name="home"),
    path("admin/", admin.site.urls),
    path("api/", include("pois.urls")),
]
