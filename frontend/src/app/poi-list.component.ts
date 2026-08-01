import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, finalize, firstValueFrom, forkJoin, map, Observable, of, startWith, switchMap } from 'rxjs';

import { ApiService, Category, Itinerary, Poi, PoiMapClusterResult, PoiMapResponse, PoiMedia, Translation } from './api.service';
import { MediaManagerDialogComponent } from './media-manager-dialog.component';

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
  slug: string;
  is_reference: boolean;
}

interface PoiDraft {
  enabled: boolean;
  country_code: string;
  website: string;
  phone: string;
  email: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  category_ids: number[];
}

interface CategoryTranslationDraft {
  language_code: string;
  name: string;
}

interface CategoryDraft {}

interface ItineraryPointExport {
  type?: string;
  id?: number | string;
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

interface ItinerarySegmentExport {
  bufferDistanceMeters?: number;
  selectedWalkingRoute?: {
    geometry?: unknown;
  } | null;
}

interface ItineraryJsonExport {
  points?: ItineraryPointExport[];
  segments?: ItinerarySegmentExport[];
  poiIds?: Array<number | string>;
}

interface PoiGroup {
  key: string;
  title: string;
  items: Poi[];
}

interface PoiListState {
  items: Poi[];
  count: number;
  groups: PoiGroup[];
  error: string;
}

type PoiSortKey = 'title' | 'country' | 'draft' | 'media';
type SortDirection = 'asc' | 'desc';
type PoiMapMode = PoiMapResponse['mode'];

const MAX_DISPLAYED_CLUSTER_POIS = 50;

declare const L: any;
declare const turf: any;

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule, NgTemplateOutlet, RouterLink, MediaManagerDialogComponent],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>{{ itineraryId ? itineraryTitle || 'Itinerary POIs' : 'POIs' }}</h1>
          <p>
            @if (itineraryId) {
              Browse POIs included in the itinerary and nearby POIs in its segment buffer zones.
            } @else {
              Browse and manage points of interest from the backend API.
            }
          </p>
        </div>
        @if (itineraryId) {
          @if (currentItinerary) {
            <div class="publication-inline-switch centered-publication-switch" aria-label="Itinerary state">
              <span>State</span>
              <div class="publication-inline-toggle">
                <button type="button" [class.active]="!currentItinerary.enabled" (click)="setCurrentItineraryState(false)">Draft</button>
                <button type="button" [class.active]="currentItinerary.enabled" (click)="setCurrentItineraryState(true)">Public (read-only)</button>
              </div>
            </div>
          }
          <div class="list-actions header-end-actions">
            <a class="secondary" [routerLink]="backLink">{{ backLabel }}</a>
          </div>
        } @else {
          <div class="list-actions">
            <button type="button" class="secondary" (click)="openCategoryManagerDialog()">Manage categories</button>
            <a class="primary" title="New POI" aria-label="New POI" routerLink="/pois/new" [queryParams]="poiEditorReturnQueryParams()">New POI</a>
          </div>
        }
      </header>
      <app-media-manager-dialog #mediaManagerDialog (saved)="refreshList()"></app-media-manager-dialog>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search POIs by title or category"
          [ngModel]="query"
          (ngModelChange)="updateQueryFilter($event)"
        />
        <select
          class="toolbar-select"
          aria-label="Filter by category"
          [(ngModel)]="selectedCategory"
          (ngModelChange)="updateCategoryFilter($event)"
        >
          <option value="">All categories</option>
          @for (category of availableCategories; track category.id) {
            <option [value]="category.id">{{ category.name || category.slug }}</option>
          }
        </select>
        <select
          class="toolbar-select"
          aria-label="Filter by country"
          [(ngModel)]="selectedCountry"
          (ngModelChange)="updateCountryFilter($event)"
        >
          <option value="">All countries</option>
          @for (countryCode of availableCountries; track countryCode) {
            <option [value]="countryCode">{{ countryName(countryCode) }}</option>
          }
        </select>
        @if (loadingPoiInfo) {
          <span class="toolbar-loading-indicator" role="status" aria-live="polite">
            <span class="toolbar-loading-spinner" aria-hidden="true"></span>
            <span>Downloading POI info</span>
          </span>
        } @else {
          <span class="toolbar-result-count">Found {{ poiTotalCount }} POIs</span>
        }
        @if (itineraryId) {
          @if (currentItinerary && !currentItinerary.enabled) {
            <a class="secondary toolbar-action" [routerLink]="['/itineraries', itineraryId, 'edit']" [queryParams]="itineraryEditorReturnQueryParams()">
              Open in editor
            </a>
          } @else {
            <button type="button" class="secondary toolbar-action" disabled>Open in editor</button>
          }
          <button type="button" class="secondary toolbar-action" [disabled]="!currentItinerary || currentItinerary.enabled" (click)="openItineraryMediaDialog()">Manage itinerary metadata, translations and media</button>
        }
      </div>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <ng-template #poiTable let-items="items">
            <div class="table-wrap">
              <table class="resource-table">
                <thead>
                  <tr>
                    <th class="poi-name-column">
                      <button type="button" class="sortable-header" (click)="togglePoiSort('title')">
                        <span>POI</span>
                        <span aria-hidden="true">{{ poiSortIndicator('title') }}</span>
                      </button>
                    </th>
                    <th>Included in</th>
                    <th>Categories</th>
                    <th>
                      <button type="button" class="sortable-header" (click)="togglePoiSort('media')">
                        <span>Media</span>
                        <span aria-hidden="true">{{ poiSortIndicator('media') }}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" class="sortable-header" (click)="togglePoiSort('country')">
                        <span>Country</span>
                        <span aria-hidden="true">{{ poiSortIndicator('country') }}</span>
                      </button>
                    </th>
                    <th class="enabled-column">
                      <button type="button" class="sortable-header" (click)="togglePoiSort('draft')">
                        <span>Draft?</span>
                        <span aria-hidden="true">{{ poiSortIndicator('draft') }}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (poi of items; track poi.id) {
                    <tr
                      [attr.id]="poiRowId(poi)"
                      [class.highlight-row]="highlightedPoiId === poi.id"
                      [class.preview-selected-row]="previewPoi?.id === poi.id"
                      (click)="queuePoiRowSelection(poi)"
                      (dblclick)="openPoiInfoAndMedia(poi)"
                    >
                      <td class="poi-name-column">
                        <strong>{{ poi.title || 'Untitled POI' }}</strong>
                        <p class="description-preview">{{ poi.description || 'No description' }}</p>
                      </td>
                      <td>
                        <div class="route-membership-badges">
                          @for (inclusion of poi.itinerary_inclusions; track inclusion.itinerary) {
                            <a
                              class="route-membership-badge poi-inclusion-badge"
                              [routerLink]="['/itineraries', inclusion.itinerary, 'pois']"
                              [queryParams]="poiInclusionNavigationQueryParams(poi)"
                              [title]="poiInclusionTooltip(inclusion)"
                              (click)="$event.stopPropagation()"
                            >
                              <span class="inclusion-badge-label">{{ inclusion.route_title || 'No route' }}</span>
                              @if (inclusion.stage_number !== null) {
                                <span>{{ inclusion.stage_number }}</span>
                              }
                            </a>
                          } @empty {
                            <span class="muted">No itineraries</span>
                          }
                        </div>
                      </td>
                      <td>
                        @if (poi.categories.length) {
                          <div class="chip-list">
                            @for (category of poi.categories; track category.id) {
                              <span class="small-chip" [title]="category.name || category.slug">{{ category.name || category.slug }}</span>
                            }
                          </div>
                        } @else {
                          <span class="muted">No categories</span>
                        }
                      </td>
                      <td>{{ poi.media.length }}</td>
                      <td>{{ countryName(poi.country_code) }}</td>
                      <td class="enabled-column">
                        {{ poi.enabled ? 'No' : 'Yes' }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6">{{ emptyPoiListMessage() }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </ng-template>

          <div class="preview-layout poi-preview-layout">
            <div class="preview-list">
              @if (state.groups.length) {
                <div class="route-group-list poi-group-list">
                  @for (group of state.groups; track group.key) {
                    <section class="route-group">
                      <header class="route-group-header">
                        <button type="button" class="route-group-toggle" (click)="togglePoiGroup(group.key)">
                          <span class="route-group-caret" aria-hidden="true">{{ isPoiGroupCollapsed(group.key) ? '▶' : '▼' }}</span>
                          <span>{{ group.title }}</span>
                          <span>{{ group.items.length }} {{ group.items.length === 1 ? 'POI' : 'POIs' }}</span>
                        </button>
                      </header>
                      @if (!isPoiGroupCollapsed(group.key)) {
                        <ng-container *ngTemplateOutlet="poiTable; context: { items: group.items }"></ng-container>
                      }
                    </section>
                  }
                </div>
              } @else {
                <ng-container *ngTemplateOutlet="poiTable; context: { items: itineraryId ? state.items : displayedPois }"></ng-container>
              }
            </div>
            <aside class="preview-panel" aria-label="POI map preview">
              <header>
                <h2>Map preview</h2>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
              <div class="preview-actions" aria-label="POI preview actions">
                <button type="button" class="secondary preview-action" (click)="fitPreviewToCurrentPois()">
                  <span class="preview-action-icon" aria-hidden="true">🎯</span>
                  <span>Fit view</span>
                </button>

                @if (previewPoi && !previewPoi.enabled) {
                  <button type="button" class="secondary preview-action" (click)="setPoiEnabled(previewPoi, true)">
                    <span class="preview-action-icon" aria-hidden="true">🌐</span>
                    <span>Make public</span>
                  </button>
                }
                @if (previewPoi && previewPoi.enabled) {
                  <button type="button" class="secondary preview-action" (click)="setPoiEnabled(previewPoi, false)">
                    <span class="preview-action-icon" aria-hidden="true">✎</span>
                    <span>Turn to draft</span>
                  </button>
                }
                @if (previewPoi) {
                  <a class="secondary preview-action" [routerLink]="['/pois', previewPoi.id, 'edit']" [queryParams]="poiEditorReturnQueryParams(previewPoi)">
                    <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                    <span>{{ previewPoi.enabled ? 'View info and media' : 'Manage metadata, media and translations' }}</span>
                  </a>
                  <button type="button" class="secondary preview-action" [disabled]="duplicatingPoiIds.has(previewPoi.id)" (click)="duplicatePoi(previewPoi)">
                    <span class="preview-action-icon" aria-hidden="true">📄</span>
                    <span>{{ duplicatingPoiIds.has(previewPoi.id) ? 'Duplicating...' : 'Duplicate' }}</span>
                  </button>
                  @if (!previewPoi.enabled) {
                    <button type="button" class="secondary preview-action danger-action" (click)="deletePoi(previewPoi)">
                      <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                      <span>Delete POI</span>
                    </button>
                  }
                }
              </div>
            </aside>
          </div>
        }
      }

      <dialog class="metadata-dialog wide" #metadataDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveMetadataDialog()">
          <header class="metadata-dialog-header">
            <h2>{{ editingPoi ? 'Edit POI metadata' : 'New POI' }}</h2>
            <button type="button" class="icon-button" aria-label="Close metadata dialog" (click)="closeMetadataDialog()">✖</button>
          </header>

          <div class="metadata-scroll">
            <div class="form-grid poi-metadata-grid">
              <label>
                <span>Country</span>
                <input type="text" maxlength="2" [(ngModel)]="poiDraft.country_code" name="poiCountryCode" placeholder="ES" />
              </label>
              <label>
                <span>Latitude</span>
                <input type="number" step="0.000001" [(ngModel)]="poiDraft.gps_latitude" name="poiLatitude" />
              </label>
              <label>
                <span>Longitude</span>
                <input type="number" step="0.000001" [(ngModel)]="poiDraft.gps_longitude" name="poiLongitude" />
              </label>
              <label class="checkbox-inline poi-enabled-edit">
                <input type="checkbox" [(ngModel)]="poiDraft.enabled" name="poiEnabled" />
                <span>Enabled</span>
              </label>
            </div>

            <label class="metadata-full-row">
              <span>Website</span>
              <input type="url" [(ngModel)]="poiDraft.website" name="poiWebsite" placeholder="https://example.com" />
            </label>
            <label>
              <span>Phone</span>
              <input type="tel" [(ngModel)]="poiDraft.phone" name="poiPhone" placeholder="+34 000 000 000" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" [(ngModel)]="poiDraft.email" name="poiEmail" placeholder="info@example.com" />
            </label>

            <label class="metadata-full-row">
              <span>Categories</span>
              <select multiple [(ngModel)]="poiDraft.category_ids" name="poiCategories">
                @for (category of availableCategories; track category.id) {
                  <option [ngValue]="category.id">{{ category.name || category.slug }}</option>
                }
              </select>
            </label>

            <section class="translation-list poi-translation-list">
              @for (translation of translationDrafts; track $index) {
                <div class="translation-row poi-translation-row">
                  <label class="reference-radio">
                    <span>Reference</span>
                    <input
                      type="radio"
                      name="poiReferenceTranslation"
                      [checked]="translation.is_reference"
                      (change)="setReferenceTranslation($index)"
                    />
                  </label>
                  <label>
                    <span>Language</span>
                    <input type="text" [(ngModel)]="translation.language_code" [name]="'poiLanguage' + $index" />
                  </label>
                  <label>
                    <span>Title</span>
                    <input type="text" [(ngModel)]="translation.title" [name]="'poiTitle' + $index" />
                  </label>
                  <label>
                    <span>Slug</span>
                    <input type="text" [(ngModel)]="translation.slug" [name]="'poiSlug' + $index" />
                  </label>
                  <label class="translation-description">
                    <span>Description</span>
                    <textarea rows="3" [(ngModel)]="translation.description" [name]="'poiDescription' + $index"></textarea>
                  </label>
                </div>
              }
              <button type="button" class="secondary" (click)="addTranslationDraft()">Add translation</button>
            </section>
          </div>

          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeMetadataDialog()">Cancel</button>
            <button type="submit" class="primary">{{ editingPoi ? 'Save metadata' : 'Create POI' }}</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #categoryManagerDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveCategoryDialog()">
          <header class="metadata-dialog-header">
            <h2>Manage categories</h2>
            <button type="button" class="icon-button" aria-label="Close category manager" (click)="closeCategoryManagerDialog()">✖</button>
          </header>

          <div class="metadata-scroll category-manager-grid">
            <section class="category-list-panel">
              <div class="category-manager-actions">
                <button type="button" class="primary" (click)="startNewCategory()">New category</button>
              </div>
              <div class="category-manager-list">
                @for (category of availableCategories; track category.id) {
                  <button
                    type="button"
                    class="category-select-button"
                    [class.active]="editingCategory?.id === category.id"
                    (click)="selectCategoryForEditing(category)"
                  >
                    {{ category.name || category.slug }}
                  </button>
                } @empty {
                  <p class="muted">No categories found.</p>
                }
              </div>
            </section>

            <section class="category-editor-panel">
              <section class="translation-list poi-translation-list">
                @for (translation of categoryTranslationDrafts; track $index) {
                  <div class="category-translation-row">
                    <label>
                      <span>Language</span>
                      <input type="text" [(ngModel)]="translation.language_code" [name]="'categoryLanguage' + $index" />
                    </label>
                    <label>
                      <span>Name</span>
                      <input type="text" [(ngModel)]="translation.name" [name]="'categoryName' + $index" />
                    </label>
                  </div>
                }
                <button type="button" class="secondary" (click)="addCategoryTranslationDraft()">Add translation</button>
              </section>

              @if (categoryDialogStatusMessage) {
                <p class="dialog-status" [class.error]="categoryDialogStatusIsError">{{ categoryDialogStatusMessage }}</p>
              }

              @if (editingCategory) {
                <section class="category-danger-zone">
                  <h3>Merge or delete</h3>
                  <div class="category-merge-row">
                    <select [(ngModel)]="mergeTargetCategoryId" name="mergeTargetCategory">
                      <option [ngValue]="null">Merge into...</option>
                      @for (category of mergeTargetCategories(); track category.id) {
                        <option [ngValue]="category.id">{{ category.name || category.slug }}</option>
                      }
                    </select>
                    <button type="button" class="secondary" (click)="mergeSelectedCategory()">Merge</button>
                  </div>
                  <button type="button" class="secondary danger-action" (click)="deleteSelectedCategory()">Delete category</button>
                </section>
              }
            </section>
          </div>

          <footer class="metadata-dialog-footer">
            <button type="submit" class="primary">{{ editingCategory ? 'Save category' : 'Create category' }}</button>
            <button type="button" class="secondary" (click)="closeCategoryManagerDialog()">Close</button>
          </footer>
        </form>
      </dialog>
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class PoiListComponent implements AfterViewInit, OnDestroy {
  @ViewChild('metadataDialog') private readonly metadataDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('categoryManagerDialog') private readonly categoryManagerDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;
  @ViewChild('mediaManagerDialog') private readonly mediaManagerDialog?: MediaManagerDialogComponent;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  readonly mapView$ = new BehaviorSubject(0);
  query = '';
  itineraryId: string | null = null;
  itineraryTitle: string | null = null;
  itineraryPoiIds: string[] = [];
  currentItinerary: Itinerary | null = null;
  selectedCategory = '';
  selectedCountry = '';
  poiSortKey: PoiSortKey = 'title';
  poiSortDirection: SortDirection = 'asc';
  statusMessage = '';
  statusIsError = false;
  loadingPoiInfo = false;
  availableCategories: Category[] = [];
  availableCountries: string[] = [];
  backLink: UrlTree | string = '/itineraries';
  backLabel = 'Back to itineraries';
  editingPoi: Poi | null = null;
  poiDraft: PoiDraft = this.emptyPoiDraft();
  translationDrafts: TranslationDraft[] = [];
  editingCategory: Category | null = null;
  categoryDraft: CategoryDraft = this.emptyCategoryDraft();
  categoryTranslationDrafts: CategoryTranslationDraft[] = [];
  categoryDialogStatusMessage = '';
  categoryDialogStatusIsError = false;
  mergeTargetCategoryId: number | null = null;
  readonly selectedPoiIds = new Set<number>();
  readonly duplicatingPoiIds = new Set<number>();
  readonly collapsedPoiGroupKeys = new Set<string>();
  currentPois: Poi[] = [];
  currentPoiGroups: PoiGroup[] = [];
  displayedPois: Poi[] = [];
  mapClusters: PoiMapClusterResult[] = [];
  mapResponseMode: PoiMapMode = 'pois';
  poiTotalCount = 0;
  highlightedPoiId: number | null = null;
  pendingHighlightPoiId: number | null = null;
  previewPoi: Poi | null = null;
  previewMessage = 'Click a POI to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewClusterLayer: any = null;
  private readonly previewMarkerPois = new Map<any, Poi>();
  private previewResizeObserver: ResizeObserver | null = null;
  private previewFitRequestId = 0;
  private displayedPoisUpdateRequestId = 0;
  private poiRowClickTimer: number | null = null;
  private selectedPreviewFitLocked = false;
  private hasShownInitialWorldMap = false;
  private lastPoiMapViewKey = '';
  private suppressPoiMapRefreshUntil = 0;
  private fitPoisAfterNextFetch = false;
  private fitInitialPoisAfterFirstFetch = true;

  constructor() {
    this.restoreFiltersFromQueryParams();
  }

  readonly state$: Observable<PoiListState> = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.mapView$.pipe(debounceTime(200)),
    this.activatedRoute.paramMap.pipe(map(params => params.get('id')))
  ]).pipe(
    switchMap(([query, , , itineraryId]) => {
      this.loadingPoiInfo = true;
      this.itineraryId = itineraryId;
      if (!itineraryId && !this.hasShownInitialWorldMap) {
        this.hasShownInitialWorldMap = true;
        this.showWorldMapWhilePoisLoad();
      }
      const itinerary$ = itineraryId ? this.api.getItinerary(itineraryId) : of(null);
      return combineLatest([
        itinerary$,
        this.api.listAllCategories(),
        this.api.listPoiCountries()
      ]).pipe(
        switchMap(([itinerary, categories, countries]) => {
          this.availableCategories = categories;
          this.availableCountries = countries;
          this.currentItinerary = itinerary;
          this.itineraryTitle = itinerary?.title || null;
          this.itineraryPoiIds = itinerary ? this.poiIdsForItinerary(itinerary.itinerary_json) : [];
          if (itineraryId && itinerary) {
            return this.fetchItineraryPoiGroups(itinerary, query).pipe(
              map(result => {
                this.currentPoiGroups = result.groups;
                this.currentPois = result.items;
                this.displayedPois = result.items;
                this.mapClusters = [];
                this.mapResponseMode = 'pois';
                this.poiTotalCount = result.items.length;
                this.pruneSelectedPois(this.currentPois);
                this.keepSingleSelectedPoi();
                this.schedulePoiHighlight(this.pendingHighlightPoiId, this.currentPois);
                if (this.selectedPoiIds.size > 0) {
                  this.renderSelectedPoiPreviewIfNeeded(!this.selectedPreviewFitLocked);
                } else {
                  this.renderVisiblePoisPreview(this.currentPois);
                }
                return { items: this.currentPois, count: this.currentPois.length, groups: this.currentPoiGroups, error: '' };
              })
            );
          }
          return this.fetchAllPois(query).pipe(
            map(result => {
              this.currentPoiGroups = [];
              this.currentPois = this.sortedPois(result.pois);
              this.displayedPois = this.currentPois;
              this.mapClusters = result.clusters;
              this.mapResponseMode = result.mode;
              this.poiTotalCount = result.count;
              this.pruneSelectedPois(this.currentPois);
              this.keepSingleSelectedPoi();
              this.schedulePoiHighlight(this.pendingHighlightPoiId, this.currentPois);
              const shouldFitPois = this.fitPoisAfterNextFetch || this.fitInitialPoisAfterFirstFetch;
              this.fitPoisAfterNextFetch = false;
              this.fitInitialPoisAfterFirstFetch = false;
              if (shouldFitPois) {
                this.selectedPoiIds.clear();
                this.selectedPreviewFitLocked = false;
                this.previewPoi = null;
              }
              if (this.selectedPoiIds.size > 0) {
                this.renderSelectedPoiPreviewIfNeeded(!this.selectedPreviewFitLocked);
              } else {
                this.renderVisiblePoisPreview(this.currentPois, shouldFitPois);
              }
              return { items: this.currentPois, count: this.poiTotalCount, groups: [] as PoiGroup[], error: '' };
            })
          );
        }),
        catchError(error => {
          this.currentPois = [];
          this.currentPoiGroups = [];
          this.displayedPois = [];
          this.mapClusters = [];
          this.mapResponseMode = 'pois';
          this.currentItinerary = null;
          this.poiTotalCount = 0;
          return of({ items: [] as Poi[], count: 0, groups: [] as PoiGroup[], error: `Could not load POIs. ${error.message}` });
        }),
        finalize(() => {
          this.loadingPoiInfo = false;
        })
      );
    }),
    startWith({ items: [] as Poi[], count: 0, groups: [] as PoiGroup[], error: '' })
  );

  ngAfterViewInit(): void {
    const returnTo = this.activatedRoute.snapshot.queryParamMap.get('returnTo');
    const returnLabel = this.activatedRoute.snapshot.queryParamMap.get('returnLabel');
    if (returnTo?.startsWith('/')) {
      this.backLink = this.router.parseUrl(returnTo);
    }
    if (returnLabel) {
      this.backLabel = returnLabel;
    }
    this.initializePreviewMap();
  }

  ngOnDestroy(): void {
    if (this.poiRowClickTimer !== null) {
      window.clearTimeout(this.poiRowClickTimer);
      this.poiRowClickTimer = null;
    }
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  selectPreviewPoi(poi: Poi): void {
    this.selectedPoiIds.clear();
    this.selectedPoiIds.add(poi.id);
    this.selectedPreviewFitLocked = false;
    this.previewPoi = poi;
    this.suppressPoiMapRefreshForProgrammaticFocus();
    this.renderSelectedPoiPreviewIfNeeded(true);
  }

  queuePoiRowSelection(poi: Poi): void {
    if (this.poiRowClickTimer !== null) {
      window.clearTimeout(this.poiRowClickTimer);
    }
    this.poiRowClickTimer = window.setTimeout(() => {
      this.poiRowClickTimer = null;
      this.togglePoiRowPreview(poi);
    }, 180);
  }

  togglePoiRowPreview(poi: Poi): void {
    if (this.previewPoi?.id === poi.id) {
      this.clearPoiPreview(true);
      return;
    }
    this.selectPreviewPoi(poi);
  }

  clearPoiPreview(shouldFit = true): void {
    this.selectedPoiIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewPoi = null;
                this.renderVisiblePoisPreview(this.currentPois, false);
  }

  togglePoiGroup(key: string): void {
    if (this.collapsedPoiGroupKeys.has(key)) {
      this.collapsedPoiGroupKeys.delete(key);
    } else {
      this.collapsedPoiGroupKeys.add(key);
    }
  }

  isPoiGroupCollapsed(key: string): boolean {
    return this.collapsedPoiGroupKeys.has(key);
  }

  fitPreviewToCurrentPois(): void {
    if (this.previewPoi) {
      this.renderSelectedPoiPreviewIfNeeded(true);
    } else {
      this.renderVisiblePoisPreview(this.currentPois);
    }
  }

  selectPoiFromPreviewMarker(poi: Poi): void {
    this.selectPreviewPoi(poi);
    this.highlightedPoiId = poi.id;
    window.setTimeout(() => {
      document.getElementById(this.poiRowId(poi))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedPoiId === poi.id) {
        this.highlightedPoiId = null;
      }
    }, 2500);
  }

  private schedulePoiHighlight(poiId: number | null, pois: Poi[]): void {
    const poi = pois.find(candidate => candidate.id === poiId);
    if (!poiId || !poi) return;

    this.pendingHighlightPoiId = null;
    this.highlightedPoiId = poiId;
    this.selectedPoiIds.clear();
    this.selectedPoiIds.add(poiId);
    this.previewPoi = poi;
    this.suppressPoiMapRefreshForProgrammaticFocus();
    window.setTimeout(() => {
      document.getElementById(this.poiRowId(poi))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedPoiId === poiId) {
        this.highlightedPoiId = null;
      }
    }, 3000);
  }

  centerPreviewOnPoi(poi: Poi): void {
    if (this.poiRowClickTimer !== null) {
      window.clearTimeout(this.poiRowClickTimer);
      this.poiRowClickTimer = null;
    }
    if (!Number.isFinite(poi.gps_latitude) || !Number.isFinite(poi.gps_longitude)) {
      this.showStatus('This POI does not have valid coordinates.', true);
      return;
    }
    this.initializePreviewMap();
    this.previewMap?.invalidateSize(false);
    this.previewMap?.setView([poi.gps_latitude, poi.gps_longitude], Math.max(this.previewMap.getZoom() || 0, 14), {
      animate: false
    });
  }

  togglePoiSort(key: PoiSortKey): void {
    if (this.poiSortKey === key) {
      this.poiSortDirection = this.poiSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.poiSortKey = key;
      this.poiSortDirection = 'asc';
    }
    this.currentPois.splice(0, this.currentPois.length, ...this.sortedPois(this.currentPois));
    this.displayedPois = this.sortedPois(this.displayedPois);
    this.currentPoiGroups.forEach(group => {
      group.items.splice(0, group.items.length, ...this.sortedPois(group.items));
    });
    if (this.selectedPoiIds.size > 0) {
      this.renderSelectedPoiPreviewIfNeeded(false);
    } else {
      this.renderVisiblePoisPreview(this.currentPois);
    }
  }

  poiSortIndicator(key: PoiSortKey): string {
    if (this.poiSortKey !== key) return '';
    return this.poiSortDirection === 'asc' ? '▲' : '▼';
  }

  emptyPoiListMessage(): string {
    if (!this.itineraryId && this.mapClusters.length > 0) {
      return 'POIs are grouped in clusters. Zoom in to start discerning individual POIs.';
    }
    return this.currentPois.length ? 'No POIs visible in the current map view.' : 'No POIs found.';
  }

  poiInclusionTooltip(inclusion: Poi['itinerary_inclusions'][number]): string {
    const routeTitle = inclusion.route_title || 'No route';
    const itineraryTitle = inclusion.itinerary_title || `Itinerary ${inclusion.itinerary}`;
    const stage = inclusion.stage_number === null ? '' : `\nStage: ${inclusion.stage_number}`;
    return `Route: ${routeTitle}\nItinerary: ${itineraryTitle}${stage}`;
  }

  poiInclusionNavigationQueryParams(poi: Poi): { returnTo: string; returnLabel: string; highlight: string } {
    return {
      returnTo: this.poiRootReturnUrl(poi.id),
      returnLabel: 'Back to POIs',
      highlight: String(poi.id)
    };
  }

  openPoiInfoAndMedia(poi: Poi): void {
    if (this.poiRowClickTimer !== null) {
      window.clearTimeout(this.poiRowClickTimer);
      this.poiRowClickTimer = null;
    }
    void this.router.navigate(['/pois', poi.id, 'edit'], {
      queryParams: this.poiEditorReturnQueryParams(poi)
    });
  }

  openItineraryMediaDialog(): void {
    if (!this.currentItinerary || this.currentItinerary.enabled) return;
    this.mediaManagerDialog?.open('itinerary', this.currentItinerary);
  }

  async setCurrentItineraryState(enabled: boolean): Promise<void> {
    if (!this.currentItinerary || this.currentItinerary.enabled === enabled) return;
    if (!this.confirmItineraryStateChange(this.currentItinerary, enabled)) return;

    try {
      const itinerary = await firstValueFrom(this.api.updateItinerary(this.currentItinerary.id, { enabled }));
      this.currentItinerary = itinerary;
      this.clearStatus();
      this.refreshList();
    } catch (error) {
      this.showStatus(`Could not update itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  refreshList(): void {
    this.refresh$.next(this.refresh$.value + 1);
  }

  updateQueryFilter(value: string): void {
    this.query = value;
    this.fitPoisAfterNextFetch = true;
    this.query$.next(value);
    this.syncFiltersToUrl();
  }

  updateCategoryFilter(value: string): void {
    this.selectedCategory = value;
    this.fitPoisAfterNextFetch = true;
    this.refresh$.next(this.refresh$.value + 1);
    this.syncFiltersToUrl();
  }

  updateCountryFilter(value: string): void {
    this.selectedCountry = value;
    this.fitPoisAfterNextFetch = true;
    this.refresh$.next(this.refresh$.value + 1);
    this.syncFiltersToUrl();
  }

  async setPoiEnabled(poi: Poi, enabled: boolean): Promise<void> {
    if (!this.confirmPoiDraftChange([poi], enabled)) return;
    try {
      await firstValueFrom(this.api.updatePoi(poi.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  private confirmPoiDraftChange(pois: Poi[], enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    const itemLabel = pois.length === 1 ? 'POI' : 'POIs';
    let message = `Really ${action} ${pois.length} selected ${itemLabel}?`;
    if (!enabled) {
      message += '\n\nItineraries containing the selected POI(s), and routes containing those itineraries, will also be turned to draft.';
    }
    return window.confirm(message);
  }

  private confirmItineraryStateChange(itinerary: Itinerary, enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    let message = `Really ${action} itinerary "${itinerary.title || 'Untitled itinerary'}"?`;
    if (enabled) {
      message += '\n\nDraft POIs included in this itinerary can also be made public.';
    } else {
      message += '\n\nRoutes containing this itinerary can also be turned to draft.';
    }
    return window.confirm(message);
  }

  async duplicatePoi(poi: Poi): Promise<void> {
    const currentTitle = poi.title || 'Untitled POI';
    const title = window.prompt('New title for duplicated POI:', `Copy of ${currentTitle}`)?.trim();
    if (!title) return;

    this.duplicatingPoiIds.add(poi.id);
    this.clearStatus();
    try {
      const duplicate = await firstValueFrom(this.api.createPoi({
        enabled: false,
        country_code: poi.country_code || '',
        gps_latitude: poi.gps_latitude,
        gps_longitude: poi.gps_longitude,
        website: poi.website || '',
        phone: poi.phone || '',
        email: poi.email || '',
        category_ids: poi.categories.map(category => category.id),
        translations: this.duplicatePoiTranslations(poi, title),
        media: this.duplicatePoiMedia(poi.media || [], poi.images || [])
      }));
      this.selectedPoiIds.clear();
      this.selectedPoiIds.add(duplicate.id);
      this.previewPoi = duplicate;
      this.pendingHighlightPoiId = duplicate.id;
      this.showStatus(`Duplicated POI as "${duplicate.title || title}".`, false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not duplicate POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.duplicatingPoiIds.delete(poi.id);
    }
  }

  openNewPoiDialog(): void {
    this.editingPoi = null;
    this.poiDraft = this.emptyPoiDraft();
    this.translationDrafts = [{
      language_code: 'en',
      title: '',
      description: '',
      slug: '',
      is_reference: true
    }];
    this.metadataDialog?.nativeElement.showModal();
  }

  openMetadataDialog(poi: Poi): void {
    this.editingPoi = poi;
    this.poiDraft = {
      enabled: poi.enabled,
      country_code: poi.country_code || '',
      website: poi.website || '',
      phone: poi.phone || '',
      email: poi.email || '',
      gps_latitude: poi.gps_latitude,
      gps_longitude: poi.gps_longitude,
      category_ids: poi.categories.map(category => category.id)
    };
    this.translationDrafts = this.translationDraftsFrom(poi.translations, poi.title, poi.description, poi.slug);
    this.metadataDialog?.nativeElement.showModal();
  }

  closeMetadataDialog(): void {
    this.metadataDialog?.nativeElement.close();
    this.editingPoi = null;
    this.poiDraft = this.emptyPoiDraft();
    this.translationDrafts = [];
  }

  addTranslationDraft(): void {
    this.translationDrafts.push({
      language_code: '',
      title: '',
      description: '',
      slug: '',
      is_reference: this.translationDrafts.length === 0
    });
  }

  setReferenceTranslation(index: number): void {
    this.translationDrafts = this.translationDrafts.map((translation, currentIndex) => ({
      ...translation,
      is_reference: currentIndex === index
    }));
  }

  async saveMetadataDialog(): Promise<void> {
    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every POI translation needs a language and title.', true);
      return;
    }
    if (!Number.isFinite(this.poiDraft.gps_latitude) || !Number.isFinite(this.poiDraft.gps_longitude)) {
      this.showStatus('POI latitude and longitude are required.', true);
      return;
    }

    try {
      const payload = {
        enabled: this.poiDraft.enabled,
        country_code: this.poiDraft.country_code.trim().toUpperCase(),
        gps_latitude: Number(this.poiDraft.gps_latitude),
        gps_longitude: Number(this.poiDraft.gps_longitude),
        website: this.poiDraft.website.trim(),
        phone: this.poiDraft.phone.trim(),
        email: this.poiDraft.email.trim(),
        category_ids: this.poiDraft.category_ids,
        translations
      };
      if (this.editingPoi) {
        await firstValueFrom(this.api.updatePoi(this.editingPoi.id, payload));
      } else {
        await firstValueFrom(this.api.createPoi(payload));
      }
      this.closeMetadataDialog();
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save POI metadata. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openCategoryManagerDialog(): void {
    if (this.availableCategories.length > 0) {
      this.selectCategoryForEditing(this.availableCategories[0]);
    } else {
      this.startNewCategory();
    }
    this.categoryManagerDialog?.nativeElement.showModal();
  }

  closeCategoryManagerDialog(): void {
    this.categoryManagerDialog?.nativeElement.close();
    this.editingCategory = null;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = [];
    this.clearCategoryDialogStatus();
    this.mergeTargetCategoryId = null;
  }

  startNewCategory(): void {
    this.editingCategory = null;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = [{ language_code: 'en', name: '' }];
    this.clearCategoryDialogStatus();
    this.mergeTargetCategoryId = null;
  }

  selectCategoryForEditing(category: Category): void {
    this.editingCategory = category;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = category.translations.length > 0
      ? category.translations.map(translation => ({
        language_code: translation.language_code,
        name: translation.name || ''
      }))
      : [{ language_code: 'en', name: category.name || '' }];
    this.clearCategoryDialogStatus();
    this.mergeTargetCategoryId = null;
  }

  addCategoryTranslationDraft(): void {
    this.categoryTranslationDrafts.push({ language_code: '', name: '' });
  }

  mergeTargetCategories(): Category[] {
    return this.availableCategories.filter(category => category.id !== this.editingCategory?.id);
  }

  async saveCategoryDialog(): Promise<void> {
    const slug = this.categorySlugPreview();
    const translations = this.normalizedCategoryTranslations();
    if (!slug) {
      this.showCategoryDialogStatus('Enter a category name to generate its slug.', true);
      return;
    }
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.name)) {
      this.showCategoryDialogStatus('Every category translation needs a language and name.', true);
      return;
    }

    try {
      const editingCategoryId = this.editingCategory?.id ?? null;
      if (this.editingCategory) {
        await firstValueFrom(this.api.updateCategory(this.editingCategory.id, { slug, translations }));
      } else {
        await firstValueFrom(this.api.createCategory({ slug, translations }));
      }
      await this.reloadCategories();
      const savedCategory = editingCategoryId
        ? this.availableCategories.find(category => category.id === editingCategoryId)
        : this.availableCategories.find(category => category.slug === slug);
      if (savedCategory) {
        this.selectCategoryForEditing(savedCategory);
      }
      this.showCategoryDialogStatus(editingCategoryId ? 'Category saved.' : 'Category created.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showCategoryDialogStatus(`Could not save category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deleteSelectedCategory(): Promise<void> {
    if (!this.editingCategory) return;
    const confirmed = window.confirm(`Delete category "${this.editingCategory.name || this.editingCategory.slug}"? POIs using it will be left without this category.`);
    if (!confirmed) return;

    try {
      const deletedId = this.editingCategory.id;
      await firstValueFrom(this.api.deleteCategory(deletedId));
      if (this.selectedCategory === String(deletedId)) {
        this.selectedCategory = '';
      }
      await this.reloadCategories();
      if (this.availableCategories.length > 0) {
        this.selectCategoryForEditing(this.availableCategories[0]);
      } else {
        this.startNewCategory();
      }
      this.showCategoryDialogStatus('Category deleted.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showCategoryDialogStatus(`Could not delete category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async mergeSelectedCategory(): Promise<void> {
    if (!this.editingCategory || !this.mergeTargetCategoryId) {
      this.showCategoryDialogStatus('Select a target category to merge into.', true);
      return;
    }
    const target = this.availableCategories.find(category => category.id === this.mergeTargetCategoryId);
    const confirmed = window.confirm(`Merge "${this.editingCategory.name || this.editingCategory.slug}" into "${target?.name || target?.slug || 'the selected category'}"?`);
    if (!confirmed) return;

    try {
      const sourceId = this.editingCategory.id;
      await firstValueFrom(this.api.mergeCategory(sourceId, this.mergeTargetCategoryId));
      if (this.selectedCategory === String(sourceId)) {
        this.selectedCategory = String(this.mergeTargetCategoryId);
      }
      await this.reloadCategories();
      const mergedTarget = this.availableCategories.find(category => category.id === this.mergeTargetCategoryId);
      if (mergedTarget) {
        this.selectCategoryForEditing(mergedTarget);
      }
      this.showCategoryDialogStatus('Category merged.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showCategoryDialogStatus(`Could not merge category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deletePoi(poi: Poi): Promise<void> {
    if (poi.enabled) {
      this.showStatus('Public POIs cannot be deleted.', true);
      return;
    }
    const confirmed = window.confirm(`Delete POI "${poi.title || 'Untitled POI'}"?`);
    if (!confirmed) return;

    try {
      await firstValueFrom(this.api.deletePoi(poi.id));
      this.selectedPoiIds.delete(poi.id);
      if (this.previewPoi?.id === poi.id) {
        this.previewPoi = null;
      }
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
    this.previewClusterLayer = this.createPreviewClusterLayer().addTo(this.previewMap);
    this.previewMap.on('moveend zoomend', () => {
      this.updateDisplayedPoisFromPreviewMap();
      this.notifyPoiMapViewChanged();
    });
    this.previewMap.on('layeradd layerremove', () => this.scheduleDisplayedPoisUpdate());
    this.previewResizeObserver = new ResizeObserver(() => {
      this.previewMap?.invalidateSize();
    });
    this.previewResizeObserver.observe(this.previewMapElement.nativeElement);
    this.fitPreviewMapToWorld();
  }

  private showWorldMapWhilePoisLoad(): void {
    this.selectedPoiIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewPoi = null;
    this.previewLayer?.clearLayers();
    this.clearPreviewClusterLayer();
    this.displayedPois = [];
    this.previewMessage = '';
    this.initializePreviewMap();
    this.fitPreviewMapToWorld();
  }

  private renderPreviewPoi(poi: Poi): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    this.drawCurrentItineraryPreview();
    if (!Number.isFinite(poi.gps_latitude) || !Number.isFinite(poi.gps_longitude)) {
      this.previewMessage = 'This POI does not have valid coordinates.';
      this.fitPreviewMap(null);
      return;
    }

    const latLng = [poi.gps_latitude, poi.gps_longitude];
    L.marker(latLng, {
      icon: this.previewMarkerIcon()
    }).addTo(this.previewLayer);

    this.previewMessage = `${Number(poi.gps_latitude).toFixed(5)}, ${Number(poi.gps_longitude).toFixed(5)}`;
    void this.fitPreviewMap(latLng, poi.country_code);
  }

  private renderSelectedPoiPreviewIfNeeded(shouldFit = true): void {
    if (this.selectedPoiIds.size === 0) return;
    const selected = this.selectedPois();
    if (selected.length === 0) {
      this.selectedPoiIds.clear();
      this.selectedPreviewFitLocked = false;
      this.previewPoi = null;
      this.renderVisiblePoisPreview(this.currentPois);
      return;
    }
    this.previewPoi = selected.length === 1 ? selected[0] : null;
    this.renderPreviewPois(this.currentPois, shouldFit, 'visible POIs', new Set(selected.map(poi => poi.id)));
  }

  private renderVisiblePoisPreview(pois: Poi[], shouldFit = true): void {
    this.previewPoi = null;
    if (!this.itineraryId && pois.length === 0 && this.mapClusters.length > 0) {
      this.renderServerClusterPreview(this.mapClusters, shouldFit);
      return;
    }
    if (pois.length === 0) {
      this.previewLayer?.clearLayers();
      this.clearPreviewClusterLayer();
      this.displayedPois = [];
      const itineraryBounds = this.drawCurrentItineraryPreview();
      this.previewMessage = 'No POIs found.';
      if (!shouldFit) {
        this.previewMap?.invalidateSize(false);
      } else if (itineraryBounds?.isValid?.()) {
        this.fitPreviewBounds(itineraryBounds);
      } else {
        this.fitPreviewMapToWorld();
      }
      return;
    }
    if (!this.itineraryId && this.selectedPoiIds.size === 0) {
      this.renderClusteredPoisPreview(pois, shouldFit);
      return;
    }
    this.renderPreviewPois(pois, shouldFit, 'visible POIs');
  }

  private renderServerClusterPreview(clusters: PoiMapClusterResult[], shouldFit = false): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    this.displayedPois = [];
    clusters.forEach(cluster => {
      L.marker([cluster.lat, cluster.lng], {
        icon: this.previewClusterIcon(cluster.count)
      })
        .on('click', () => this.previewMap?.setView([cluster.lat, cluster.lng], Math.min((this.previewMap?.getZoom?.() || 1) + 2, 18)))
        .addTo(this.previewLayer);
    });
    if (shouldFit) {
      const bounds = L.latLngBounds(clusters.map(cluster => [cluster.lat, cluster.lng]));
      if (bounds.isValid()) {
        this.fitPreviewBounds(bounds);
      } else {
        this.previewMap.invalidateSize(false);
      }
    } else {
      this.previewMap.invalidateSize(false);
    }
    this.previewMessage = clusters.length === 1
      ? `${clusters[0].count} POIs in this area. Zoom in to inspect them.`
      : `${this.poiTotalCount} POIs in this area. Zoom in to inspect them.`;
  }

  private renderPreviewPois(
    pois: Poi[],
    shouldFit = true,
    scopeLabel = 'POIs',
    fitPoiIds?: Set<number>
  ): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    const itineraryBounds = this.drawCurrentItineraryPreview();
    const bounds = L.latLngBounds([]);
    const fitBounds = L.latLngBounds([]);
    let validCoordinateCount = 0;
    if (itineraryBounds?.isValid?.()) {
      bounds.extend(itineraryBounds);
      fitBounds.extend(itineraryBounds);
    }

    pois.forEach(poi => {
      if (!Number.isFinite(poi.gps_latitude) || !Number.isFinite(poi.gps_longitude)) return;
      const latLng = [poi.gps_latitude, poi.gps_longitude];
      validCoordinateCount += 1;
      bounds.extend(latLng);
      if (!fitPoiIds || fitPoiIds.has(poi.id)) {
        fitBounds.extend(latLng);
      }
      L.marker(latLng, {
        icon: this.previewMarkerIcon(this.selectedPoiIds.has(poi.id))
      })
        .on('click', () => this.selectPoiFromPreviewMarker(poi))
        .addTo(this.previewLayer);
    });

    if (shouldFit) {
      this.fitPreviewBounds(fitBounds.isValid() ? fitBounds : bounds);
    } else {
      this.previewMap.invalidateSize(false);
    }

    if (validCoordinateCount === 0) {
      this.previewMessage = `The ${scopeLabel} do not have valid coordinates.`;
    } else {
      this.previewMessage = validCoordinateCount === 1
        ? '1 POI with coordinates.'
        : `${validCoordinateCount} POIs with coordinates.`;
    }

    if (!this.itineraryId) {
      this.displayedPois = this.displayedPoisForCurrentMapResponse(pois);
    }
  }

  private renderClusteredPoisPreview(pois: Poi[], shouldFit = true): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer || !this.previewClusterLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    const bounds = L.latLngBounds([]);
    let validCoordinateCount = 0;

    pois.forEach(poi => {
      if (!Number.isFinite(poi.gps_latitude) || !Number.isFinite(poi.gps_longitude)) return;
      const latLng = [poi.gps_latitude, poi.gps_longitude];
      validCoordinateCount += 1;
      bounds.extend(latLng);
      const marker = L.marker(latLng, {
        icon: this.previewMarkerIcon(false)
      }).on('click', () => this.selectPoiFromPreviewMarker(poi));
      this.previewMarkerPois.set(marker, poi);
      this.previewClusterLayer.addLayer(marker);
    });

    if (!shouldFit) {
      this.previewMap.invalidateSize(false);
    } else if (bounds.isValid()) {
      this.fitPreviewBounds(bounds);
    } else {
      this.fitPreviewMapToWorld();
    }

    this.displayedPois = this.displayedPoisForCurrentMapResponse(pois);
    this.previewMessage = validCoordinateCount === 0 ? 'The POIs do not have valid coordinates.' : '';
    this.scheduleDisplayedPoisUpdate();
  }

  private createPreviewClusterLayer(): any {
    if (typeof L.markerClusterGroup !== 'function') {
      return L.layerGroup();
    }
    return L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 72,
      iconCreateFunction: (cluster: any) => this.previewClusterIcon(cluster.getChildCount())
    });
  }

  private clearPreviewClusterLayer(): void {
    this.previewMarkerPois.clear();
    this.previewClusterLayer?.clearLayers();
  }

  private scheduleDisplayedPoisUpdate(): void {
    const requestId = ++this.displayedPoisUpdateRequestId;
    window.requestAnimationFrame(() => {
      if (requestId !== this.displayedPoisUpdateRequestId) return;
      this.updateDisplayedPoisFromPreviewMap();
    });
  }

  private updateDisplayedPoisFromPreviewMap(): void {
    if (this.itineraryId || this.selectedPoiIds.size > 0 || !this.previewMap || !this.previewClusterLayer) {
      return;
    }
    if (this.mapResponseMode === 'pois') {
      this.displayedPois = this.sortedPois(this.currentPois);
      this.previewMessage = '';
      this.pruneSelectedPois(this.currentPois);
      this.changeDetector.detectChanges();
      return;
    }
    const bounds = this.previewMap.getBounds();
    if (!bounds?.isValid?.()) {
      this.displayedPois = this.sortedPois(this.currentPois).slice(0, MAX_DISPLAYED_CLUSTER_POIS);
      this.changeDetector.detectChanges();
      return;
    }
    const visiblePois: Poi[] = [];
    const clusteredPois: Poi[] = [];
    this.previewMarkerPois.forEach((poi, marker) => {
      if (!bounds.contains(marker.getLatLng())) return;
      const visibleParent = typeof this.previewClusterLayer.getVisibleParent === 'function'
        ? this.previewClusterLayer.getVisibleParent(marker)
        : marker;
      if (visibleParent === marker) {
        visiblePois.push(poi);
      } else {
        clusteredPois.push(poi);
      }
    });
    if (visiblePois.length > 0) {
      this.displayedPois = this.sortedPois(visiblePois).slice(0, MAX_DISPLAYED_CLUSTER_POIS);
    } else {
      this.displayedPois = this.sortedPois(clusteredPois).slice(0, MAX_DISPLAYED_CLUSTER_POIS);
    }
    this.previewMessage = '';
    this.pruneSelectedPois(this.currentPois);
    this.changeDetector.detectChanges();
  }

  private displayedPoisForCurrentMapResponse(pois: Poi[]): Poi[] {
    const sorted = this.sortedPois(pois);
    return this.mapResponseMode === 'pois' ? sorted : sorted.slice(0, MAX_DISPLAYED_CLUSTER_POIS);
  }

  private drawCurrentItineraryPreview(): any {
    if (!this.previewLayer || !this.currentItinerary) return null;

    const json = this.itineraryJson(this.currentItinerary);
    const pointCoordinates = this.pointCoordinatesByIndex(json.points || []);
    const segments = json.segments || [];
    const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));
    const bounds = L.latLngBounds([]);

    for (let index = 0; index < segmentCount; index += 1) {
      const geometry = segments[index]?.selectedWalkingRoute?.geometry;
      if (geometry) {
        const routeLayer = L.geoJSON(geometry, {
          style: {
            color: '#2563eb',
            weight: 5,
            opacity: 0.75
          },
          interactive: false
        }).addTo(this.previewLayer);
        const routeBounds = routeLayer.getBounds();
        if (routeBounds.isValid()) {
          bounds.extend(routeBounds);
        }
        continue;
      }

      const start = pointCoordinates[index];
      const end = pointCoordinates[index + 1];
      if (start && end) {
        const line = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], {
          color: '#2563eb',
          weight: 4,
          opacity: 0.65,
          interactive: false
        }).addTo(this.previewLayer);
        bounds.extend(line.getBounds());
      }
    }

    return bounds;
  }

  private previewMarkerIcon(selected = false): any {
    return L.divIcon({
      className: `preview-marker poi-preview-marker${selected ? ' selected' : ''}`,
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  private previewClusterIcon(count: number): any {
    const label = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count);
    return L.divIcon({
      className: 'preview-marker poi-cluster-marker',
      html: `<span>${label}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }

  private fitPreviewBounds(bounds: any): void {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      if (bounds?.isValid?.()) {
        this.previewMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 14, animate: false });
      } else {
        this.previewMap.fitWorld({ animate: false });
      }
      window.requestAnimationFrame(() => {
        this.previewMap?.invalidateSize(false);
        this.scheduleDisplayedPoisUpdate();
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
        this.previewMap?.invalidateSize(false);
        this.scheduleDisplayedPoisUpdate();
      });
    });
  }

  private async fitPreviewMap(latLng: number[] | null, countryCode = ''): Promise<void> {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
    });

    const country = (countryCode || '').trim().toUpperCase();
    if (country) {
      try {
        const response = await firstValueFrom(this.api.getCountryBounds(country, latLng || undefined));
        window.requestAnimationFrame(() => {
          if (!this.previewMap || requestId !== this.previewFitRequestId) return;
          this.previewMap.invalidateSize(false);
          this.previewMap.fitBounds(response.bounds, { padding: [22, 22], maxZoom: 9, animate: false });
          window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
        });
        return;
      } catch {
        // Fall back to the POI position below if country bounds are unavailable.
      }
    }

    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      if (latLng) {
        this.previewMap.setView(latLng, 14, { animate: false });
      } else {
        this.previewMap.setView([42.5, -8.5], 5, { animate: false });
      }
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
    });
  }

  private translationDraftsFrom(
    translations: Translation[],
    title: string | null,
    description: string | null,
    slug: string | null
  ): TranslationDraft[] {
    if (translations.length === 0) {
      return [{
        language_code: 'en',
        title: title || '',
        description: description || '',
        slug: slug || '',
        is_reference: true
      }];
    }
    const drafts = translations.map(translation => ({
      language_code: translation.language_code,
      title: translation.title || '',
      description: translation.description || '',
      slug: translation.slug || '',
      is_reference: Boolean(translation.is_reference)
    }));
    if (!drafts.some(translation => translation.is_reference)) {
      drafts[0].is_reference = true;
    }
    return drafts;
  }

  private normalizedTranslations() {
    const translations = this.translationDrafts
      .map(translation => ({
        language_code: translation.language_code.trim(),
        title: translation.title.trim(),
        description: translation.description.trim(),
        slug: translation.slug.trim(),
        is_reference: translation.is_reference
      }))
      .filter(translation => translation.language_code || translation.title || translation.description || translation.slug);
    if (!translations.some(translation => translation.is_reference) && translations.length > 0) {
      translations[0].is_reference = true;
    }
    return translations;
  }

  private duplicatePoiTranslations(poi: Poi, title: string): Array<{
    language_code: string;
    title: string;
    description?: string;
    is_reference?: boolean;
  }> {
    const translations = poi.translations.length > 0
      ? poi.translations
      : [{ language_code: 'en', title: poi.title || '', description: poi.description || '', is_reference: true }];
    const duplicatedTranslations = translations
      .filter(translation => translation.language_code)
      .map(translation => ({
        language_code: translation.language_code,
        title: translation.title || poi.title || 'Untitled POI',
        description: translation.description || '',
        is_reference: Boolean(translation.is_reference)
      }));

    if (duplicatedTranslations.length === 0) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: poi.description || '',
        is_reference: true
      });
    }
    const referenceIndex = Math.max(0, duplicatedTranslations.findIndex(translation => translation.is_reference));
    duplicatedTranslations.forEach((translation, index) => {
      translation.is_reference = index === referenceIndex;
      if (index === referenceIndex) {
        translation.title = title;
      }
    });
    return duplicatedTranslations;
  }

  private duplicatePoiMedia(media: PoiMedia[], images: Array<{ image_url: string; position: number; is_primary: boolean }>): PoiMedia[] {
    const source: PoiMedia[] = media.length > 0
      ? media.map(item => ({
        media_type: item.media_type || 'image',
        url: item.url || item.image_url || '',
        position: item.position,
        is_primary: item.is_primary
      }))
      : images.map(image => ({
        media_type: 'image' as const,
        url: image.image_url,
        position: image.position,
        is_primary: image.is_primary
      }));
    return source
      .filter(item => item.url || item.image_url)
      .map((item, index) => ({
        media_type: item.media_type || 'image',
        url: item.url || item.image_url || '',
        position: Number.isFinite(item.position) ? item.position : index,
        is_primary: Boolean(item.is_primary)
      }));
  }

  private normalizedCategoryTranslations() {
    return this.categoryTranslationDrafts
      .map(translation => ({
        language_code: translation.language_code.trim(),
        name: translation.name.trim()
      }))
      .filter(translation => translation.language_code || translation.name);
  }

  private emptyPoiDraft(): PoiDraft {
    return {
      enabled: true,
      country_code: '',
      website: '',
      phone: '',
      email: '',
      gps_latitude: null,
      gps_longitude: null,
      category_ids: []
    };
  }

  private emptyCategoryDraft(): CategoryDraft {
    return {};
  }

  categorySlugPreview(): string {
    return this.slugFromCategoryTranslations(this.categoryTranslationDrafts);
  }

  private slugFromCategoryTranslations(translations: CategoryTranslationDraft[]): string {
    const namedTranslations = translations
      .map(translation => ({
        language_code: translation.language_code.trim().toLowerCase(),
        name: translation.name.trim()
      }))
      .filter(translation => translation.name);
    const source = namedTranslations.find(translation => translation.language_code === 'en') || namedTranslations[0];
    return source ? this.slugFromText(source.name) : '';
  }

  private slugFromText(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private async reloadCategories(): Promise<void> {
    this.availableCategories = await firstValueFrom(this.api.listAllCategories());
  }

  countryName(countryCode: string | null | undefined): string {
    if (!countryCode) return '-';
    try {
      return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(countryCode) || countryCode;
    } catch {
      return countryCode;
    }
  }

  private poiIdsForItinerary(itineraryJson: unknown): string[] {
    const json = itineraryJson && typeof itineraryJson === 'object'
      ? itineraryJson as ItineraryJsonExport
      : {};
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const rawId of json.poiIds || []) {
      const id = String(rawId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    for (const point of json.points || []) {
      if (point.type !== 'poi' || point.id === undefined || point.id === null) continue;
      const id = String(point.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  private fetchItineraryPoiGroups(itinerary: Itinerary, query: string): Observable<{ items: Poi[]; groups: PoiGroup[] }> {
    const directIds = this.poiIdsForItinerary(itinerary.itinerary_json);
    const directIdSet = new Set(directIds.map(id => String(id)));
    const directPois$ = directIds.length > 0
      ? this.api.listAllPois(
        query,
        '',
        undefined,
        this.selectedCategory,
        this.selectedCountry,
        directIds
      )
      : of([] as Poi[]);

    return this.nearbyPoiIdsForItinerary(itinerary).pipe(
      switchMap(nearbyIds => {
        const nearbyOnlyIds = nearbyIds.filter(id => !directIdSet.has(String(id)));
        const nearbyPois$ = nearbyOnlyIds.length > 0
          ? this.api.listAllPois(
            query,
            '',
            undefined,
            this.selectedCategory,
            this.selectedCountry,
            nearbyOnlyIds
          )
          : of([] as Poi[]);

        return forkJoin([directPois$, nearbyPois$]).pipe(
          map(([directPois, nearbyPois]) => {
            const groups = [
              {
                key: 'direct',
                title: 'POIs included directly in the itinerary',
                items: this.sortedPois(directPois)
              },
              {
                key: 'nearby',
                title: 'Nearby POIs in segment buffer zones',
                items: this.sortedPois(nearbyPois)
              }
            ];
            return {
              groups,
              items: this.uniquePois([...groups[0].items, ...groups[1].items])
            };
          })
        );
      })
    );
  }

  private nearbyPoiIdsForItinerary(itinerary: Itinerary): Observable<string[]> {
    const buffers = this.bufferGeometriesForItinerary(itinerary);
    if (buffers.length === 0) return of([]);

    return forkJoin(
      buffers.map(buffer =>
        this.api.findBufferPois(buffer.geometry, buffer.segmentIndex, 200).pipe(
          catchError(() => of({ results: [] }))
        )
      )
    ).pipe(
      map(responses => {
        const seen = new Set<string>();
        const ids: string[] = [];
        for (const response of responses) {
          for (const poi of response.results || []) {
            const id = String(poi.id);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
          }
        }
        return ids;
      })
    );
  }

  private bufferGeometriesForItinerary(itinerary: Itinerary): Array<{ segmentIndex: number; geometry: unknown }> {
    if (typeof turf === 'undefined') return [];

    const json = this.itineraryJson(itinerary);
    const pointCoordinates = this.pointCoordinatesByIndex(json.points || []);
    const segments = json.segments || [];
    const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));
    const buffers: Array<{ segmentIndex: number; geometry: unknown }> = [];

    for (let index = 0; index < segmentCount; index += 1) {
      const segment = segments[index];
      const feature = this.segmentFeature(segment, pointCoordinates[index], pointCoordinates[index + 1]);
      if (!feature) continue;

      const bufferDistanceMeters = Number(segment?.bufferDistanceMeters);
      const radiusKilometers = Number.isFinite(bufferDistanceMeters) && bufferDistanceMeters > 0
        ? bufferDistanceMeters / 1000
        : 1;
      try {
        const buffered = turf.buffer(feature, radiusKilometers, { units: 'kilometers' });
        const geometry = buffered?.geometry;
        if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
          buffers.push({ segmentIndex: index, geometry });
        }
      } catch {
        // Ignore malformed saved segment geometry and keep the rest of the itinerary usable.
      }
    }

    return buffers;
  }

  private segmentFeature(
    segment: ItinerarySegmentExport | undefined,
    start: { lat: number; lng: number } | null | undefined,
    end: { lat: number; lng: number } | null | undefined
  ): unknown | null {
    const geometry = segment?.selectedWalkingRoute?.geometry;
    if (this.isLineGeometry(geometry)) {
      return { type: 'Feature', properties: {}, geometry };
    }
    if (start && end) {
      return turf.lineString([[start.lng, start.lat], [end.lng, end.lat]]);
    }
    return null;
  }

  private isLineGeometry(geometry: unknown): boolean {
    if (!geometry || typeof geometry !== 'object') return false;
    const type = (geometry as { type?: unknown }).type;
    return type === 'LineString' || type === 'MultiLineString';
  }

  private pointCoordinatesByIndex(points: ItineraryPointExport[]): Array<{ lat: number; lng: number } | null> {
    return points.map(point => {
      const lat = point.coordinates?.lat ?? point.lat;
      const lng = point.coordinates?.lng ?? point.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat: Number(lat), lng: Number(lng) };
    });
  }

  private itineraryJson(itinerary: Itinerary): ItineraryJsonExport {
    return itinerary.itinerary_json && typeof itinerary.itinerary_json === 'object'
      ? itinerary.itinerary_json as ItineraryJsonExport
      : {};
  }

  private uniquePois(pois: Poi[]): Poi[] {
    const seen = new Set<number>();
    const unique: Poi[] = [];
    for (const poi of pois) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      unique.push(poi);
    }
    return unique;
  }

  private fetchAllPois(query: string): Observable<{ pois: Poi[]; clusters: PoiMapClusterResult[]; count: number; mode: PoiMapMode }> {
    const view = this.currentPreviewMapQuery();
    this.lastPoiMapViewKey = view.key;
    const mapPois$ = this.api.mapPois(
      query,
      '',
      undefined,
      this.selectedCategory,
      this.selectedCountry,
      view.bbox,
      view.zoom
    );
    const highlightedPoiId = this.pendingHighlightPoiId;
    const highlightedPoi$ = highlightedPoiId && !this.itineraryId
      ? this.api.listAllPois('', '', undefined, undefined, undefined, [highlightedPoiId]).pipe(
        map(pois => pois[0] || null),
        catchError(() => of(null))
      )
      : of(null);
    return forkJoin([mapPois$, highlightedPoi$]).pipe(
      map(([response, highlightedPoi]) => {
        const pois = response.results
          .filter(result => result.type === 'poi')
          .map(result => result.poi);
        if (highlightedPoi && !pois.some(poi => poi.id === highlightedPoi.id)) {
          pois.push(highlightedPoi);
        }
        return {
          pois,
          clusters: response.results
            .filter((result): result is PoiMapClusterResult => result.type === 'cluster'),
          count: response.count,
          mode: response.mode
        };
      })
    );
  }

  poiEditorReturnQueryParams(poi: Poi | null = null): Record<string, string> {
    return {
      returnTo: this.poiListReturnUrl(poi?.id ?? null),
      returnLabel: this.itineraryId ? 'Back to itinerary POIs' : 'Back to POIs'
    };
  }

  itineraryEditorReturnQueryParams(): Record<string, string> {
    return {
      returnTo: this.poiListReturnUrl(null),
      returnLabel: 'Back to itinerary POIs'
    };
  }

  private restoreFiltersFromQueryParams(): void {
    const params = this.activatedRoute.snapshot.queryParamMap;
    this.query = params.get('q') || '';
    this.query$.next(this.query);
    this.selectedCategory = params.get('category') || '';
    this.selectedCountry = (params.get('country') || '').toUpperCase();
    this.pendingHighlightPoiId = this.parsePositiveInteger(params.get('highlight'));
  }

  private syncFiltersToUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: this.poiListQueryParams(),
      replaceUrl: true
    });
  }

  private poiListReturnUrl(highlightPoiId: number | null = null): string {
    const existingReturnTo = this.activatedRoute.snapshot.queryParamMap.get('returnTo');
    const existingReturnLabel = this.activatedRoute.snapshot.queryParamMap.get('returnLabel');
    return this.router.serializeUrl(this.router.createUrlTree([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        returnTo: existingReturnTo,
        returnLabel: existingReturnLabel,
        ...this.poiListQueryParams(),
        highlight: highlightPoiId === null ? null : String(highlightPoiId)
      }
    }));
  }

  private poiRootReturnUrl(highlightPoiId: number): string {
    return this.router.serializeUrl(this.router.createUrlTree(['/pois'], {
      queryParams: {
        ...this.poiListQueryParams(),
        highlight: String(highlightPoiId)
      }
    }));
  }

  private poiListQueryParams(): Record<string, string | null> {
    return {
      q: this.query.trim() || null,
      category: this.selectedCategory || null,
      country: this.selectedCountry || null,
      bbox: null
    };
  }

  private notifyPoiMapViewChanged(): void {
    if (this.itineraryId || !this.previewMap) return;
    const view = this.currentPreviewMapQuery();
    if (view.key === this.lastPoiMapViewKey) return;
    this.lastPoiMapViewKey = view.key;
    if (Date.now() < this.suppressPoiMapRefreshUntil) {
      return;
    }
    this.selectedPoiIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewPoi = null;
    this.mapView$.next(this.mapView$.value + 1);
  }

  private suppressPoiMapRefreshForProgrammaticFocus(): void {
    this.suppressPoiMapRefreshUntil = Date.now() + 700;
  }

  private currentPreviewMapQuery(): { bbox: string; zoom: number; key: string } {
    const world = '-180,-90,180,90';
    if (!this.previewMap) {
      return { bbox: world, zoom: 1, key: `${world}|1` };
    }
    const bounds = this.previewMap.getBounds();
    const zoom = Math.round(this.previewMap.getZoom?.() || 1);
    if (!bounds?.isValid?.()) {
      return { bbox: world, zoom, key: `${world}|${zoom}` };
    }
    const west = Math.max(-180, bounds.getWest());
    const south = Math.max(-90, bounds.getSouth());
    const east = Math.min(180, bounds.getEast());
    const north = Math.min(90, bounds.getNorth());
    if (west >= east || south >= north) {
      return { bbox: world, zoom, key: `${world}|${zoom}` };
    }
    const bbox = [west, south, east, north].map(value => value.toFixed(4)).join(',');
    return {
      bbox,
      zoom,
      key: `${bbox}|${zoom}`
    };
  }

  private selectedPois(): Poi[] {
    return this.currentPois.filter(poi => this.selectedPoiIds.has(poi.id));
  }

  private sortedPois(pois: Poi[]): Poi[] {
    const direction = this.poiSortDirection === 'asc' ? 1 : -1;
    return [...pois].sort((left, right) => {
      let comparison = 0;
      if (this.poiSortKey === 'title') {
        comparison = (left.title || '').localeCompare(right.title || '');
      } else if (this.poiSortKey === 'country') {
        comparison = this.countryName(left.country_code).localeCompare(this.countryName(right.country_code));
      } else if (this.poiSortKey === 'media') {
        comparison = (left.media?.length || 0) - (right.media?.length || 0);
      } else {
        comparison = Number(left.enabled) - Number(right.enabled);
      }
      return comparison * direction || left.id - right.id;
    });
  }

  poiRowId(poi: Poi): string {
    return `poi-row-${poi.id}`;
  }

  private pruneSelectedPois(pois: Poi[]): void {
    const visibleIds = new Set(pois.map(poi => poi.id));
    [...this.selectedPoiIds].forEach(id => {
      if (!visibleIds.has(id)) this.selectedPoiIds.delete(id);
    });
    if (this.selectedPoiIds.size === 0) {
      this.selectedPreviewFitLocked = false;
      this.previewPoi = null;
    } else {
      this.previewPoi = this.selectedPoiIds.size === 1 ? this.selectedPois()[0] || null : null;
    }
  }

  private keepSingleSelectedPoi(): void {
    if (this.selectedPoiIds.size <= 1) return;
    const firstSelectedId = this.selectedPoiIds.values().next().value as number | undefined;
    this.selectedPoiIds.clear();
    if (firstSelectedId) {
      this.selectedPoiIds.add(firstSelectedId);
    }
    this.selectedPreviewFitLocked = false;
    this.previewPoi = this.selectedPois()[0] || null;
  }

  private parsePositiveInteger(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }

  private clearStatus(): void {
    this.statusMessage = '';
    this.statusIsError = false;
  }

  private showCategoryDialogStatus(message: string, isError: boolean): void {
    this.categoryDialogStatusMessage = message;
    this.categoryDialogStatusIsError = isError;
  }

  private clearCategoryDialogStatus(): void {
    this.categoryDialogStatusMessage = '';
    this.categoryDialogStatusIsError = false;
  }
}
