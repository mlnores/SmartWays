from pois.serializers import select_translation

from eccch_export.models import SemanticAnnotation, VocabularyMapping


def translations_as_language_map(translations, field):
    values = []
    for translation in translations.all():
        value = getattr(translation, field, "")
        if value:
            values.append({"@value": value, "@language": translation.language_code})
    return values


def reference_translation(obj):
    return select_translation(obj.translations.all(), None)


def mapping_terms(source_type, source_id):
    terms = []
    for mapping in VocabularyMapping.objects.filter(source_type=source_type, source_id=source_id):
        terms.append(
            {
                "@id": mapping.target_uri,
                "skos:prefLabel": mapping.target_label,
                "skos:mappingRelation": mapping.relation,
                "smartways:confidence": mapping.confidence,
                "smartways:reviewed": mapping.reviewed,
                "smartways:vocabulary": mapping.vocabulary,
            }
        )
    return terms


def annotations_for(source_type, source_id, accepted_only=True):
    queryset = SemanticAnnotation.objects.filter(subject_type=source_type, subject_id=source_id)
    if accepted_only:
        queryset = queryset.filter(review_status="accepted")
    return [
        {
            "smartways:predicate": annotation.predicate,
            "smartways:object": {"@id": annotation.object_uri, "rdfs:label": annotation.object_label},
            "smartways:sourceField": annotation.source_field,
            "smartways:method": annotation.method,
            "smartways:confidence": annotation.confidence,
            "smartways:reviewStatus": annotation.review_status,
        }
        for annotation in queryset
    ]


def media_items(media_queryset, uri_builder):
    items = []
    for media in media_queryset.all():
        captions = translations_as_language_map(media.translations, "caption")
        item = {
            "@id": uri_builder(media),
            "@type": ["crm:E73_Information_Object", "schema:MediaObject"],
            "schema:encodingFormat": media.content_type,
            "schema:contentUrl": media.public_url,
            "schema:name": media.original_filename,
            "schema:position": media.position,
            "smartways:mediaType": media.media_type,
            "smartways:primary": media.is_primary,
        }
        if captions:
            item["schema:caption"] = captions
        items.append(item)
    return items
