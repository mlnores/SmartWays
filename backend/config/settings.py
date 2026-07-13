import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "unsafe-dev-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "rest_framework",
    "pois",
]

if os.environ.get("SMARTWAYS_MEDIA_STORAGE", "local").lower() == "s3":
    INSTALLED_APPS.append("storages")

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASE_ENGINE = os.environ.get("DATABASE_ENGINE", "spatialite").lower()

if DATABASE_ENGINE == "postgis":
    DATABASES = {
        "default": {
            "ENGINE": "django.contrib.gis.db.backends.postgis",
            "NAME": os.environ.get("POSTGRES_DB", "smartways"),
            "USER": os.environ.get("POSTGRES_USER", "smartways"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "smartways"),
            "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.contrib.gis.db.backends.spatialite",
            "NAME": os.environ.get("SQLITE_NAME", BASE_DIR / "db.sqlite3"),
        }
    }

SPATIALITE_LIBRARY_PATH = os.environ.get("SPATIALITE_LIBRARY_PATH")
GDAL_LIBRARY_PATH = os.environ.get("GDAL_LIBRARY_PATH")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = os.environ.get("DJANGO_STATIC_ROOT", BASE_DIR / "staticfiles")
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
MEDIA_URL = os.environ.get("DJANGO_MEDIA_URL", "/media/")
MEDIA_ROOT = os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "media")
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

if os.environ.get("SMARTWAYS_MEDIA_STORAGE", "local").lower() == "s3":
    AWS_STORAGE_BUCKET_NAME = os.environ.get("SMARTWAYS_MEDIA_BUCKET", "smartways-media")
    AWS_S3_ENDPOINT_URL = os.environ.get("SMARTWAYS_MEDIA_ENDPOINT", "")
    AWS_ACCESS_KEY_ID = os.environ.get("SMARTWAYS_MEDIA_ACCESS_KEY", "")
    AWS_SECRET_ACCESS_KEY = os.environ.get("SMARTWAYS_MEDIA_SECRET_KEY", "")
    AWS_S3_REGION_NAME = os.environ.get("SMARTWAYS_MEDIA_REGION", "us-east-1")
    AWS_S3_ADDRESSING_STYLE = os.environ.get("SMARTWAYS_MEDIA_ADDRESSING_STYLE", "path")
    AWS_QUERYSTRING_AUTH = os.environ.get("SMARTWAYS_MEDIA_QUERYSTRING_AUTH", "0") == "1"
    AWS_DEFAULT_ACL = os.environ.get("SMARTWAYS_MEDIA_DEFAULT_ACL", "public-read")
    public_url = os.environ.get("SMARTWAYS_MEDIA_PUBLIC_URL", "").rstrip("/")
    if public_url:
        AWS_S3_CUSTOM_DOMAIN = public_url.replace("https://", "").replace("http://", "")
        AWS_S3_URL_PROTOCOL = "https:" if public_url.startswith("https://") else "http:"
    STORAGES = {
        "default": {
            "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

REST_FRAMEWORK = {
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}
