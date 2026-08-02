import { AsyncPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary, Route, Translation } from './api.service';
import { MediaManagerDialogComponent } from './media-manager-dialog.component';
import { PageInstructionService } from './page-instruction.service';

interface RouteDraft {
  language_code: string;
  title: string;
  description: string;
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

type RouteSortKey = 'title' | 'stages' | 'draft';
type SortDirection = 'asc' | 'desc';

declare const L: any;

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'de', label: 'German' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'no', label: 'Norwegian' },
  { code: 'pl', label: 'Polish' },
  { code: 'ro', label: 'Romanian' },
  { code: 'sk', label: 'Slovak' },
];
const PREVIEW_COLORS = ['#1f6feb', '#d97706', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink, MediaManagerDialogComponent],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Routes</h1>
        </div>
        <button type="button" class="primary" title="New route" aria-label="New route" (click)="openNewRouteDialog()">New route</button>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search route title or description"
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
          <div class="preview-layout route-preview-layout">
            <div class="preview-list">
              <div class="table-wrap">
                <table class="resource-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" class="sortable-header" (click)="toggleRouteSort('title')">
                          <span>Title</span>
                          <span aria-hidden="true">{{ routeSortIndicator('title') }}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" class="sortable-header" (click)="toggleRouteSort('stages')">
                          <span>Stages</span>
                          <span aria-hidden="true">{{ routeSortIndicator('stages') }}</span>
                        </button>
                      </th>
                      <th class="enabled-column">
                        <button type="button" class="sortable-header" (click)="toggleRouteSort('draft')">
                          <span>Draft?</span>
                          <span aria-hidden="true">{{ routeSortIndicator('draft') }}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (route of state.routes; track route.id) {
                      <tr
                        [attr.id]="routeRowId(route)"
                        [class.highlight-row]="highlightedRouteId === route.id"
                        [class.preview-selected-row]="previewRoute?.id === route.id"
                        (click)="togglePreviewRoute(route)"
                        (dblclick)="openRouteItineraries(route)"
                      >
                        <td>
                          <strong>{{ route.title || 'Untitled route' }}</strong>
                          <p class="description-preview">{{ route.description || 'No description' }}</p>
                        </td>
                        <td>
                          <span>{{ route.itinerary_count }}</span>
                          <span
                            class="route-color-swatch"
                            [style.backgroundColor]="previewColorForRoute(route)"
                            aria-hidden="true"
                          ></span>
                        </td>
                        <td class="enabled-column">
                          {{ route.enabled ? 'No' : 'Yes' }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="3">No routes found.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
            <aside class="preview-panel" aria-label="Route map preview">
              <header>
                <h2>Map preview</h2>
                <p>{{ previewLabel() }}</p>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
              <div class="preview-actions" aria-label="Route preview actions">
                <button type="button" class="secondary preview-action" (click)="fitPreviewToCurrentRoutes()">
                  <span class="preview-action-icon" aria-hidden="true">🎯</span>
                  <span>Fit view</span>
                </button>

                @if (previewRoute && !previewRoute.enabled) {
                  <button type="button" class="secondary preview-action" (click)="setRouteEnabled(previewRoute, true)">
                    <span class="preview-action-icon" aria-hidden="true">🌐</span>
                    <span>Make public</span>
                  </button>
                }
                @if (previewRoute && previewRoute.enabled) {
                  <button type="button" class="secondary preview-action" (click)="setRouteEnabled(previewRoute, false)">
                    <span class="preview-action-icon" aria-hidden="true">✎</span>
                    <span>Turn to draft</span>
                  </button>
                }
                @if (previewRoute) {
                  <a class="secondary preview-action" [routerLink]="['/route', previewRoute.slug || previewRoute.id]" target="_blank" rel="noopener">
                    <span class="preview-action-icon" aria-hidden="true">📋</span>
                    <span>View itineraries</span>
                  </a>
                  @if (!previewRoute.enabled) {
                    <button type="button" class="secondary preview-action" (click)="openSelectedRouteMediaDialog(previewRoute)">
                      <span class="preview-action-icon" aria-hidden="true">🖼️</span>
                      <span>Manage metadata, media and translations</span>
                    </button>
                    <button type="button" class="secondary preview-action danger-action" (click)="deleteRoute(previewRoute)">
                      <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                      <span>Delete route</span>
                    </button>
                  }
                }
              </div>
            </aside>
          </div>
        }
      }

      <app-media-manager-dialog #mediaManagerDialog (saved)="refreshList()"></app-media-manager-dialog>

      <dialog class="metadata-dialog" #newRouteDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); createRoute()">
          <header class="metadata-dialog-header">
            <h2>New route</h2>
            <button type="button" class="icon-button" aria-label="Close new route dialog" (click)="closeNewRouteDialog()">✖</button>
          </header>
          <div class="form-stack">
            <label>
              <span>Language</span>
              <select [(ngModel)]="newRoute.language_code" name="newRouteLanguage" required>
                @for (language of languageOptions; track language.code) {
                  <option [value]="language.code">{{ language.label }}</option>
                }
              </select>
            </label>
            <label>
              <span>Title</span>
              <input type="text" [(ngModel)]="newRoute.title" name="newRouteTitle" placeholder="Route title" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="newRoute.description" name="newRouteDescription" placeholder="Optional description"></textarea>
            </label>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeNewRouteDialog()">Cancel</button>
            <button type="submit" class="primary">Create route</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog" #deleteRouteDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); confirmDeleteRoutes()">
          <header class="metadata-dialog-header">
            <h2>Delete route</h2>
            <button type="button" class="icon-button" aria-label="Close delete route dialog" (click)="closeDeleteRouteDialog()">✖</button>
          </header>
          <div class="form-stack">
            <p>{{ deleteRouteMessage() }}</p>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeDeleteRouteDialog()">Cancel</button>
            <button type="submit" class="secondary danger-action">Delete</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #translationDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveTranslationDialog()">
          <header class="metadata-dialog-header">
            <h2>Edit route translations</h2>
            <button type="button" class="icon-button" aria-label="Close translation dialog" (click)="closeTranslationDialog()">✖</button>
          </header>
          <div class="translation-tabs-panel">
            <div class="translation-tabs" role="tablist" aria-label="Route translation languages">
              @for (translation of translationDrafts; track $index) {
                <button
                  type="button"
                  class="translation-tab"
                  [class.active]="activeTranslationIndex === $index"
                  (click)="selectTranslationTab($index)"
                >
                  @if (translation.is_reference) {
                    <span class="reference-icon" title="Reference language" aria-label="Reference language">★</span>
                  }
                  <span>{{ translation.language_code || 'New language' }}</span>
                </button>
              }
              <button type="button" class="secondary add-tab-button" (click)="addTranslationDraft()">+ Add language</button>
            </div>

            @if (activeTranslationDraft(); as translation) {
              <section class="translation-tab-content">
                <div class="translation-tab-header">
                  <label>
                    <span>Language</span>
                    <input type="text" [(ngModel)]="translation.language_code" [name]="'routeLanguage' + activeTranslationIndex" />
                  </label>
                  @if (translation.is_reference) {
                    <span class="reference-pill"><span aria-hidden="true">★</span> Reference language</span>
                  } @else {
                    <button type="button" class="secondary" (click)="setReferenceTranslation(activeTranslationIndex)">Make reference</button>
                  }
                </div>

                @if (translation.is_reference) {
                  <div class="translation-single-column">
                    <label>
                      <span>Title</span>
                      <input type="text" [(ngModel)]="translation.title" [name]="'routeTitle' + activeTranslationIndex" />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea rows="5" [(ngModel)]="translation.description" [name]="'routeDescription' + activeTranslationIndex"></textarea>
                    </label>
                  </div>
                } @else {
                  <div class="translation-comparison">
                    <section class="reference-column">
                      <h3><span aria-hidden="true">★</span> Reference</h3>
                      <label>
                        <span>Title</span>
                        <input type="text" [value]="referenceTranslationDraft()?.title || ''" readonly />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea rows="5" [value]="referenceTranslationDraft()?.description || ''" readonly></textarea>
                      </label>
                    </section>
                    <section>
                      <h3>{{ translation.language_code || 'Translation' }}</h3>
                      <label>
                        <span>Title</span>
                        <input type="text" [(ngModel)]="translation.title" [name]="'routeTitle' + activeTranslationIndex" />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea rows="5" [(ngModel)]="translation.description" [name]="'routeDescription' + activeTranslationIndex"></textarea>
                      </label>
                    </section>
                  </div>
                }
              </section>
            }
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
  @ViewChild('deleteRouteDialog') private readonly deleteRouteDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('mediaManagerDialog') private readonly mediaManagerDialog?: MediaManagerDialogComponent;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;

  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly title = inject(Title);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  readonly languageOptions = LANGUAGE_OPTIONS;
  query = '';
  newRoute: RouteDraft = { language_code: 'en', title: '', description: '' };
  statusMessage = '';
  statusIsError = false;
  editingRoute: Route | null = null;
  routesPendingDeletion: Route[] = [];
  translationDrafts: TranslationDraft[] = [];
  activeTranslationIndex = 0;
  highlightedRouteId: number | null = null;
  currentRoutes: Route[] = [];
  routeSortKey: RouteSortKey = 'title';
  routeSortDirection: SortDirection = 'asc';
  previewRoute: Route | null = null;
  previewMessage = 'Click a route to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewResizeObserver: ResizeObserver | null = null;
  private previewRequestId = 0;
  private previewFitRequestId = 0;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.queryParamMap.pipe(map(params => Number(params.get('highlight')) || null))
  ]).pipe(
    switchMap(([query, , highlightedRouteId]) => this.api.listRoutes(query).pipe(
      map(routePage => {
        const routes = this.sortedRoutes(routePage.results);
        this.currentRoutes = routes;
        if (this.previewRoute) {
          const refreshedPreviewRoute = routes.find(route => route.id === this.previewRoute?.id) || null;
          this.previewRoute = refreshedPreviewRoute;
          if (refreshedPreviewRoute) {
            void this.selectPreviewRoute(refreshedPreviewRoute, false);
          } else {
            void this.renderVisibleRoutesPreview(routes);
          }
        } else {
          void this.renderVisibleRoutesPreview(routes);
        }
        this.scheduleHighlight(highlightedRouteId, routes);
        return {
          routes,
          error: ''
        };
      }),
      catchError(error => of({
        routes: [] as Route[],
        error: `Could not load routes. ${error.message}`
      }))
    )),
    startWith({ routes: [] as Route[], error: '' })
  );

  constructor() {
    this.pageInstruction.setInstruction('Browse multi-stage routes.');
    this.title.setTitle('SW Routes');
  }

  ngAfterViewInit(): void {
    this.initializePreviewMap();
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  async selectPreviewRoute(route: Route, shouldFit = true): Promise<void> {
    this.previewRoute = route;
    const requestId = this.previewRequestId + 1;
    this.previewRequestId = requestId;
    this.previewMessage = 'Loading route preview...';

    try {
      const itineraries = await firstValueFrom(this.api.listAllItineraries('', '', route.id));
      if (requestId !== this.previewRequestId) return;
      this.renderPreviewRoute(this.sortedItineraries(itineraries), shouldFit);
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewMessage = `Could not load route preview. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.previewLayer?.clearLayers();
    }
  }

  togglePreviewRoute(route: Route): void {
    if (this.previewRoute?.id === route.id) {
      this.previewRoute = null;
      void this.renderVisibleRoutesPreview(this.currentRoutes);
      return;
    }
    void this.selectPreviewRoute(route);
  }

  previewLabel(): string {
    if (this.previewRoute) return this.previewRoute.title || 'Untitled route';
    return 'All routes';
  }

  fitPreviewToCurrentRoutes(): void {
    if (this.previewRoute) {
      void this.selectPreviewRoute(this.previewRoute, true);
    } else {
      void this.renderVisibleRoutesPreview(this.currentRoutes);
    }
  }

  openRouteItineraries(route: Route): void {
    this.openRouteInNewTab(route);
  }

  private openRouteInNewTab(route: Route): void {
    const url = this.router.serializeUrl(this.router.createUrlTree(['/route', route.slug || route.id]));
    window.open(url, '_blank', 'noopener');
  }

  previewColorForRoute(route: Route): string {
    const index = this.currentRoutes.findIndex(candidate => candidate.id === route.id);
    if (index < 0) return '#cfd6e3';
    return PREVIEW_COLORS[index % PREVIEW_COLORS.length];
  }

  routeRowId(route: Route): string {
    return `route-row-${route.id}`;
  }

  async createRoute(): Promise<void> {
    const title = this.newRoute.title.trim();
    const languageCode = this.newRoute.language_code.trim();
    if (!languageCode) {
      this.showStatus('Choose the language of the route title and description.', true);
      return;
    }
    if (!title) {
      this.showStatus('Enter a route title before creating it.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.createRoute({
        enabled: false,
        translations: [{
          language_code: languageCode,
          title,
          description: this.newRoute.description.trim(),
          is_reference: true
        }]
      }));
      this.newRoute = { language_code: 'en', title: '', description: '' };
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

  toggleRouteSort(key: RouteSortKey): void {
    if (this.routeSortKey === key) {
      this.routeSortDirection = this.routeSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.routeSortKey = key;
      this.routeSortDirection = 'asc';
    }
    this.refresh$.next(this.refresh$.value + 1);
  }

  routeSortIndicator(key: RouteSortKey): string {
    if (this.routeSortKey !== key) return '';
    return this.routeSortDirection === 'asc' ? '▲' : '▼';
  }

  async setRouteEnabled(route: Route, enabled: boolean): Promise<void> {
    if (!this.confirmRouteDraftChange([route], enabled)) return;
    try {
      await firstValueFrom(this.api.updateRoute(route.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  private confirmRouteDraftChange(routes: Route[], enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    const itemLabel = routes.length === 1 ? 'route' : 'routes';
    let message = `Really ${action} ${routes.length} ${itemLabel}?`;
    if (enabled) {
      message += '\n\nDraft itineraries in the route, and draft POIs included in those itineraries, will also be made public.';
    }
    return window.confirm(message);
  }

  deleteRoute(route: Route): void {
    if (route.enabled) {
      this.showStatus('Public routes cannot be deleted.', true);
      return;
    }
    this.routesPendingDeletion = [route];
    this.deleteRouteDialog?.nativeElement.showModal();
  }

  closeDeleteRouteDialog(): void {
    this.deleteRouteDialog?.nativeElement.close();
    this.routesPendingDeletion = [];
  }

  deleteRouteMessage(): string {
    if (this.routesPendingDeletion.length === 1) {
      return `Delete route "${this.routesPendingDeletion[0].title || 'Untitled route'}"? Its constituent itineraries will not be deleted.`;
    }
    return 'Delete route? Its constituent itineraries will not be deleted.';
  }

  async confirmDeleteRoutes(): Promise<void> {
    const routes = [...this.routesPendingDeletion];
    if (routes.length === 0) return;
    try {
      await Promise.all(routes.map(route => firstValueFrom(this.api.deleteRoute(route.id))));
      if (routes.some(route => route.id === this.previewRoute?.id)) {
        this.previewRoute = null;
      }
      this.closeDeleteRouteDialog();
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete route${routes.length > 1 ? 's' : ''}. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.showModal();
  }

  closeNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.close();
  }

  openSelectedRouteMediaDialog(route: Route): void {
    if (route.enabled) {
      this.showStatus('Public routes cannot be edited.', true);
      return;
    }
    this.mediaManagerDialog?.open('route', route);
  }

  refreshList(): void {
    this.refresh$.next(this.refresh$.value + 1);
  }

  openTranslationDialog(route: Route): void {
    if (route.enabled) {
      this.showStatus('Public routes cannot be edited.', true);
      return;
    }
    this.editingRoute = route;
    this.translationDrafts = this.translationDraftsFrom(route.translations, route.title, route.description);
    this.activeTranslationIndex = Math.max(0, this.translationDrafts.findIndex(translation => translation.is_reference));
    this.translationDialog?.nativeElement.showModal();
  }

  closeTranslationDialog(): void {
    this.translationDialog?.nativeElement.close();
    this.editingRoute = null;
    this.translationDrafts = [];
    this.activeTranslationIndex = 0;
  }

  addTranslationDraft(): void {
    const nextIndex = this.translationDrafts.length;
    this.translationDrafts.push({
      language_code: '',
      title: '',
      description: '',
      is_reference: this.translationDrafts.length === 0
    });
    this.activeTranslationIndex = nextIndex;
  }

  setReferenceTranslation(index: number): void {
    const currentReferenceIndex = this.translationDrafts.findIndex(translation => translation.is_reference);
    if (currentReferenceIndex >= 0 && currentReferenceIndex !== index) {
      const target = this.translationDrafts[index];
      const current = this.translationDrafts[currentReferenceIndex];
      const confirmed = window.confirm(
        `Change the reference language from "${current.language_code || 'current language'}" to "${target?.language_code || 'selected language'}"?`
      );
      if (!confirmed) return;
    }

    this.translationDrafts = this.translationDrafts.map((translation, currentIndex) => ({
      ...translation,
      is_reference: currentIndex === index
    }));
  }

  selectTranslationTab(index: number): void {
    if (index < 0 || index >= this.translationDrafts.length) return;
    this.activeTranslationIndex = index;
  }

  activeTranslationDraft(): TranslationDraft | null {
    return this.translationDrafts[this.activeTranslationIndex] || this.translationDrafts[0] || null;
  }

  referenceTranslationDraft(): TranslationDraft | null {
    return this.translationDrafts.find(translation => translation.is_reference) || this.translationDrafts[0] || null;
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
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.previewMap);
    this.previewLayer = L.layerGroup().addTo(this.previewMap);
    this.previewResizeObserver = new ResizeObserver(() => {
      this.previewMap?.invalidateSize();
    });
    this.previewResizeObserver.observe(this.previewMapElement.nativeElement);
    this.fitPreviewMapToWorld();
  }

  private renderPreviewRoute(itineraries: Itinerary[], shouldFit = true): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    const result = this.drawRoutePreview(itineraries, PREVIEW_COLORS[0]);
    if (shouldFit) {
      this.fitPreviewMap(result.bounds);
    } else {
      this.previewMap.invalidateSize(false);
    }

    if (itineraries.length === 0) {
      this.previewMessage = 'This route has no itineraries yet.';
    } else if (!result.bounds.isValid() && result.routeGeometryCount === 0) {
      this.previewMessage = 'This route does not store coordinates yet.';
    } else if (!result.hasPointCoordinates) {
      this.previewMessage = 'Previewing saved route geometry. Point coordinates are not stored.';
    } else if (result.straightSegmentCount > 0 && result.routeGeometryCount > 0) {
      this.previewMessage = 'Straight segments do not have saved walking routes yet.';
    } else if (result.straightSegmentCount > 0) {
      this.previewMessage = 'Previewing straight lines for segments without walking routes.';
    } else {
      this.previewMessage = '';
    }
  }

  private async renderVisibleRoutesPreview(routes: Route[]): Promise<void> {
    this.previewRoute = null;
    if (routes.length === 0) {
      this.previewLayer?.clearLayers();
      this.previewMessage = 'No routes found.';
      this.fitPreviewMapToWorld();
      return;
    }

    const requestId = ++this.previewRequestId;
    this.previewMessage = 'Loading route previews...';
    try {
      const routeItineraries = await Promise.all(
        routes.map(route => firstValueFrom(this.api.listAllItineraries('', '', route.id)))
      );
      if (requestId !== this.previewRequestId || this.previewRoute) return;
      this.renderPreviewRoutes(
        routeItineraries.map(itineraries => this.sortedItineraries(itineraries)),
        true,
        'routes'
      );
    } catch (error) {
      if (requestId !== this.previewRequestId) return;
      this.previewMessage = `Could not load route previews. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.previewLayer?.clearLayers();
    }
  }

  private renderPreviewRoutes(
    routeItineraries: Itinerary[][],
    shouldFit = true,
    scopeLabel = 'routes'
  ): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;
    let hasPointCoordinates = false;

    routeItineraries.forEach((itineraries, index) => {
      const result = this.drawRoutePreview(itineraries, PREVIEW_COLORS[index % PREVIEW_COLORS.length]);
      if (result.bounds.isValid()) bounds.extend(result.bounds);
      routeGeometryCount += result.routeGeometryCount;
      straightSegmentCount += result.straightSegmentCount;
      hasPointCoordinates ||= result.hasPointCoordinates;
    });

    if (shouldFit) {
      this.fitPreviewMap(bounds);
    } else {
      this.previewMap.invalidateSize(false);
    }

    if (routeItineraries.every(itineraries => itineraries.length === 0)) {
      this.previewMessage = `The ${scopeLabel} have no itineraries yet.`;
    } else if (!bounds.isValid() && routeGeometryCount === 0) {
      this.previewMessage = `The ${scopeLabel} do not store coordinates yet.`;
    } else if (!hasPointCoordinates) {
      this.previewMessage = 'Previewing saved route geometry. Point coordinates are not stored.';
    } else if (straightSegmentCount > 0 && routeGeometryCount > 0) {
      this.previewMessage = 'Straight segments do not have saved walking routes yet.';
    } else if (straightSegmentCount > 0) {
      this.previewMessage = 'Previewing straight lines for segments without walking routes.';
    } else {
      this.previewMessage = '';
    }
  }

  private drawRoutePreview(
    itineraries: Itinerary[],
    color: string
  ): { bounds: any; routeGeometryCount: number; straightSegmentCount: number; hasPointCoordinates: boolean } {
    const bounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;
    let hasPointCoordinates = false;

    for (const itinerary of itineraries) {
      const json = this.itineraryJson(itinerary);
      const pointCoordinates = this.previewPointCoordinatesByIndex(json.points || []);
      hasPointCoordinates ||= pointCoordinates.some(point => point !== null);
      const segments = json.segments || [];
      const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));

      for (let index = 0; index < segmentCount; index += 1) {
        const geometry = segments[index]?.selectedWalkingRoute?.geometry;
        if (geometry) {
          const routeLayer = L.geoJSON(geometry, {
            style: {
              color,
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
            color,
            weight: 4,
            opacity: 0.75
          }).addTo(this.previewLayer);
          bounds.extend(line.getBounds());
          straightSegmentCount += 1;
        }
      }
    }

    return { bounds, routeGeometryCount, straightSegmentCount, hasPointCoordinates };
  }

  private sortedRoutes(routes: Route[]): Route[] {
    const direction = this.routeSortDirection === 'asc' ? 1 : -1;
    return [...routes].sort((left, right) => {
      let comparison = 0;
      if (this.routeSortKey === 'title') {
        comparison = (left.title || '').localeCompare(right.title || '');
      } else if (this.routeSortKey === 'stages') {
        comparison = (left.itinerary_count || 0) - (right.itinerary_count || 0);
      } else {
        comparison = Number(left.enabled) - Number(right.enabled);
      }
      return comparison * direction || left.id - right.id;
    });
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

  private fitPreviewMap(bounds: any): void {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      if (bounds.isValid()) {
        this.previewMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 15, animate: false });
      } else {
        this.previewMap.fitWorld({ animate: false });
      }
      window.requestAnimationFrame(() => {
        if (requestId === this.previewFitRequestId) {
          this.previewMap?.invalidateSize(false);
        }
      });
    });
  }

  private fitPreviewMapToWorld(): void {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      this.previewMap.fitWorld({ animate: false });
      window.requestAnimationFrame(() => {
        if (requestId === this.previewFitRequestId) {
          this.previewMap?.invalidateSize(false);
        }
      });
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

  private scheduleHighlight(routeId: number | null, routes: Route[]): void {
    const route = routes.find(candidate => candidate.id === routeId);
    if (!routeId || !route) return;

    this.highlightedRouteId = routeId;
    if (this.previewRoute?.id !== routeId) {
      void this.selectPreviewRoute(route);
    }
    window.setTimeout(() => {
      document.getElementById(`route-row-${routeId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedRouteId === routeId) {
        this.highlightedRouteId = null;
      }
    }, 4500);
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
