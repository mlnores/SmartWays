import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary, Route, Translation } from './api.service';

interface ItineraryGroup {
  routeId: number | null;
  title: string;
  slug: string | null;
  items: Itinerary[];
}

interface AssignmentDraft {
  routeId: number | null;
  stageNumber: number | null;
}

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
  is_reference: boolean;
}

interface NewItineraryDraft {
  language_code: string;
  title: string;
  description: string;
  enabled: boolean;
  routeId: number | null;
  stageNumber: number | null;
}

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
    distanceMeters?: number;
    geometry?: unknown;
  } | null;
}

interface ItineraryJsonExport {
  points?: PointExport[];
  segments?: SegmentExport[];
}

declare const L: any;

@Component({
  selector: 'app-itinerary-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, NgTemplateOutlet, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>{{ routeSlug ? routeTitle || 'Route itineraries' : 'Itineraries' }}</h1>
          <p>{{ routeSlug ? 'Browse the constituent itineraries of this route.' : 'Browse saved itinerary definitions and open the editor.' }}</p>
        </div>
        @if (routeSlug) {
          <div class="list-actions">
            <a class="secondary" [routerLink]="['/routes']" [queryParams]="currentRouteId ? { highlight: currentRouteId } : null">Back to routes</a>
            <button type="button" class="primary" title="New itinerary for this route" aria-label="New itinerary for this route" (click)="openNewItineraryForCurrentRoute()">New itinerary</button>
          </div>
        } @else {
          <button type="button" class="primary" title="New itinerary" aria-label="New itinerary" (click)="openNewItineraryDialog()">New itinerary</button>
        }
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title, description, or slug"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
        @if (!routeSlug) {
          <div class="view-toggle" aria-label="Itinerary display mode">
            <button type="button" [class.active]="viewMode === 'flat'" (click)="viewMode = 'flat'">Plain list</button>
            <button type="button" [class.active]="viewMode === 'grouped'" (click)="viewMode = 'grouped'">Grouped by route</button>
          </div>
        }
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
              @if (routeSlug || viewMode === 'flat') {
                <ng-container *ngTemplateOutlet="itineraryTable; context: { items: state.items, routes: state.routes }"></ng-container>
              } @else {
                <div class="route-group-list">
              @for (group of groupsFor(state.items); track groupKey(group)) {
                <section class="route-group">
                  <header class="route-group-header">
                    <h2>{{ group.title }}</h2>
                  </header>
                  <div class="table-wrap">
                    <table class="resource-table">
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>Title</th>
                          <th>First point</th>
                          <th>Last point</th>
                          <th>Estimated distance</th>
                          <th class="enabled-column">Enabled</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (itinerary of group.items; track itinerary.id) {
                          <tr
                            [attr.id]="itineraryRowId(itinerary)"
                            [class.highlight-row]="highlightedItineraryId === itinerary.id"
                            [class.preview-selected-row]="previewItinerary?.id === itinerary.id"
                            (click)="selectPreviewItinerary(itinerary)"
                          >
                            <td>{{ itinerary.stage_number || '-' }}</td>
                            <td>
                              {{ itinerary.title || 'Untitled itinerary' }}
                              <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                            </td>
                            <td>{{ firstPointName(itinerary) }}</td>
                            <td>{{ lastPointName(itinerary) }}</td>
                            <td>{{ estimatedDistance(itinerary) }}</td>
                            <td class="enabled-column" (click)="$event.stopPropagation()">
                              <input
                                class="enabled-checkbox"
                                type="checkbox"
                                title="Enable"
                                aria-label="Enable"
                                [checked]="itinerary.enabled"
                                (change)="setItineraryEnabled(itinerary, $any($event.target).checked)"
                              />
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              } @empty {
                <p class="empty">No itineraries found.</p>
              }
                </div>
              }
            </div>
            <aside class="preview-panel" aria-label="Itinerary map preview">
              <header>
                <h2>Map preview</h2>
                <p>{{ previewItinerary ? previewItinerary.title || 'Untitled itinerary' : 'Click an itinerary to preview it.' }}</p>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
              @if (previewItinerary) {
                <div class="preview-actions" aria-label="Selected itinerary actions">
                  <button type="button" class="secondary preview-action" (click)="openTranslationDialog(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">📝</span>
                    <span>Edit metadata and translations</span>
                  </button>
                  <a class="secondary preview-action" [routerLink]="['/itineraries', previewItinerary.id, 'edit']" [queryParams]="backQueryParams()">
                    <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                    <span>Open in editor</span>
                  </a>
                  <a class="secondary preview-action" [routerLink]="['/itineraries', previewItinerary.id, 'pois']" [queryParams]="backQueryParams()">
                    <span class="preview-action-icon" aria-hidden="true">📍</span>
                    <span>View POIs</span>
                  </a>
                  <button type="button" class="secondary preview-action" [disabled]="duplicatingIds.has(previewItinerary.id)" (click)="duplicateItinerary(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">📄</span>
                    <span>{{ duplicatingIds.has(previewItinerary.id) ? 'Duplicating...' : 'Duplicate' }}</span>
                  </button>
                  @if (previewItinerary.route !== null) {
                    <button type="button" class="secondary preview-action" [disabled]="assigningIds.has(previewItinerary.id)" (click)="unassignItinerary(previewItinerary)">
                      <span class="preview-action-icon" aria-hidden="true">🚫</span>
                      <span>{{ assigningIds.has(previewItinerary.id) ? 'Saving...' : 'Remove from route' }}</span>
                    </button>
                  }
                  <button type="button" class="secondary preview-action danger-action" (click)="deleteItinerary(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                    <span>Delete itinerary</span>
                  </button>
                </div>
              }
            </aside>
          </div>
        }
      }

      <ng-template #itineraryTable let-items="items" let-routes="routes">
        <div class="table-wrap">
          <table class="resource-table">
            <thead>
              <tr>
                @if (!routeSlug) {
                  <th>Route</th>
                } @else {
                  <th class="drag-handle-column" aria-label="Reorder"></th>
                  <th>Stage</th>
                }
                <th>Title</th>
                <th>First point</th>
                <th>Last point</th>
                <th>Estimated distance</th>
                <th class="enabled-column">Enabled</th>
              </tr>
            </thead>
            <tbody>
              @for (itinerary of items; track itinerary.id) {
                <tr
                  [attr.id]="itineraryRowId(itinerary)"
                  [class.highlight-row]="highlightedItineraryId === itinerary.id"
                  [class.preview-selected-row]="previewItinerary?.id === itinerary.id"
                  [class.dragging-row]="draggedItineraryId === itinerary.id"
                  [attr.draggable]="routeSlug ? true : null"
                  (click)="selectPreviewItinerary(itinerary)"
                  (dragstart)="startStageDrag(itinerary)"
                  (dragover)="allowStageDrop($event)"
                  (drop)="dropStage(itinerary, items)"
                  (dragend)="endStageDrag()"
                >
                  @if (!routeSlug) {
                    <td (click)="$event.stopPropagation()">
                      <div class="route-assignment-cell">
                        <select [ngModel]="assignmentDraftFor(itinerary).routeId" (ngModelChange)="setAssignmentRoute(itinerary, $event)">
                          <option [ngValue]="null">No route</option>
                          @for (route of routes; track route.id) {
                            <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                          }
                        </select>
                        <button type="button" class="secondary icon-action" [title]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign'" [attr.aria-label]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign'" [disabled]="assigningIds.has(itinerary.id)" (click)="saveAssignment(itinerary)">
                          ✅
                        </button>
                      </div>
                    </td>
                  } @else {
                    <td class="drag-handle-cell" aria-label="Drag to reorder stage">
                      <span class="drag-handle" aria-hidden="true">☰</span>
                    </td>
                    <td>{{ itinerary.stage_number || '-' }}</td>
                  }
                  <td>
                    {{ itinerary.title || 'Untitled itinerary' }}
                    <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                  </td>
                  <td>{{ firstPointName(itinerary) }}</td>
                  <td>{{ lastPointName(itinerary) }}</td>
                  <td>{{ estimatedDistance(itinerary) }}</td>
                  <td class="enabled-column" (click)="$event.stopPropagation()">
                    <input
                      class="enabled-checkbox"
                      type="checkbox"
                      title="Enable"
                      aria-label="Enable"
                      [checked]="itinerary.enabled"
                      (change)="setItineraryEnabled(itinerary, $any($event.target).checked)"
                    />
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="routeSlug ? 7 : 6">No itineraries found.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template>

      <dialog class="metadata-dialog" #newItineraryDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); createItinerary()">
          <header class="metadata-dialog-header">
            <h2>New itinerary</h2>
            <button type="button" class="icon-button" aria-label="Close new itinerary dialog" (click)="closeNewItineraryDialog()">✖</button>
          </header>
          <div class="form-stack">
            <label>
              <span>Language</span>
              <select [(ngModel)]="newItinerary.language_code" name="newItineraryLanguage" required>
                @for (language of languageOptions; track language.code) {
                  <option [value]="language.code">{{ language.label }}</option>
                }
              </select>
            </label>
            <label>
              <span>Title</span>
              <input type="text" [(ngModel)]="newItinerary.title" name="newItineraryTitle" placeholder="Itinerary title" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="newItinerary.description" name="newItineraryDescription" placeholder="Optional description"></textarea>
            </label>
            <label class="checkbox-inline">
              <input type="checkbox" [(ngModel)]="newItinerary.enabled" name="newItineraryEnabled" />
              <span>Enabled</span>
            </label>
            <label>
              <span>Route</span>
              <select [ngModel]="newItinerary.routeId" (ngModelChange)="setNewItineraryRoute($event)" name="newItineraryRoute">
                <option [ngValue]="null">No route</option>
                @for (route of availableRoutes; track route.id) {
                  <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                }
              </select>
            </label>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeNewItineraryDialog()">Cancel</button>
            <button type="submit" class="primary">Create itinerary</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog" #duplicateDialog>
        <form method="dialog" class="metadata-dialog-content">
          <header class="metadata-dialog-header">
            <h2>Itinerary copied</h2>
            <button type="button" class="icon-button" aria-label="Close duplicate confirmation dialog" (click)="closeDuplicateDialog()">✖</button>
          </header>
          <div class="form-stack">
            <p>
              The copy of the itinerary has been created as an unassigned itinerary.
              You can find it in the main itinerary list.
            </p>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeDuplicateDialog()">Stay here</button>
            <button type="button" class="primary" (click)="goToDuplicatedItinerary()">Go to itineraries</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #translationDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveTranslationDialog()">
          <header class="metadata-dialog-header">
            <h2>Edit itinerary translations</h2>
            <button type="button" class="icon-button" aria-label="Close translation dialog" (click)="closeTranslationDialog()">✖</button>
          </header>
          <div class="translation-tabs-panel">
            <div class="translation-tabs" role="tablist" aria-label="Itinerary translation languages">
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
                    <input type="text" [(ngModel)]="translation.language_code" [name]="'itineraryLanguage' + activeTranslationIndex" />
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
                      <input type="text" [(ngModel)]="translation.title" [name]="'itineraryTitle' + activeTranslationIndex" />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea rows="5" [(ngModel)]="translation.description" [name]="'itineraryDescription' + activeTranslationIndex"></textarea>
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
                        <input type="text" [(ngModel)]="translation.title" [name]="'itineraryTitle' + activeTranslationIndex" />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea rows="5" [(ngModel)]="translation.description" [name]="'itineraryDescription' + activeTranslationIndex"></textarea>
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
export class ItineraryListComponent implements AfterViewInit, OnDestroy {
  @ViewChild('newItineraryDialog') private readonly newItineraryDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('duplicateDialog') private readonly duplicateDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  routeSlug: string | null = null;
  routeTitle: string | null = null;
  currentRouteId: number | null = null;
  viewMode: 'flat' | 'grouped' = 'flat';
  readonly languageOptions = LANGUAGE_OPTIONS;
  statusMessage = '';
  statusIsError = false;
  availableRoutes: Route[] = [];
  newItinerary: NewItineraryDraft = { language_code: 'en', title: '', description: '', enabled: true, routeId: null, stageNumber: null };
  duplicatedItinerary: Itinerary | null = null;
  highlightedItineraryId: number | null = null;
  pendingHighlightItineraryId: number | null = null;
  currentItineraries: Itinerary[] = [];
  editingItinerary: Itinerary | null = null;
  translationDrafts: TranslationDraft[] = [];
  activeTranslationIndex = 0;
  readonly duplicatingIds = new Set<number>();
  readonly assigningIds = new Set<number>();
  readonly assignmentDrafts = new Map<number, AssignmentDraft>();
  draggedItineraryId: number | null = null;
  reorderingStages = false;
  previewItinerary: Itinerary | null = null;
  previewMessage = 'Click an itinerary to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewResizeObserver: ResizeObserver | null = null;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('slug'))),
    this.activatedRoute.queryParamMap.pipe(map(params => Number(params.get('highlight')) || null))
  ]).pipe(
    switchMap(([query, , routeSlug, highlightedItineraryId]) => {
      this.routeSlug = routeSlug;
      return combineLatest([
        this.api.listAllRoutes(''),
        this.resolveRoute(routeSlug)
      ]).pipe(
        switchMap(([routes, selectedRoute]) => {
          this.availableRoutes = routes;
          this.currentRouteId = selectedRoute?.id || null;
          this.routeTitle = selectedRoute?.title || null;
          if (routeSlug && !selectedRoute) {
            return of({
              items: [] as Itinerary[],
              routes,
              groups: [] as ItineraryGroup[],
              count: 0,
              error: `Could not find route "${routeSlug}".`
            });
          }
          return this.api.listAllItineraries(query, '', selectedRoute?.id).pipe(
            map(itineraries => {
              const items = this.sortedItineraries(itineraries);
              this.currentItineraries = items;
              return {
                items,
                routes,
                groups: this.groupItineraries(itineraries),
                count: itineraries.length,
                error: ''
              };
            }),
            map(state => {
              this.scheduleHighlight(highlightedItineraryId || this.pendingHighlightItineraryId, state.items);
              return state;
            })
          );
        }),
        catchError(error => of({
          items: [] as Itinerary[],
          routes: [] as Route[],
          groups: [] as ItineraryGroup[],
          count: 0,
          error: `Could not load itineraries. ${error.message}`
        }))
      );
    }),
    startWith({ items: [] as Itinerary[], routes: [] as Route[], groups: [] as ItineraryGroup[], count: 0, error: '' })
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

  selectPreviewItinerary(itinerary: Itinerary): void {
    this.previewItinerary = itinerary;
    this.renderPreviewItinerary();
  }

  openNewItineraryDialog(): void {
    this.newItineraryDialog?.nativeElement.showModal();
  }

  openNewItineraryForCurrentRoute(): void {
    if (this.currentRouteId === null) return;
    this.newItinerary.routeId = this.currentRouteId;
    this.newItinerary.stageNumber = null;
    this.newItineraryDialog?.nativeElement.showModal();
  }

  closeNewItineraryDialog(): void {
    this.newItineraryDialog?.nativeElement.close();
  }

  setNewItineraryRoute(routeId: number | null): void {
    this.newItinerary.routeId = routeId;
    if (routeId === null) {
      this.newItinerary.stageNumber = null;
    } else {
      this.newItinerary.stageNumber = null;
    }
  }

  setNewItineraryStage(stageNumber: string | number | null): void {
    const parsed = Number(stageNumber);
    this.newItinerary.stageNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async createItinerary(): Promise<void> {
    const title = this.newItinerary.title.trim();
    const languageCode = this.newItinerary.language_code.trim();
    if (!languageCode) {
      this.showStatus('Choose the language of the itinerary title and description.', true);
      return;
    }
    if (!title) {
      this.showStatus('Enter an itinerary title before creating it.', true);
      return;
    }

    try {
      const routeId = this.newItinerary.routeId;
      const stageNumber = routeId === null ? null : await this.nextStageNumberForRoute(routeId);
      const itinerary = await firstValueFrom(this.api.createItinerary({
        enabled: this.newItinerary.enabled,
        route: routeId,
        stage_number: stageNumber,
        itinerary_json: { points: [], segments: [] },
        translations: [{
          language_code: languageCode,
          title,
          description: this.newItinerary.description.trim(),
          is_reference: true
        }]
      }));
      this.newItinerary = { language_code: 'en', title: '', description: '', enabled: true, routeId: null, stageNumber: null };
      this.closeNewItineraryDialog();
      this.showStatus(`Created itinerary "${itinerary.title || title}".`, false);
      this.pendingHighlightItineraryId = itinerary.id;
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not create itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async duplicateItinerary(itinerary: Itinerary): Promise<void> {
    const currentTitle = itinerary.title || 'Untitled itinerary';
    const title = window.prompt('New title for duplicated itinerary:', `Copy of ${currentTitle}`)?.trim();
    if (!title) return;

    this.duplicatingIds.add(itinerary.id);
    this.clearStatus();

    try {
      const duplicate = await firstValueFrom(this.api.createItinerary({
        enabled: itinerary.enabled,
        route: null,
        stage_number: null,
        itinerary_json: this.cloneItineraryJson(itinerary.itinerary_json),
        translations: this.duplicateTranslations(itinerary, title)
      }));
      if (this.routeSlug) {
        this.duplicatedItinerary = duplicate;
        this.duplicateDialog?.nativeElement.showModal();
      } else {
        this.showStatus(`Duplicated itinerary as "${duplicate.title || title}".`, false);
      }
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not duplicate itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.duplicatingIds.delete(itinerary.id);
    }
  }

  async toggleItinerary(itinerary: Itinerary): Promise<void> {
    await this.setItineraryEnabled(itinerary, !itinerary.enabled);
  }

  async setItineraryEnabled(itinerary: Itinerary, enabled: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.updateItinerary(itinerary.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deleteItinerary(itinerary: Itinerary): Promise<void> {
    const confirmed = window.confirm(
      `Delete itinerary "${itinerary.title || 'Untitled itinerary'}"? POIs referenced by this itinerary will not be deleted.`
    );
    if (!confirmed) return;

    try {
      await firstValueFrom(this.api.deleteItinerary(itinerary.id));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openTranslationDialog(itinerary: Itinerary): void {
    this.editingItinerary = itinerary;
    this.translationDrafts = this.translationDraftsFrom(itinerary.translations, itinerary.title, itinerary.description);
    this.activeTranslationIndex = Math.max(0, this.translationDrafts.findIndex(translation => translation.is_reference));
    this.translationDialog?.nativeElement.showModal();
  }

  closeTranslationDialog(): void {
    this.translationDialog?.nativeElement.close();
    this.editingItinerary = null;
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
    if (!this.editingItinerary) return;

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every itinerary translation needs a language and title.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.updateItinerary(this.editingItinerary.id, {
        translations
      }));
      this.closeTranslationDialog();
      this.showStatus('Itinerary translations saved.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save translations. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  assignmentDraftFor(itinerary: Itinerary): AssignmentDraft {
    const existing = this.assignmentDrafts.get(itinerary.id);
    if (existing) return existing;

    const draft = {
      routeId: itinerary.route,
      stageNumber: itinerary.stage_number
    };
    this.assignmentDrafts.set(itinerary.id, draft);
    return draft;
  }

  setAssignmentRoute(itinerary: Itinerary, routeId: number | null): void {
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = routeId;
    draft.stageNumber = null;
  }

  async unassignItinerary(itinerary: Itinerary): Promise<void> {
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = null;
    draft.stageNumber = null;
    await this.saveAssignment(itinerary);
  }

  async saveAssignment(itinerary: Itinerary): Promise<void> {
    const draft = this.assignmentDraftFor(itinerary);
    if (draft.routeId === itinerary.route) return;

    const currentRouteName = itinerary.route_title || 'No route';
    const targetRouteName = this.routeNameForId(draft.routeId);
    const confirmationMessage = draft.routeId === null
      ? `Unassign "${itinerary.title || 'Untitled itinerary'}" from "${currentRouteName}"?`
      : `Move "${itinerary.title || 'Untitled itinerary'}" from "${currentRouteName}" to "${targetRouteName}"?`;
    const confirmed = window.confirm(confirmationMessage);
    if (!confirmed) {
      draft.routeId = itinerary.route;
      draft.stageNumber = itinerary.stage_number;
      return;
    }

    this.assigningIds.add(itinerary.id);
    this.clearStatus();

    try {
      if (draft.routeId === null && itinerary.route !== null) {
        await firstValueFrom(this.api.removeItineraryFromRoute(itinerary.route, itinerary.id));
      } else {
        const stageNumber = draft.routeId === null
          ? null
          : draft.routeId === itinerary.route
            ? itinerary.stage_number
            : await this.nextStageNumberForRoute(draft.routeId, itinerary.id);
        await firstValueFrom(this.api.updateItinerary(itinerary.id, {
          route: draft.routeId,
          stage_number: stageNumber
        }));
      }
      this.showStatus('Itinerary route assignment saved.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not assign itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.assigningIds.delete(itinerary.id);
    }
  }

  startStageDrag(itinerary: Itinerary): void {
    if (!this.routeSlug || this.currentRouteId === null) return;
    this.draggedItineraryId = itinerary.id;
  }

  allowStageDrop(event: DragEvent): void {
    if (this.draggedItineraryId === null || this.reorderingStages) return;
    event.preventDefault();
  }

  async dropStage(targetItinerary: Itinerary, visibleItineraries: Itinerary[]): Promise<void> {
    if (this.draggedItineraryId === null || this.currentRouteId === null || this.reorderingStages) return;
    if (this.draggedItineraryId === targetItinerary.id) {
      this.endStageDrag();
      return;
    }

    const orderedItineraries = this.sortedItineraries(visibleItineraries);
    const draggedIndex = orderedItineraries.findIndex(itinerary => itinerary.id === this.draggedItineraryId);
    const targetIndex = orderedItineraries.findIndex(itinerary => itinerary.id === targetItinerary.id);
    if (draggedIndex < 0 || targetIndex < 0) {
      this.endStageDrag();
      return;
    }

    const [draggedItinerary] = orderedItineraries.splice(draggedIndex, 1);
    orderedItineraries.splice(targetIndex, 0, draggedItinerary);

    this.reorderingStages = true;
    this.clearStatus();
    try {
      await firstValueFrom(this.api.reorderRouteItineraries(
        this.currentRouteId,
        orderedItineraries.map((itinerary, index) => ({
          id: itinerary.id,
          stage_number: index + 1
        }))
      ));
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not reorder stages. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.reorderingStages = false;
      this.endStageDrag();
    }
  }

  endStageDrag(): void {
    this.draggedItineraryId = null;
  }

  backQueryParams(): { returnTo: string; returnLabel: string } {
    if (this.routeSlug) {
      return {
        returnTo: `/route/${this.routeSlug}${this.previewItinerary ? `?highlight=${this.previewItinerary.id}` : ''}`,
        returnLabel: this.routeTitle ? `Back to ${this.routeTitle}` : 'Back to route itineraries'
      };
    }
    return {
      returnTo: this.previewItinerary ? `/itineraries?highlight=${this.previewItinerary.id}` : '/itineraries',
      returnLabel: 'Back to itineraries'
    };
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

  private renderPreviewItinerary(): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer || !this.previewItinerary) return;

    this.previewLayer.clearLayers();
    const json = this.itineraryJson(this.previewItinerary);
    const pointCoordinates = this.previewPointCoordinatesByIndex(json.points || []);
    const coordinates = pointCoordinates.filter((point): point is { lat: number; lng: number; label: string } => point !== null);
    const segments = json.segments || [];
    const bounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;

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

    coordinates.forEach((point, index) => {
      L.marker([point.lat, point.lng], {
        icon: this.previewMarkerIcon(index + 1)
      })
        .bindTooltip(`${index + 1}. ${point.label}`, { direction: 'top' })
        .addTo(this.previewLayer);
      bounds.extend([point.lat, point.lng]);
    });

    this.fitPreviewMap(bounds);

    if (coordinates.length === 0 && routeGeometryCount === 0) {
      this.previewMessage = 'This itinerary does not store coordinates yet.';
    } else if (coordinates.length === 0) {
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
        this.previewMap.fitWorld({ animate: false });
      }
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
    });
  }

  private fitPreviewMapToWorld(): void {
    window.requestAnimationFrame(() => {
      if (!this.previewMap) return;
      this.previewMap.invalidateSize(false);
      this.previewMap.fitWorld({ animate: false });
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
    });
  }

  firstPointName(itinerary: Itinerary): string {
    const points = this.itineraryJson(itinerary).points || [];
    return this.pointName(points[0]);
  }

  lastPointName(itinerary: Itinerary): string {
    const points = this.itineraryJson(itinerary).points || [];
    return this.pointName(points[points.length - 1]);
  }

  estimatedDistance(itinerary: Itinerary): string {
    const segments = this.itineraryJson(itinerary).segments || [];
    const totalMeters = segments.reduce((total, segment) => {
      const distance = segment.selectedWalkingRoute?.distanceMeters;
      return Number.isFinite(distance) ? total + Number(distance) : total;
    }, 0);

    if (totalMeters <= 0) return 'Not estimated';
    if (totalMeters >= 1000) return `${(totalMeters / 1000).toFixed(1)} km`;
    return `${Math.round(totalMeters)} m`;
  }

  itineraryRowId(itinerary: Itinerary): string {
    return `itinerary-row-${itinerary.id}`;
  }

  closeDuplicateDialog(): void {
    this.duplicateDialog?.nativeElement.close();
  }

  async goToDuplicatedItinerary(): Promise<void> {
    if (!this.duplicatedItinerary) return;
    const itineraryId = this.duplicatedItinerary.id;
    this.closeDuplicateDialog();
    await this.router.navigate(['/itineraries'], {
      queryParams: { highlight: itineraryId }
    });
  }

  groupKey(group: ItineraryGroup): string {
    return group.routeId === null ? 'unassigned' : String(group.routeId);
  }

  groupsFor(itineraries: Itinerary[]): ItineraryGroup[] {
    return this.groupItineraries(itineraries);
  }

  private resolveRoute(routeSlug: string | null) {
    if (!routeSlug) return of(null);
    return this.api.listAllRoutes(routeSlug).pipe(
      map(routes => routes.find(route => route.slug === routeSlug || String(route.id) === routeSlug) || null)
    );
  }

  private routeNameForId(routeId: number | null): string {
    if (routeId === null) return 'No route';
    const route = this.availableRoutes.find(candidate => candidate.id === routeId);
    return route?.title || `Route ${routeId}`;
  }

  private scheduleHighlight(itineraryId: number | null, itineraries: Itinerary[]): void {
    const itinerary = itineraries.find(candidate => candidate.id === itineraryId);
    if (!itineraryId || !itinerary) return;

    this.highlightedItineraryId = itineraryId;
    this.pendingHighlightItineraryId = null;
    if (this.previewItinerary?.id !== itineraryId) {
      this.selectPreviewItinerary(itinerary);
    }
    window.setTimeout(() => {
      document.getElementById(`itinerary-row-${itineraryId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedItineraryId === itineraryId) {
        this.highlightedItineraryId = null;
      }
    }, 4500);
  }

  private async nextStageNumberForRoute(routeId: number, excludeItineraryId: number | null = null): Promise<number> {
    const routeItineraries = await firstValueFrom(this.api.listAllItineraries('', '', routeId));
    const maxStage = routeItineraries.reduce((max, itinerary) => {
      if (excludeItineraryId !== null && itinerary.id === excludeItineraryId) return max;
      const stageNumber = itinerary.stage_number || 0;
      return stageNumber > max ? stageNumber : max;
    }, 0);
    return maxStage + 1;
  }

  private duplicateTranslations(itinerary: Itinerary, title: string): Array<{
    language_code: string;
    title: string;
    description?: string;
    is_reference?: boolean;
  }> {
    const translations = itinerary.translations.length > 0
      ? itinerary.translations
      : [{ language_code: 'en', title: itinerary.title || '', description: itinerary.description || '', is_reference: true }];
    let hasEnglishTranslation = false;

    const duplicatedTranslations = translations
      .filter(translation => translation.language_code)
      .map(translation => {
        const languageCode = translation.language_code;
        const isEnglish = languageCode.toLowerCase() === 'en';
        hasEnglishTranslation = hasEnglishTranslation || isEnglish;
        return {
          language_code: languageCode,
          title: isEnglish ? title : this.translationTitle(translation, itinerary),
          description: translation.description || '',
          is_reference: Boolean(translation.is_reference)
        };
      });

    if (!hasEnglishTranslation) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: itinerary.description || '',
        is_reference: !duplicatedTranslations.some(translation => translation.is_reference)
      });
    }
    if (!duplicatedTranslations.some(translation => translation.is_reference) && duplicatedTranslations.length > 0) {
      duplicatedTranslations[0].is_reference = true;
    }

    return duplicatedTranslations;
  }

  private translationTitle(translation: Translation, itinerary: Itinerary): string {
    return translation.title || itinerary.title || 'Untitled itinerary';
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

  private itineraryJson(itinerary: Itinerary): ItineraryJsonExport {
    return itinerary.itinerary_json && typeof itinerary.itinerary_json === 'object'
      ? itinerary.itinerary_json as ItineraryJsonExport
      : {};
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

  private cloneItineraryJson(itineraryJson: unknown): unknown {
    if (typeof structuredClone === 'function') {
      return structuredClone(itineraryJson);
    }
    return JSON.parse(JSON.stringify(itineraryJson));
  }

  private sortedItineraries(itineraries: Itinerary[]): Itinerary[] {
    return [...itineraries].sort((left, right) => {
      const leftStage = left.stage_number ?? Number.MAX_SAFE_INTEGER;
      const rightStage = right.stage_number ?? Number.MAX_SAFE_INTEGER;
      return leftStage - rightStage || left.id - right.id;
    });
  }

  private groupItineraries(itineraries: Itinerary[]): ItineraryGroup[] {
    const groups = new Map<string, ItineraryGroup>();

    for (const itinerary of itineraries) {
      const key = itinerary.route === null ? 'unassigned' : String(itinerary.route);
      const existingGroup = groups.get(key);
      const group = existingGroup || {
        routeId: itinerary.route,
        title: itinerary.route ? itinerary.route_title || `Route ${itinerary.route}` : 'Unassigned itineraries',
        slug: itinerary.route_slug,
        items: []
      };
      group.items.push(itinerary);
      groups.set(key, group);
    }

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        items: this.sortedItineraries(group.items)
      }))
      .sort((left, right) => {
        if (left.routeId === null) return 1;
        if (right.routeId === null) return -1;
        return left.title.localeCompare(right.title);
      });
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
