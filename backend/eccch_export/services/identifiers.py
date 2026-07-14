from django.conf import settings


def public_base_url(request=None):
    configured = getattr(settings, "SMARTWAYS_PUBLIC_BASE_URL", "").rstrip("/")
    if configured:
        return configured
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return "http://localhost:8000"


def entity_uri(kind, identifier, request=None):
    return f"{public_base_url(request)}/id/{kind}/{identifier}"


def media_uri(kind, identifier, request=None):
    return f"{public_base_url(request)}/id/{kind}-media/{identifier}"


def api_uri(path, request=None):
    path = path if path.startswith("/") else f"/{path}"
    return f"{public_base_url(request)}{path}"

