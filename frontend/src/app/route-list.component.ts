import { AsyncPipe, DatePipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary, Route, Translation } from './api.service';

interface RouteDraft {
  title: string;
  description: string;
  enabled: boolean;
}

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
  is_reference: boolean;
}

interface PointExport {
  type?: string;
  id?: number;
  name?: string;
  title?: string;
  label?: string;
  lat?: number;
  lng?: number;
  coordinates?: {
    lat?: number;
    lng?: number;
  };
}

interface SegmentExport {
  selectedWalkingRoute?: {
    geometry?: unknown;
  } | null;
}

interface ItineraryJsonExport {
  points?: PointExport[];
  segments?: SegmentExport[];
}

declare const L: any;

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Routes</h1>
          <p>Browse multi-stage routes.</p>
        </div>
        <button type="button" class="primary" title="New route" aria-label="New route" (click)="openNewRouteDialog()">New route</button>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search route title, description, or slug"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
      </div>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <div class="preview-layout">
            <div class="preview-list">
              <div class="table-wrap">
                <table class="resource-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Last updated</th>
                      <th>Segments</th>
                      <th class="enabled-column">Enabled</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (route of state.routes; track route.id) {
                      <tr
                        [class.preview-selected-row]="previewRoute?.id === route.id"
                        (click)="selectPreviewRoute(route)"
                      >
                        <td>
                          <strong>{{ route.title || 'Untitled route' }}</strong>
                          <p class="description-preview">{{ route.description || 'No description' }}</p>
                        </td>
                        <td>{{ route.updated_at | date:'medium' }}</td>
                        <td>{{ route.itinerary_count }}</td>
                        <td class="enabled-column" (click)="$event.stopPropagation()">
                          <input
                            class="enabled-checkbox"
                            type="checkbox"
                            title="Enable"
                            aria-label="Enable"
                            [checked]="route.enabled"
                            (change)="setRouteEnabled(route, $any($event.target).checked)"
                          />
                        </td>
                        <td>
                          <div class="table-actions" (click)="$event.stopPropagation()">
                            <a class="secondary icon-action" title="View itineraries" aria-label="View itineraries" [routerLink]="['/route', route.slug || route.id]">📋</a>
                            <button type="button" class="secondary icon-action" title="Edit metadata and translations" aria-label="Edit metadata and translations" (click)="openTranslationDialog(route)">📝</button>
                            <button type="button" class="secondary icon-action danger-action" title="Delete" aria-label="Delete" (click)="deleteRoute(route)">🗑️</button>
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="5">No routes found.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
            <aside class="preview-panel" aria-label="Route map preview">
              <header>
                <h2>Map preview</h2>
                <p>{{ previewRoute ? previewRoute.title || 'Untitled route' : 'Click a route to preview it.' }}</p>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
            </aside>
          </div>
        }
      }

      <dialog class="metadata-dialog" #newRouteDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); createRoute()">
          <header class="metadata-dialog-header">
            <h2>New route</h2>
            <button type="button" class="icon-button" aria-label="Close new route dialog" (click)="closeNewRouteDialog()">✖</button>
          </header>
          <div class="form-stack">
            <label>
              <span>Title</span>
              <input type="text" [(ngModel)]="newRoute.title" name="newRouteTitle" placeholder="Route title" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="newRoute.description" name="newRouteDescription" placeholder="Optional description"></textarea>
            </label>
            <label class="checkbox-inline">
              <input type="checkbox" [(ngModel)]="newRoute.enabled" name="newRouteEnabled" />
              <span>Enabled</span>
            </label>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeNewRouteDialog()">Cancel</button>
            <button type="submit" class="primary">Create route</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #translationDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveTranslationDialog()">
          <header class="metadata-dialog-header">
            <h2>Edit route translations</h2>
            <button type="button" class="icon-button" aria-label="Close translation dialog" (click)="closeTranslationDialog()">✖</button>
          </header>
          <div class="translation-list">
            @for (translation of translationDrafts; track $index) {
              <div class="translation-row">
                <label class="reference-radio">
                  <span>Reference</span>
                  <input
                    type="radio"
                    name="routeReferenceTranslation"
                    [checked]="translation.is_reference"
                    (change)="setReferenceTranslation($index)"
                  />
                </label>
                <label>
                  <span>Language</span>
                  <input type="text" [(ngModel)]="translation.language_code" [name]="'routeLanguage' + $index" />
                </label>
                <label>
                  <span>Title</span>
                  <input type="text" [(ngModel)]="translation.title" [name]="'routeTitle' + $index" />
                </label>
                <label>
                  <span>Description</span>
                  <textarea rows="3" [(ngModel)]="translation.description" [name]="'routeDescription' + $index"></textarea>
                </label>
              </div>
            }
            <button type="button" class="secondary" (click)="addTranslationDraft()">Add translation</button>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeTranslationDialog()">Cancel</button>
            <button type="submit" class="primary">Save translations</button>
          </footer>
        </form>
      </dialog>
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class RouteListComponent implements AfterViewInit, OnDestroy {
  @ViewChild('newRouteDialog') private readonly newRouteDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  newRoute: RouteDraft = { title: '', description: '', enabled: true };
  statusMessage = '';
  statusIsError = false;
  editingRoute: Route | null = null;
  translationDrafts: TranslationDraft[] = [];
  previewRoute: Route | null = null;
  previewMessage = 'Click a route to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewResizeObserver: ResizeObserver | null = null;
  private previewRequestId = 0;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$
  ]).pipe(
    switchMap(([query]) => this.api.listRoutes(query).pipe(
      map(routePage => ({
        routes: routePage.results,
        error: ''
      })),
      catchError(error => of({
        routes: [] as Route[],
        error: `Could not load routes. ${error.message}`
      }))
    )),
    startWith({ routes: [] as Route[], error: '' })
  );

  ngAfterViewInit(): void {
    this.initializePreviewMap();
  }

  ngOnDestroy(): void {
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  async selectPreviewRoute(route: Route): Promise<void> {
    this.previewRoute = route;
    const requestId = this.previewRequestId + 1;
    this.previewRequestId = requestId;
    this.previewMessage = 'Loading route preview...';

    try {
      const itineraries = await firstValueFrom(this.api.listAllItineraries('', '', route.id));
      if (requestId !== this.previewRequestId) return;
      this.renderPreviewRoute(this.sortedItineraries(itineraries));
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewMessage = `Could not load route preview. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.previewLayer?.clearLayers();
    }
  }

  async createRoute(): Promise<void> {
    const title = this.newRoute.title.trim();
    if (!title) {
      this.showStatus('Enter a route title before creating it.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.createRoute({
        enabled: this.newRoute.enabled,
        translations: [{
          language_code: 'en',
          title,
          description: this.newRoute.description.trim(),
          is_reference: true
        }]
      }));
      this.newRoute = { title: '', description: '', enabled: true };
      this.closeNewRouteDialog();
      this.showStatus('Route created.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not create route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async toggleRoute(route: Route): Promise<void> {
    await this.setRouteEnabled(route, !route.enabled);
  }

  async setRouteEnabled(route: Route, enabled: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.updateRoute(route.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deleteRoute(route: Route): Promise<void> {
    const confirmed = window.confirm(
      `Delete route "${route.title || 'Untitled route'}"? Its constituent itineraries will not be deleted.`
    );
    if (!confirmed) return;

    try {
      await firstValueFrom(this.api.deleteRoute(route.id));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.showModal();
  }

  closeNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.close();
  }

  openTranslationDialog(route: Route): void {
    this.editingRoute = route;
    this.translationDrafts = this.translationDraftsFrom(route.translations, route.title, route.description);
    this.translationDialog?.nativeElement.showModal();
  }

  closeTranslationDialog(): void {
    this.translationDialog?.nativeElement.close();
    this.editingRoute = null;
    this.translationDrafts = [];
  }

  addTranslationDraft(): void {
    this.translationDrafts.push({
      language_code: '',
      title: '',
      description: '',
      is_reference: this.translationDrafts.length === 0
    });
  }

  setReferenceTranslation(index: number): void {
    this.translationDrafts = this.translationDrafts.map((translation, currentIndex) => ({
      ...translation,
      is_reference: currentIndex === index
    }));
  }

  async saveTranslationDialog(): Promise<void> {
    if (!this.editingRoute) return;

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every route translation needs a language and title.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.updateRoute(this.editingRoute.id, {
        translations
      }));
      this.closeTranslationDialog();
      this.showStatus('Route translations saved.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save translations. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  private initializePreviewMap(): void {
    if (this.previewMap || !this.previewMapElement?.nativeElement) return;
    if (typeof L === 'undefined') {
      this.previewMessage = 'Map library is not available.';
      return;
    }

    this.previewMap = L.map(this.previewMapElement.nativeElement, {
      zoomControl: true,
      attributionControl: false
    }).setView([42.5, -8.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.previewMap);
    this.previewLayer = L.layerGroup().addTo(this.previewMap);
    this.previewResizeObserver = new ResizeObserver(() => {
      this.previewMap?.invalidateSize();
    });
    this.previewResizeObserver.observe(this.previewMapElement.nativeElement);
    window.requestAnimationFrame(() => this.previewMap?.invalidateSize());
  }

  private renderPreviewRoute(itineraries: Itinerary[]): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;
    let markerIndex = 1;

    for (const itinerary of itineraries) {
      const json = this.itineraryJson(itinerary);
      const pointCoordinates = this.previewPointCoordinatesByIndex(json.points || []);
      const coordinates = pointCoordinates.filter((point): point is { lat: number; lng: number; label: string } => point !== null);
      const segments = json.segments || [];
      const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));

      for (let index = 0; index < segmentCount; index += 1) {
        const geometry = segments[index]?.selectedWalkingRoute?.geometry;
        if (geometry) {
          const routeLayer = L.geoJSON(geometry, {
            style: {
              color: '#1f6feb',
              weight: 5,
              opacity: 0.8
            }
          }).addTo(this.previewLayer);
          const routeBounds = routeLayer.getBounds();
          if (routeBounds.isValid()) {
            bounds.extend(routeBounds);
          }
          routeGeometryCount += 1;
          continue;
        }

        const start = pointCoordinates[index];
        const end = pointCoordinates[index + 1];
        if (start && end) {
          const line = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], {
            color: '#1f6feb',
            weight: 4,
            opacity: 0.75,
            dashArray: '8 8'
          }).addTo(this.previewLayer);
          bounds.extend(line.getBounds());
          straightSegmentCount += 1;
        }
      }

      coordinates.forEach(point => {
        L.marker([point.lat, point.lng], {
          icon: this.previewMarkerIcon(markerIndex)
        })
          .bindTooltip(`${markerIndex}. ${point.label}`, { direction: 'top' })
          .addTo(this.previewLayer);
        bounds.extend([point.lat, point.lng]);
        markerIndex += 1;
      });
    }

    this.fitPreviewMap(bounds);

    if (itineraries.length === 0) {
      this.previewMessage = 'This route has no itineraries yet.';
    } else if (markerIndex === 1 && routeGeometryCount === 0) {
      this.previewMessage = 'This route does not store coordinates yet.';
    } else if (markerIndex === 1) {
      this.previewMessage = 'Previewing saved route geometry. Point coordinates are not stored.';
    } else if (straightSegmentCount > 0 && routeGeometryCount > 0) {
      this.previewMessage = 'Dashed segments do not have saved walking routes yet.';
    } else if (straightSegmentCount > 0) {
      this.previewMessage = 'Previewing straight dashed lines for segments without walking routes.';
    } else {
      this.previewMessage = '';
    }
  }

  private previewPointCoordinatesByIndex(points: PointExport[]): Array<{ lat: number; lng: number; label: string } | null> {
    return points.map(point => {
      const lat = point.coordinates?.lat ?? point.lat;
      const lng = point.coordinates?.lng ?? point.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        lat: Number(lat),
        lng: Number(lng),
        label: this.pointName(point)
      };
    });
  }

  private previewMarkerIcon(index: number): any {
    return L.divIcon({
      className: 'preview-marker',
      html: `<span>${index}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      tooltipAnchor: [0, -18]
    });
  }

  private fitPreviewMap(bounds: any): void {
    window.requestAnimationFrame(() => {
      if (!this.previewMap) return;
      this.previewMap.invalidateSize(false);
      if (bounds.isValid()) {
        this.previewMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 15, animate: false });
      } else {
        this.previewMap.setView([42.5, -8.5], 5, { animate: false });
      }
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
    });
  }

  private pointName(point: PointExport | undefined): string {
    if (!point) return '-';
    if (point.title?.trim()) return point.title.trim();
    if (point.name?.trim()) return point.name.trim();
    if (point.label?.trim()) return point.label.trim();
    if (point.type === 'poi') return point.id ? `POI #${point.id}` : 'POI';
    const lat = point.coordinates?.lat ?? point.lat;
    const lng = point.coordinates?.lng ?? point.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    }
    return 'Waypoint';
  }

  private itineraryJson(itinerary: Itinerary): ItineraryJsonExport {
    return itinerary.itinerary_json && typeof itinerary.itinerary_json === 'object'
      ? itinerary.itinerary_json as ItineraryJsonExport
      : {};
  }

  private sortedItineraries(itineraries: Itinerary[]): Itinerary[] {
    return [...itineraries].sort((left, right) => {
      const leftStage = left.stage_number ?? Number.MAX_SAFE_INTEGER;
      const rightStage = right.stage_number ?? Number.MAX_SAFE_INTEGER;
      return leftStage - rightStage || left.id - right.id;
    });
  }

  private translationDraftsFrom(translations: Translation[], title: string | null, description: string | null): TranslationDraft[] {
    if (translations.length === 0) {
      return [{ language_code: 'en', title: title || '', description: description || '', is_reference: true }];
    }
    const drafts = translations.map(translation => ({
      language_code: translation.language_code,
      title: translation.title || '',
      description: translation.description || '',
      is_reference: Boolean(translation.is_reference)
    }));
    if (!drafts.some(translation => translation.is_reference)) {
      drafts[0].is_reference = true;
    }
    return drafts;
  }

  private normalizedTranslations(): TranslationDraft[] {
    const translations = this.translationDrafts
      .map(translation => ({
        language_code: translation.language_code.trim(),
        title: translation.title.trim(),
        description: translation.description.trim(),
        is_reference: translation.is_reference
      }))
      .filter(translation => translation.language_code || translation.title || translation.description);
    if (!translations.some(translation => translation.is_reference) && translations.length > 0) {
      translations[0].is_reference = true;
    }
    return translations;
  }

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }

  private clearStatus(): void {
    this.statusMessage = '';
    this.statusIsError = false;
  }
}
