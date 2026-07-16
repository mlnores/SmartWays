from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from pois.isochrones import (
    DEFAULT_ISOCHRONE_BATCH_SIZE,
    DEFAULT_ISOCHRONE_PROFILE,
    DEFAULT_ISOCHRONE_PROVIDER_URL,
    DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS,
    DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS,
    IsochroneProviderError,
    OpenRouteServiceIsochroneProvider,
    generate_itinerary_isochrones,
)
from pois.models import ItineraryIsochroneJob


class Command(BaseCommand):
    help = "Process queued itinerary isochrone generation jobs with ORS quota limits."

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true", help="List queued/running jobs without processing them.")
        parser.add_argument("--limit", type=int, default=10, help="Maximum number of jobs to process.")
        parser.add_argument("--daily-request-limit", type=int, default=500)
        parser.add_argument("--per-minute-request-limit", type=int, default=20)
        parser.add_argument("--batch-size", type=int, default=DEFAULT_ISOCHRONE_BATCH_SIZE)
        parser.add_argument("--simplify-tolerance-meters", type=int, default=DEFAULT_ISOCHRONE_SIMPLIFY_TOLERANCE_METERS)
        parser.add_argument("--smooth-iterations", type=int, default=DEFAULT_ISOCHRONE_SMOOTH_ITERATIONS)
        parser.add_argument("--profile", default=DEFAULT_ISOCHRONE_PROFILE)
        parser.add_argument("--provider-url", default="", help=f"Isochrone endpoint URL. Defaults to {DEFAULT_ISOCHRONE_PROVIDER_URL}.")
        parser.add_argument("--api-key", default="")
        parser.add_argument("--timeout", type=int, default=60)
        parser.add_argument("--max-attempts", type=int, default=3)

    def handle(self, *args, **options):
        if options["list"]:
            self.list_jobs()
            return

        if options["limit"] < 1:
            raise CommandError("--limit must be greater than 0.")
        if options["daily_request_limit"] < 1 or options["per_minute_request_limit"] < 1:
            raise CommandError("Quota limits must be greater than 0.")
        if options["simplify_tolerance_meters"] < 0:
            raise CommandError("--simplify-tolerance-meters must be 0 or greater.")
        if options["smooth_iterations"] < 0:
            raise CommandError("--smooth-iterations must be 0 or greater.")

        pause_seconds = 60 / options["per_minute_request_limit"]
        provider = OpenRouteServiceIsochroneProvider(
            url=options["provider_url"] or None,
            api_key=options["api_key"],
            profile=options["profile"],
            timeout=options["timeout"],
            pause_seconds=pause_seconds,
        )

        processed = 0
        now = timezone.now()
        used_today = self.provider_requests_used_today(now)
        remaining_today = max(0, options["daily_request_limit"] - used_today)
        if remaining_today <= 0:
            self.stdout.write(self.style.WARNING("Daily isochrone request quota is already exhausted."))
            return

        for job in self.pending_jobs()[: options["limit"]]:
            estimated = max(1, job.estimated_request_count)
            if estimated > remaining_today:
                self.stdout.write(
                    self.style.WARNING(
                        f"Stopping before job {job.id}: estimated {estimated} request(s), "
                        f"remaining daily budget {remaining_today}."
                    )
                )
                break

            with transaction.atomic():
                locked = ItineraryIsochroneJob.objects.select_for_update().get(id=job.id)
                if locked.status != ItineraryIsochroneJob.Status.PENDING or locked.not_before > timezone.now():
                    continue
                locked.status = ItineraryIsochroneJob.Status.RUNNING
                locked.started_at = timezone.now()
                locked.attempts += 1
                locked.last_error = ""
                locked.save(update_fields=["status", "started_at", "attempts", "last_error", "updated_at"])
                job = locked

            self.stdout.write(f"Processing job {job.id} for itinerary {job.itinerary_id}.")
            try:
                result = generate_itinerary_isochrones(
                    job.itinerary,
                    provider=provider,
                    minutes=job.minutes,
                    mode=job.mode,
                    sample_distance_meters=job.sample_distance_meters,
                    simplify_tolerance_meters=job.simplify_tolerance_meters,
                    smooth_iterations=job.smooth_iterations,
                    batch_size=options["batch_size"],
                    clear=True,
                    force=True,
                )
            except IsochroneProviderError as error:
                self.fail_job(job, str(error), options["max_attempts"])
                continue

            request_count = result.get("request_count") or estimated
            remaining_today -= request_count
            if result["status"] == "completed":
                job.status = ItineraryIsochroneJob.Status.COMPLETED
                job.provider_request_count = request_count
                job.completed_at = timezone.now()
                job.last_error = ""
                job.save(update_fields=["status", "provider_request_count", "completed_at", "last_error", "updated_at"])
                processed += 1
                self.stdout.write(self.style.SUCCESS(f"Completed job {job.id}; generated {result['generated']} row(s)."))
            else:
                job.status = ItineraryIsochroneJob.Status.SKIPPED
                job.provider_request_count = request_count
                job.completed_at = timezone.now()
                job.last_error = result.get("reason", "")
                job.save(update_fields=["status", "provider_request_count", "completed_at", "last_error", "updated_at"])
                self.stdout.write(self.style.WARNING(f"Skipped job {job.id}: {job.last_error}"))

        self.stdout.write(self.style.SUCCESS(f"Processed {processed} job(s)."))

    def pending_jobs(self):
        return ItineraryIsochroneJob.objects.filter(
            status=ItineraryIsochroneJob.Status.PENDING,
            not_before__lte=timezone.now(),
        ).select_related("itinerary").order_by("priority", "not_before", "created_at", "id")

    def list_jobs(self):
        jobs = ItineraryIsochroneJob.objects.filter(
            status__in=[ItineraryIsochroneJob.Status.PENDING, ItineraryIsochroneJob.Status.RUNNING]
        ).order_by("priority", "not_before", "created_at", "id")[:100]
        for job in jobs:
            self.stdout.write(
                f"{job.id}\t{job.status}\tpriority={job.priority}\titinerary={job.itinerary_id}\t"
                f"manual={job.requested_manually}\trequests~{job.estimated_request_count}\tnot_before={job.not_before.isoformat()}"
            )
        if not jobs:
            self.stdout.write("No pending or running isochrone jobs.")

    def provider_requests_used_today(self, now):
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return sum(
            ItineraryIsochroneJob.objects.filter(
                status__in=[ItineraryIsochroneJob.Status.COMPLETED, ItineraryIsochroneJob.Status.SKIPPED],
                completed_at__gte=start,
            ).values_list("provider_request_count", flat=True)
        )

    def fail_job(self, job, message, max_attempts):
        job.last_error = message
        if job.attempts >= max_attempts:
            job.status = ItineraryIsochroneJob.Status.FAILED
            job.completed_at = timezone.now()
        else:
            job.status = ItineraryIsochroneJob.Status.PENDING
            job.not_before = timezone.now() + timedelta(minutes=min(60, 5 * job.attempts))
        job.save(update_fields=["status", "not_before", "last_error", "completed_at", "updated_at"])
        self.stdout.write(self.style.WARNING(f"Job {job.id} failed: {message}"))
