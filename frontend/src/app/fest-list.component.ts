import { AsyncPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, finalize, firstValueFrom, map, Observable, of, startWith, switchMap } from 'rxjs';

import { ApiService, Fest, FestCategory, FestCategoryPayload, FestMapClusterResult, FestMapResponse, FestMedia, Translation } from './api.service';
import { AuthService } from './auth.service';
import { PageInstructionService } from './page-instruction.service';

interface FestListState {
  items: Fest[];
  count: number;
  error: string;
}

interface CategoryTranslationDraft {
  language_code: string;
  name: string;
}

interface CategoryDraft {}

type FestSortKey = 'title' | 'traversals' | 'country' | 'draft' | 'media';
type SortDirection = 'asc' | 'desc';
type FestMapMode = FestMapResponse['mode'];

const MAX_DISPLAYED_CLUSTER_FESTS = 50;

declare const L: any;

@Component({
  selector: 'app-fest-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Fests</h1>
        </div>
        <div class="list-actions">
          @if (isAdmin$ | async) {
            <button type="button" class="secondary" (click)="openCategoryManagerDialog()">Manage categories</button>
          }
          <a class="primary" title="New fest" aria-label="New fest" routerLink="/fests/new" target="_blank" rel="noopener">New fest</a>
        </div>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search fests by title or category"
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
        @if (loadingFestInfo) {
          <span class="toolbar-loading-indicator" role="status" aria-live="polite">
            <span class="toolbar-loading-spinner" aria-hidden="true"></span>
            <span>Downloading fest info</span>
          </span>
        } @else {
          <span class="toolbar-result-count">Found {{ festTotalCount }} fests</span>
        }
      </div>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <div class="preview-layout poi-preview-layout">
            <div class="preview-list">
              <div class="table-wrap">
                <table class="resource-table">
                  <thead>
                    <tr>
                      <th class="poi-name-column">
                        <button type="button" class="sortable-header" (click)="toggleFestSort('title')">
                          <span>Fest</span>
                          <span aria-hidden="true">{{ festSortIndicator('title') }}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" class="sortable-header" (click)="toggleFestSort('traversals')">
                          <span>Traversed by</span>
                          <span aria-hidden="true">{{ festSortIndicator('traversals') }}</span>
                        </button>
                      </th>
                      <th>Categories</th>
                      <th>
                        <button type="button" class="sortable-header" (click)="toggleFestSort('media')">
                          <span>Media</span>
                          <span aria-hidden="true">{{ festSortIndicator('media') }}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" class="sortable-header" (click)="toggleFestSort('country')">
                          <span>Country</span>
                          <span aria-hidden="true">{{ festSortIndicator('country') }}</span>
                        </button>
                      </th>
                      <th class="enabled-column">
                        <button type="button" class="sortable-header" (click)="toggleFestSort('draft')">
                          <span>Draft?</span>
                          <span aria-hidden="true">{{ festSortIndicator('draft') }}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (fest of displayedFests; track fest.id) {
                      <tr
                        [attr.id]="festRowId(fest)"
                        [class.highlight-row]="highlightedFestId === fest.id"
                        [class.preview-selected-row]="previewFest?.id === fest.id"
                        (click)="queueFestRowSelection(fest)"
                        (dblclick)="openFestInfoAndMedia(fest)"
                      >
                        <td class="poi-name-column">
                          <strong>{{ fest.title || 'Untitled fest' }}</strong>
                          <p class="description-preview">{{ fest.description || 'No description' }}</p>
                        </td>
                        <td>
                          <div class="route-membership-badges">
                            @for (traversal of fest.itinerary_traversals; track traversal.itinerary) {
                              <a
                                class="route-membership-badge poi-inclusion-badge"
                                [routerLink]="['/itineraries', traversal.itinerary, 'pois']"
                                target="_blank"
                                rel="noopener"
                                [title]="festTraversalTooltip(traversal)"
                                (click)="$event.stopPropagation()"
                              >
                                <span class="inclusion-badge-label">{{ traversal.route_title || 'No route' }}</span>
                                @if (traversal.stage_number !== null) {
                                  <span>{{ traversal.stage_number }}</span>
                                }
                              </a>
                            } @empty {
                              <span class="muted">No itineraries</span>
                            }
                          </div>
                        </td>
                        <td>
                          @if (fest.categories.length) {
                            <div class="chip-list">
                              @for (category of fest.categories; track category.id) {
                                <span class="small-chip" [title]="category.name || category.slug">{{ category.name || category.slug }}</span>
                              }
                            </div>
                          } @else {
                            <span class="muted">No categories</span>
                          }
                        </td>
                        <td>{{ fest.media.length }}</td>
                        <td>{{ countryName(fest.country_code) }}</td>
                        <td class="enabled-column">{{ fest.enabled ? 'No' : 'Yes' }}</td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="6">{{ emptyFestListMessage() }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            <div class="preview-side-column">
              <aside class="preview-panel" aria-label="Fest map preview">
                <header>
                  <h2>Map preview</h2>
                </header>
                <div class="preview-map" #previewMap></div>
                @if (previewMessage) {
                  <p class="muted preview-message">{{ previewMessage }}</p>
                }
                <div class="preview-actions" aria-label="Fest preview actions">
                  <button type="button" class="secondary preview-action" (click)="fitPreviewToCurrentFests()">
                    <span class="preview-action-icon" aria-hidden="true">🎯</span>
                    <span>Fit view</span>
                  </button>
                  @if (previewFest && !previewFest.enabled) {
                    <button type="button" class="secondary preview-action" (click)="setFestEnabled(previewFest, true)">
                      <span class="preview-action-icon" aria-hidden="true">🌐</span>
                      <span>Make public</span>
                    </button>
                  }
                  @if (previewFest && previewFest.enabled) {
                    <button type="button" class="secondary preview-action" (click)="setFestEnabled(previewFest, false)">
                      <span class="preview-action-icon" aria-hidden="true">✎</span>
                      <span>Turn to draft</span>
                    </button>
                  }
                  @if (previewFest) {
                    <a class="secondary preview-action" [routerLink]="['/fests', previewFest.id, 'edit']" target="_blank" rel="noopener">
                      <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                      <span>{{ previewFest.enabled ? 'View info and media' : 'Manage metadata, dates, media and translations' }}</span>
                    </a>
                    <button type="button" class="secondary preview-action" [disabled]="duplicatingFestIds.has(previewFest.id)" (click)="duplicateFest(previewFest)">
                      <span class="preview-action-icon" aria-hidden="true">📄</span>
                      <span>{{ duplicatingFestIds.has(previewFest.id) ? 'Duplicating...' : 'Duplicate' }}</span>
                    </button>
                    <button type="button" class="secondary preview-action danger-action" [disabled]="previewFest.enabled" (click)="deleteFest(previewFest)">
                      <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                      <span>Delete fest</span>
                    </button>
                  }
                </div>
              </aside>

              @if (previewFest) {
                <aside class="preview-panel preview-media-panel" aria-label="Selected fest media preview">
                  <header>
                    <h2>Media preview</h2>
                  </header>
                  @if (previewFestMedia(previewFest).length > 0) {
                    <div class="preview-media-strip">
                      @for (item of previewFestMedia(previewFest); track item.id || $index) {
                        <a
                          class="preview-media-thumb"
                          [href]="festMediaUrl(item)"
                          target="_blank"
                          rel="noopener noreferrer"
                          [attr.title]="festMediaLabel(item, $index)"
                        >
                          @if (item.media_type === 'image' && festMediaUrl(item)) {
                            <img [src]="festMediaUrl(item)" alt="" />
                          } @else {
                            <span>{{ festMediaTypeLabel(item.media_type) }}</span>
                          }
                        </a>
                      }
                    </div>
                  } @else {
                    <p class="muted preview-media-empty">No media linked to this fest.</p>
                  }
                </aside>
              }
            </div>
          </div>
        }
      }

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
                  <div class="category-list-row" [class.active]="editingCategory?.id === category.id">
                    <button type="button" class="category-select-button" (click)="selectCategoryForEditing(category)">
                      {{ category.name || category.slug }}
                    </button>
                    <button
                      type="button"
                      class="category-open-button"
                      title="Open fests with this category in a new tab"
                      [disabled]="!category.fest_count"
                      (click)="openCategoryFestsInNewTab(category)"
                      [attr.aria-label]="'Open fests labeled with ' + (category.name || category.slug) + ' in a new tab'"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" class="category-eye-icon">
                        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                      <span class="category-poi-count">{{ category.fest_count || 0 }}</span>
                    </button>
                  </div>
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

              @if (editingCategory && (isAdmin$ | async)) {
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

          <footer class="metadata-dialog-footer category-manager-footer">
            <span class="category-count">{{ availableCategories.length }} {{ availableCategories.length === 1 ? 'category' : 'categories' }}</span>
            <span class="category-footer-actions">
              <button type="submit" class="primary">{{ editingCategory ? 'Save category' : 'Create category' }}</button>
              <button type="button" class="secondary" (click)="closeCategoryManagerDialog()">Close</button>
            </span>
          </footer>
        </form>
      </dialog>
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class FestListComponent implements AfterViewInit, OnDestroy {
  @ViewChild('categoryManagerDialog') private readonly categoryManagerDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly title = inject(Title);
  readonly isAdmin$ = this.auth.isAdmin$;

  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  readonly mapView$ = new BehaviorSubject(0);

  query = '';
  selectedCategory = '';
  selectedCountry = '';
  festSortKey: FestSortKey = 'title';
  festSortDirection: SortDirection = 'asc';
  statusMessage = '';
  statusIsError = false;
  loadingFestInfo = false;
  availableCategories: FestCategory[] = [];
  availableCountries: string[] = [];
  editingCategory: FestCategory | null = null;
  categoryDraft: CategoryDraft = this.emptyCategoryDraft();
  categoryTranslationDrafts: CategoryTranslationDraft[] = [];
  categoryDialogStatusMessage = '';
  categoryDialogStatusIsError = false;
  mergeTargetCategoryId: number | null = null;
  readonly selectedFestIds = new Set<number>();
  readonly duplicatingFestIds = new Set<number>();
  currentFests: Fest[] = [];
  displayedFests: Fest[] = [];
  mapClusters: FestMapClusterResult[] = [];
  mapResponseMode: FestMapMode = 'fests';
  festTotalCount = 0;
  highlightedFestId: number | null = null;
  previewFest: Fest | null = null;
  previewMessage = 'Click a fest to preview it.';

  private previewMap: any = null;
  private previewLayer: any = null;
  private previewClusterLayer: any = null;
  private readonly previewMarkerFests = new Map<any, Fest>();
  private previewResizeObserver: ResizeObserver | null = null;
  private previewFitRequestId = 0;
  private displayedFestsUpdateRequestId = 0;
  private festRowClickTimer: number | null = null;
  private selectedPreviewFitLocked = false;
  private hasShownInitialWorldMap = false;
  private lastFestMapViewKey = '';
  private suppressFestMapRefreshUntil = 0;
  private fitFestsAfterNextFetch = false;
  private fitInitialFestsAfterFirstFetch = true;

  constructor() {
    this.restoreFiltersFromQueryParams();
  }

  readonly state$: Observable<FestListState> = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.mapView$.pipe(debounceTime(200)),
  ]).pipe(
    switchMap(([query]) => {
      this.loadingFestInfo = true;
      if (!this.hasShownInitialWorldMap) {
        this.hasShownInitialWorldMap = true;
        this.showWorldMapWhileFestsLoad();
      }
      this.pageInstruction.setInstruction('Browse and manage fests from the backend API.');
      this.title.setTitle('SW Fests');
      return combineLatest([
        this.api.listAllFestCategories(),
        this.api.listFestCountries(),
      ]).pipe(
        switchMap(([categories, countries]) => {
          this.availableCategories = this.sortedCategories(categories);
          this.availableCountries = countries;
          return this.fetchMapFests(query).pipe(
            map(result => {
              this.currentFests = this.sortedFests(result.fests);
              this.mapClusters = result.clusters;
              this.mapResponseMode = result.mode;
              this.displayedFests = this.displayedFestsForCurrentMapResponse(this.currentFests);
              this.festTotalCount = result.count;
              this.pruneSelectedFests();
              const shouldFit = this.fitFestsAfterNextFetch || this.fitInitialFestsAfterFirstFetch;
              this.fitFestsAfterNextFetch = false;
              this.fitInitialFestsAfterFirstFetch = false;
              if (shouldFit) {
                this.selectedFestIds.clear();
                this.selectedPreviewFitLocked = false;
                this.previewFest = null;
              }
              if (this.selectedFestIds.size > 0) {
                this.renderSelectedFestPreview(!this.selectedPreviewFitLocked);
              } else {
                this.renderVisibleFestsPreview(shouldFit);
              }
              return { items: this.currentFests, count: this.festTotalCount, error: '' };
            })
          );
        }),
        catchError(error => {
          this.currentFests = [];
          this.displayedFests = [];
          this.mapClusters = [];
          this.mapResponseMode = 'fests';
          this.festTotalCount = 0;
          this.previewFest = null;
          this.renderVisibleFestsPreview(false);
          return of({ items: [] as Fest[], count: 0, error: `Could not load fests. ${error.message || 'Request failed.'}` });
        }),
        finalize(() => {
          this.loadingFestInfo = false;
        })
      );
    }),
    startWith({ items: [] as Fest[], count: 0, error: '' })
  );

  ngAfterViewInit(): void {
    this.initializePreviewMap();
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
    if (this.festRowClickTimer !== null) {
      window.clearTimeout(this.festRowClickTimer);
      this.festRowClickTimer = null;
    }
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  refreshList(): void {
    this.refresh$.next(this.refresh$.value + 1);
  }

  updateQueryFilter(value: string): void {
    this.query = value;
    this.fitFestsAfterNextFetch = true;
    this.updateBrowserQueryParams();
    this.query$.next(value);
  }

  updateCategoryFilter(value: string): void {
    this.selectedCategory = value;
    this.selectedFestIds.clear();
    this.previewFest = null;
    this.fitFestsAfterNextFetch = true;
    this.updateBrowserQueryParams();
    this.refreshList();
  }

  updateCountryFilter(value: string): void {
    this.selectedCountry = value;
    this.selectedFestIds.clear();
    this.previewFest = null;
    this.fitFestsAfterNextFetch = true;
    this.updateBrowserQueryParams();
    this.refreshList();
  }

  queueFestRowSelection(fest: Fest): void {
    if (this.festRowClickTimer !== null) {
      window.clearTimeout(this.festRowClickTimer);
    }
    this.festRowClickTimer = window.setTimeout(() => {
      this.festRowClickTimer = null;
      this.toggleFestRowPreview(fest);
    }, 180);
  }

  toggleFestRowPreview(fest: Fest): void {
    if (this.previewFest?.id === fest.id) {
      this.clearFestPreview(true);
      return;
    }
    this.selectPreviewFest(fest);
  }

  selectPreviewFest(fest: Fest): void {
    this.selectedFestIds.clear();
    this.selectedFestIds.add(fest.id);
    this.selectedPreviewFitLocked = false;
    this.previewFest = fest;
    this.suppressFestMapRefreshForProgrammaticFocus();
    this.renderSelectedFestPreview(true);
  }

  clearFestPreview(shouldFit = true): void {
    this.selectedFestIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewFest = null;
    this.renderVisibleFestsPreview(shouldFit);
  }

  fitPreviewToCurrentFests(): void {
    if (this.previewFest) {
      this.renderSelectedFestPreview(true);
    } else {
      this.renderVisibleFestsPreview(true);
    }
  }

  toggleFestSort(key: FestSortKey): void {
    if (this.festSortKey === key) {
      this.festSortDirection = this.festSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.festSortKey = key;
      this.festSortDirection = 'asc';
    }
    this.currentFests = this.sortedFests(this.currentFests);
    this.displayedFests = this.displayedFestsForCurrentMapResponse(this.currentFests);
    if (this.selectedFestIds.size > 0) {
      this.renderSelectedFestPreview(false);
    } else {
      this.renderVisibleFestsPreview(false);
    }
  }

  festSortIndicator(key: FestSortKey): string {
    if (this.festSortKey !== key) return '';
    return this.festSortDirection === 'asc' ? '▲' : '▼';
  }

  emptyFestListMessage(): string {
    if (this.mapClusters.length > 0) {
      return 'Fests are grouped in clusters. Zoom in to inspect individual fests.';
    }
    return this.currentFests.length ? 'No fests visible in the current map view.' : 'No fests found.';
  }

  selectFestFromPreviewMarker(fest: Fest): void {
    this.selectPreviewFest(fest);
    this.highlightedFestId = fest.id;
    window.setTimeout(() => {
      document.getElementById(this.festRowId(fest))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedFestId === fest.id) {
        this.highlightedFestId = null;
      }
    }, 2500);
  }

  openFestInfoAndMedia(fest: Fest): void {
    if (this.festRowClickTimer !== null) {
      window.clearTimeout(this.festRowClickTimer);
      this.festRowClickTimer = null;
    }
    this.openUrlTreeInNewTab(this.router.createUrlTree(['/fests', fest.id, 'edit']));
  }

  async setFestEnabled(fest: Fest, enabled: boolean): Promise<void> {
    if (!this.confirmFestDraftChange(fest, enabled)) return;
    try {
      await firstValueFrom(this.api.updateFest(fest.id, { enabled }));
      this.refreshList();
    } catch (error) {
      this.showStatus(`Could not update fest. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async duplicateFest(fest: Fest): Promise<void> {
    if (this.duplicatingFestIds.has(fest.id)) return;
    this.duplicatingFestIds.add(fest.id);
    try {
      const translations = this.duplicatedTranslations(fest.translations, fest.title, fest.description);
      const duplicate = await firstValueFrom(this.api.createFest({
        enabled: false,
        country_code: fest.country_code || '',
        gps_latitude: fest.gps_latitude,
        gps_longitude: fest.gps_longitude,
        footprint: fest.footprint,
        website: fest.website || '',
        phone: fest.phone || '',
        email: fest.email || '',
        category_ids: fest.categories.map(category => category.id),
        translations,
        media: this.duplicatedMedia(fest.media),
        editions: (fest.editions || []).map(edition => ({
          year: edition.year,
          notes: edition.notes || '',
          is_cancelled: Boolean(edition.is_cancelled),
          dates: [...edition.dates],
        })),
      }));
      this.selectedFestIds.clear();
      this.selectedFestIds.add(duplicate.id);
      this.previewFest = duplicate;
      this.highlightedFestId = duplicate.id;
      this.refreshList();
      window.setTimeout(() => {
        document.getElementById(this.festRowId(duplicate))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      window.setTimeout(() => {
        if (this.highlightedFestId === duplicate.id) this.highlightedFestId = null;
      }, 3000);
      this.showStatus('Fest duplicated as draft.', false);
    } catch (error) {
      this.showStatus(`Could not duplicate fest. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.duplicatingFestIds.delete(fest.id);
    }
  }

  async deleteFest(fest: Fest): Promise<void> {
    if (fest.enabled) return;
    if (!window.confirm(`Really delete "${fest.title || 'Untitled fest'}"?`)) return;
    try {
      await firstValueFrom(this.api.deleteFest(fest.id));
      if (this.previewFest?.id === fest.id) {
        this.previewFest = null;
        this.selectedFestIds.clear();
      }
      this.refreshList();
      this.showStatus('Fest deleted.', false);
    } catch (error) {
      this.showStatus(`Could not delete fest. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  festTraversalTooltip(traversal: Fest['itinerary_traversals'][number]): string {
    const routeTitle = traversal.route_title || 'No route';
    const itineraryTitle = traversal.itinerary_title || `Itinerary ${traversal.itinerary}`;
    const stage = traversal.stage_number === null ? '' : `\nStage: ${traversal.stage_number}`;
    return `Route: ${routeTitle}\nItinerary: ${itineraryTitle}${stage}`;
  }

  previewFestMedia(fest: Fest): FestMedia[] {
    return [...(fest.media || [])].sort((left, right) => (left.position || 0) - (right.position || 0));
  }

  festMediaUrl(item: FestMedia): string {
    return item.url || item.file_url || item.image_url || '';
  }

  festMediaLabel(item: FestMedia, index: number): string {
    return item.original_filename || `${this.festMediaTypeLabel(item.media_type)} ${index + 1}`;
  }

  festMediaTypeLabel(type: FestMedia['media_type']): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  countryName(countryCode: string | null | undefined): string {
    if (!countryCode) return '-';
    try {
      return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(countryCode) || countryCode;
    } catch {
      return countryCode;
    }
  }

  openCategoryManagerDialog(): void {
    this.categoryDialogStatusMessage = '';
    this.categoryDialogStatusIsError = false;
    if (this.availableCategories.length > 0) {
      this.selectCategoryForEditing(this.availableCategories[0]);
    } else {
      this.startNewCategory();
    }
    this.categoryManagerDialog?.nativeElement.showModal();
  }

  closeCategoryManagerDialog(): void {
    this.categoryManagerDialog?.nativeElement.close();
  }

  startNewCategory(): void {
    this.editingCategory = null;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = [{ language_code: 'en', name: '' }];
    this.mergeTargetCategoryId = null;
    this.categoryDialogStatusMessage = '';
    this.categoryDialogStatusIsError = false;
  }

  selectCategoryForEditing(category: FestCategory): void {
    this.editingCategory = category;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = category.translations.length
      ? category.translations.map(translation => ({
        language_code: translation.language_code,
        name: translation.name || '',
      }))
      : [{ language_code: 'en', name: category.name || category.slug }];
    this.mergeTargetCategoryId = null;
    this.categoryDialogStatusMessage = '';
    this.categoryDialogStatusIsError = false;
  }

  addCategoryTranslationDraft(): void {
    this.categoryTranslationDrafts.push({ language_code: '', name: '' });
  }

  mergeTargetCategories(): FestCategory[] {
    return this.availableCategories.filter(category => category.id !== this.editingCategory?.id);
  }

  openCategoryFestsInNewTab(category: FestCategory): void {
    const urlTree = this.router.createUrlTree(['/fests'], {
      queryParams: { category: category.id },
    });
    window.open(this.router.serializeUrl(urlTree), '_blank', 'noopener');
  }

  async saveCategoryDialog(): Promise<void> {
    const payload = this.categoryPayload();
    if (!payload) return;
    try {
      const category = this.editingCategory
        ? await firstValueFrom(this.api.updateFestCategory(this.editingCategory.id, payload))
        : await firstValueFrom(this.api.createFestCategory(payload));
      await this.reloadCategories();
      this.selectCategoryForEditing(this.availableCategories.find(item => item.id === category.id) || category);
      this.categoryDialogStatusMessage = 'Category saved.';
      this.categoryDialogStatusIsError = false;
      this.refreshList();
    } catch (error) {
      this.categoryDialogStatusMessage = `Could not save category. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.categoryDialogStatusIsError = true;
    }
  }

  async deleteSelectedCategory(): Promise<void> {
    if (!this.editingCategory) return;
    const deletedId = this.editingCategory.id;
    if (!window.confirm(`Delete category "${this.editingCategory.name || this.editingCategory.slug}"?`)) return;
    try {
      await firstValueFrom(this.api.deleteFestCategory(deletedId));
      if (this.selectedCategory === String(deletedId)) {
        this.selectedCategory = '';
        this.updateBrowserQueryParams();
      }
      await this.reloadCategories();
      if (this.availableCategories.length > 0) {
        this.selectCategoryForEditing(this.availableCategories[0]);
      } else {
        this.startNewCategory();
      }
      this.refreshList();
    } catch (error) {
      this.categoryDialogStatusMessage = `Could not delete category. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.categoryDialogStatusIsError = true;
    }
  }

  async mergeSelectedCategory(): Promise<void> {
    if (!this.editingCategory || !this.mergeTargetCategoryId) return;
    const sourceId = this.editingCategory.id;
    const targetId = this.mergeTargetCategoryId;
    const target = this.availableCategories.find(category => category.id === targetId);
    if (!window.confirm(`Merge "${this.editingCategory.name || this.editingCategory.slug}" into "${target?.name || target?.slug || 'the selected category'}"?`)) return;
    try {
      await firstValueFrom(this.api.mergeFestCategory(sourceId, targetId));
      if (this.selectedCategory === String(sourceId)) {
        this.selectedCategory = String(targetId);
        this.updateBrowserQueryParams();
      }
      await this.reloadCategories();
      const mergedTarget = this.availableCategories.find(category => category.id === targetId);
      if (mergedTarget) {
        this.selectCategoryForEditing(mergedTarget);
      }
      this.refreshList();
    } catch (error) {
      this.categoryDialogStatusMessage = `Could not merge category. ${error instanceof Error ? error.message : 'Request failed.'}`;
      this.categoryDialogStatusIsError = true;
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
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(this.previewMap);
    this.previewLayer = L.layerGroup().addTo(this.previewMap);
    this.previewClusterLayer = this.createPreviewClusterLayer().addTo(this.previewMap);
    this.previewMap.on('moveend zoomend', () => {
      this.updateDisplayedFestsFromPreviewMap();
      this.notifyFestMapViewChanged();
    });
    this.previewMap.on('layeradd layerremove', () => this.scheduleDisplayedFestsUpdate());
    this.previewResizeObserver = new ResizeObserver(() => {
      this.previewMap?.invalidateSize();
    });
    this.previewResizeObserver.observe(this.previewMapElement.nativeElement);
    this.fitPreviewMapToWorld();
  }

  private showWorldMapWhileFestsLoad(): void {
    this.selectedFestIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewFest = null;
    this.previewLayer?.clearLayers();
    this.clearPreviewClusterLayer();
    this.displayedFests = [];
    this.previewMessage = '';
    this.initializePreviewMap();
    this.fitPreviewMapToWorld();
  }

  private renderSelectedFestPreview(shouldFit: boolean): void {
    if (this.selectedFestIds.size === 0) return;
    const selected = this.selectedFests();
    if (selected.length === 0) {
      this.selectedFestIds.clear();
      this.selectedPreviewFitLocked = false;
      this.previewFest = null;
      this.renderVisibleFestsPreview(false);
      return;
    }
    this.previewFest = selected[0] || null;
    this.renderPreviewFests(this.currentFests, shouldFit, 'visible fests', new Set(selected.map(fest => fest.id)));
  }

  private renderVisibleFestsPreview(shouldFit = false): void {
    this.previewFest = null;
    if (this.currentFests.length === 0 && this.mapClusters.length > 0) {
      this.renderServerClusterPreview(this.mapClusters, shouldFit);
      return;
    }
    if (this.currentFests.length === 0) {
      this.previewLayer?.clearLayers();
      this.clearPreviewClusterLayer();
      this.displayedFests = [];
      this.previewMessage = 'No fests found.';
      if (shouldFit) {
        this.fitPreviewMapToWorld();
      } else {
        this.previewMap?.invalidateSize(false);
      }
      return;
    }
    if (this.selectedFestIds.size === 0) {
      this.renderClusteredFestsPreview(this.currentFests, shouldFit);
      return;
    }
    this.renderPreviewFests(this.currentFests, shouldFit, 'visible fests');
  }

  private renderServerClusterPreview(clusters: FestMapClusterResult[], shouldFit = false): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    this.displayedFests = [];
    clusters.forEach(cluster => {
      L.marker([cluster.lat, cluster.lng], {
        icon: this.previewClusterIcon(cluster.count),
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
      ? `${clusters[0].count} fests in this area. Zoom in to inspect them.`
      : `${this.festTotalCount} fests in this area. Zoom in to inspect them.`;
  }

  private renderPreviewFests(
    fests: Fest[],
    shouldFit: boolean,
    label: string,
    fitFestIds?: Set<number>
  ): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    if (!fests.length) {
      this.previewMessage = this.previewFest ? 'Selected fest is not visible.' : 'No fests to show.';
      this.changeDetector.detectChanges();
      return;
    }

    const bounds = L.latLngBounds([]);
    const fitBounds = L.latLngBounds([]);
    let validCoordinateCount = 0;
    for (const fest of fests) {
      const selected = this.previewFest?.id === fest.id;
      if (Number.isFinite(fest.gps_latitude) && Number.isFinite(fest.gps_longitude)) {
        const latLng = [fest.gps_latitude, fest.gps_longitude];
        validCoordinateCount += 1;
        const marker = L.marker(latLng, { icon: this.previewMarkerIcon(selected) })
          .bindTooltip(fest.title || `Fest ${fest.id}`)
          .on('click', () => this.selectFestFromPreviewMarker(fest));
        marker.addTo(this.previewLayer);
        bounds.extend(latLng);
        if (!fitFestIds || fitFestIds.has(fest.id)) {
          fitBounds.extend(latLng);
        }
      }
    }

    if (shouldFit) {
      this.fitPreviewBounds(fitBounds.isValid() ? fitBounds : bounds);
    } else {
      this.previewMap.invalidateSize(false);
    }

    if (validCoordinateCount === 0) {
      this.previewMessage = `The ${label} do not have valid coordinates.`;
    } else {
      this.previewMessage = validCoordinateCount === 1
        ? '1 fest with coordinates.'
        : `${validCoordinateCount} fests with coordinates.`;
    }
    this.changeDetector.detectChanges();
  }

  private renderClusteredFestsPreview(fests: Fest[], shouldFit = true): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer || !this.previewClusterLayer) return;

    this.previewLayer.clearLayers();
    this.clearPreviewClusterLayer();
    const bounds = L.latLngBounds([]);
    let validCoordinateCount = 0;

    fests.forEach(fest => {
      if (!Number.isFinite(fest.gps_latitude) || !Number.isFinite(fest.gps_longitude)) return;
      const latLng = [fest.gps_latitude, fest.gps_longitude];
      validCoordinateCount += 1;
      bounds.extend(latLng);
      const marker = L.marker(latLng, {
        icon: this.previewMarkerIcon(false),
      }).on('click', () => this.selectFestFromPreviewMarker(fest));
      this.previewMarkerFests.set(marker, fest);
      this.previewClusterLayer.addLayer(marker);
    });

    if (!shouldFit) {
      this.previewMap.invalidateSize(false);
    } else if (bounds.isValid()) {
      this.fitPreviewBounds(bounds);
    } else {
      this.fitPreviewMapToWorld();
    }

    this.displayedFests = this.displayedFestsForCurrentMapResponse(fests);
    this.previewMessage = validCoordinateCount === 0 ? 'The fests do not have valid coordinates.' : '';
    this.scheduleDisplayedFestsUpdate();
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
      iconCreateFunction: (cluster: any) => this.previewClusterIcon(cluster.getChildCount()),
    });
  }

  private clearPreviewClusterLayer(): void {
    this.previewMarkerFests.clear();
    this.previewClusterLayer?.clearLayers();
  }

  private scheduleDisplayedFestsUpdate(): void {
    const requestId = ++this.displayedFestsUpdateRequestId;
    window.requestAnimationFrame(() => {
      if (requestId !== this.displayedFestsUpdateRequestId) return;
      this.updateDisplayedFestsFromPreviewMap();
    });
  }

  private updateDisplayedFestsFromPreviewMap(): void {
    if (this.selectedFestIds.size > 0 || !this.previewMap || !this.previewClusterLayer) {
      return;
    }
    if (this.mapResponseMode === 'fests') {
      this.displayedFests = this.sortedFests(this.currentFests);
      this.previewMessage = '';
      this.pruneSelectedFests();
      this.changeDetector.detectChanges();
      return;
    }
    const bounds = this.previewMap.getBounds();
    if (!bounds?.isValid?.()) {
      this.displayedFests = this.sortedFests(this.currentFests).slice(0, MAX_DISPLAYED_CLUSTER_FESTS);
      this.changeDetector.detectChanges();
      return;
    }
    const visibleFests: Fest[] = [];
    const clusteredFests: Fest[] = [];
    this.previewMarkerFests.forEach((fest, marker) => {
      if (!bounds.contains(marker.getLatLng())) return;
      const visibleParent = typeof this.previewClusterLayer.getVisibleParent === 'function'
        ? this.previewClusterLayer.getVisibleParent(marker)
        : marker;
      if (visibleParent === marker) {
        visibleFests.push(fest);
      } else {
        clusteredFests.push(fest);
      }
    });
    if (visibleFests.length > 0) {
      this.displayedFests = this.sortedFests(visibleFests).slice(0, MAX_DISPLAYED_CLUSTER_FESTS);
    } else {
      this.displayedFests = this.sortedFests(clusteredFests).slice(0, MAX_DISPLAYED_CLUSTER_FESTS);
    }
    this.previewMessage = '';
    this.pruneSelectedFests();
    this.changeDetector.detectChanges();
  }

  private displayedFestsForCurrentMapResponse(fests: Fest[]): Fest[] {
    const sorted = this.sortedFests(fests);
    return this.mapResponseMode === 'fests' ? sorted : sorted.slice(0, MAX_DISPLAYED_CLUSTER_FESTS);
  }

  private previewClusterIcon(count: number): any {
    const label = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count);
    return L.divIcon({
      className: 'preview-marker poi-cluster-marker',
      html: `<span>${label}</span>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
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
        this.scheduleDisplayedFestsUpdate();
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
        this.scheduleDisplayedFestsUpdate();
      });
    });
  }

  private previewMarkerIcon(selected = false): any {
    return L.divIcon({
      className: `preview-marker poi-preview-marker${selected ? ' selected' : ''}`,
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  private sortedFests(fests: Fest[]): Fest[] {
    const direction = this.festSortDirection === 'asc' ? 1 : -1;
    return [...fests].sort((left, right) => {
      let comparison = 0;
      if (this.festSortKey === 'title') {
        comparison = (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' });
      } else if (this.festSortKey === 'traversals') {
        comparison = (left.itinerary_traversals?.length || 0) - (right.itinerary_traversals?.length || 0)
          || (left.itinerary_traversals?.[0]?.route_title || '').localeCompare(right.itinerary_traversals?.[0]?.route_title || '', undefined, { sensitivity: 'base' });
      } else if (this.festSortKey === 'country') {
        comparison = this.countryName(left.country_code).localeCompare(this.countryName(right.country_code));
      } else if (this.festSortKey === 'draft') {
        comparison = Number(left.enabled) - Number(right.enabled);
      } else if (this.festSortKey === 'media') {
        comparison = (left.media?.length || 0) - (right.media?.length || 0);
      }
      return (comparison || left.id - right.id) * direction;
    });
  }

  private sortedCategories(categories: FestCategory[]): FestCategory[] {
    return [...categories].sort((left, right) =>
      (left.name || left.slug).localeCompare(right.name || right.slug, undefined, { sensitivity: 'base' })
      || left.id - right.id
    );
  }

  private pruneSelectedFests(): void {
    const visibleIds = new Set(this.currentFests.map(fest => fest.id));
    [...this.selectedFestIds].forEach(id => {
      if (!visibleIds.has(id)) this.selectedFestIds.delete(id);
    });
    if (this.selectedFestIds.size === 0) {
      this.previewFest = null;
      this.selectedPreviewFitLocked = false;
      return;
    }
    this.previewFest = this.currentFests.find(fest => this.selectedFestIds.has(fest.id)) || null;
  }

  private confirmFestDraftChange(fest: Fest, enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    return window.confirm(`Really ${action} fest "${fest.title || 'Untitled fest'}"?`);
  }

  private duplicatedTranslations(translations: Translation[], title: string | null, description: string | null) {
    const source = translations.length
      ? translations
      : [{ language_code: 'en', title: title || 'Untitled fest', description: description || '', is_reference: true }];
    return source.map(translation => ({
      language_code: translation.language_code,
      title: `${translation.title || title || 'Untitled fest'} copy`,
      description: translation.description || '',
      slug: '',
      is_reference: Boolean(translation.is_reference),
    }));
  }

  private duplicatedMedia(media: FestMedia[]): FestMedia[] {
    return (media || [])
      .filter(item => item.url)
      .map(item => ({
        media_type: item.media_type,
        url: item.url,
        position: item.position,
        is_primary: item.is_primary,
        translations: item.translations || [],
      }));
  }

  private categoryPayload(): FestCategoryPayload | null {
    const translations = this.categoryTranslationDrafts
      .map(translation => ({
        language_code: translation.language_code.trim(),
        name: translation.name.trim(),
      }))
      .filter(translation => translation.language_code || translation.name);
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.name)) {
      this.categoryDialogStatusMessage = 'Each category translation needs a language and name.';
      this.categoryDialogStatusIsError = true;
      return null;
    }
    return {
      slug: this.editingCategory?.slug || this.slugFromText(translations[0].name),
      translations,
    };
  }

  private emptyCategoryDraft(): CategoryDraft {
    return {};
  }

  private async reloadCategories(): Promise<void> {
    this.availableCategories = this.sortedCategories(await firstValueFrom(this.api.listAllFestCategories()));
  }

  private fetchMapFests(query: string): Observable<{ fests: Fest[]; clusters: FestMapClusterResult[]; count: number; mode: FestMapMode }> {
    const view = this.currentPreviewMapQuery();
    this.lastFestMapViewKey = view.key;
    return this.api.mapFests(
      query,
      '',
      undefined,
      this.selectedCategory,
      this.selectedCountry,
      view.bbox,
      view.zoom
    ).pipe(
      map(response => ({
        fests: response.results
          .filter(result => result.type === 'fest')
          .map(result => result.fest),
        clusters: response.results
          .filter((result): result is FestMapClusterResult => result.type === 'cluster'),
        count: response.count,
        mode: response.mode,
      }))
    );
  }

  private notifyFestMapViewChanged(): void {
    if (this.selectedFestIds.size > 0 || !this.previewMap) return;
    const view = this.currentPreviewMapQuery();
    if (view.key === this.lastFestMapViewKey) return;
    this.lastFestMapViewKey = view.key;
    if (Date.now() < this.suppressFestMapRefreshUntil) {
      return;
    }
    this.selectedFestIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewFest = null;
    this.mapView$.next(this.mapView$.value + 1);
  }

  private suppressFestMapRefreshForProgrammaticFocus(): void {
    this.suppressFestMapRefreshUntil = Date.now() + 700;
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
      key: `${bbox}|${zoom}`,
    };
  }

  private selectedFests(): Fest[] {
    return this.currentFests.filter(fest => this.selectedFestIds.has(fest.id));
  }

  private restoreFiltersFromQueryParams(): void {
    const params = this.activatedRoute.snapshot.queryParamMap;
    this.query = params.get('q') || '';
    this.selectedCategory = params.get('category') || '';
    this.selectedCountry = (params.get('country') || '').toUpperCase();
    this.query$.next(this.query);
  }

  private updateBrowserQueryParams(): void {
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        q: this.query || null,
        category: this.selectedCategory || null,
        country: this.selectedCountry || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private openUrlTreeInNewTab(urlTree: UrlTree): void {
    window.open(this.router.serializeUrl(urlTree), '_blank', 'noopener');
  }

  festRowId(fest: Fest): string {
    return `fest-row-${fest.id}`;
  }

  private slugFromText(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'category';
  }

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }
}
