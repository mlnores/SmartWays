import { AsyncPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, Observable, of, startWith, switchMap } from 'rxjs';

import { ApiPage, ApiService, Category, Poi, Translation } from './api.service';

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
  gps_latitude: number | null;
  gps_longitude: number | null;
  category_ids: number[];
}

interface CategoryTranslationDraft {
  language_code: string;
  name: string;
}

interface CategoryDraft {
  slug: string;
}

interface ItineraryPointExport {
  type?: string;
  id?: number | string;
}

interface ItineraryJsonExport {
  points?: ItineraryPointExport[];
}

interface MapBoundsFilter {
  south: number;
  west: number;
  north: number;
  east: number;
}

declare const L: any;

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>{{ itineraryId ? 'Itinerary POIs' : 'POIs' }}</h1>
          <p>
            @if (itineraryId) {
              POIs included in {{ itineraryTitle || 'this itinerary' }}.
            } @else {
              Browse and manage points of interest from the backend API.
            }
          </p>
        </div>
        @if (itineraryId) {
          <a class="secondary" [routerLink]="backLink">{{ backLabel }}</a>
        } @else {
          <div class="list-actions">
            <button type="button" class="secondary" (click)="openCategoryManagerDialog()">Manage categories</button>
            <button type="button" class="primary" title="New POI" aria-label="New POI" (click)="openNewPoiDialog()">New POI</button>
          </div>
        }
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title or category"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
        <select
          class="toolbar-select"
          aria-label="Filter by category"
          [(ngModel)]="selectedCategory"
          (ngModelChange)="refresh$.next(refresh$.value + 1)"
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
          (ngModelChange)="refresh$.next(refresh$.value + 1)"
        >
          <option value="">All countries</option>
          @for (countryCode of availableCountries; track countryCode) {
            <option [value]="countryCode">{{ countryName(countryCode) }}</option>
          }
        </select>
        <button type="button" class="secondary toolbar-action" (click)="filterToPreviewArea()">
          <span aria-hidden="true">▣</span>
          <span>Filter to map area</span>
        </button>
        @if (mapBoundsFilter) {
          <button type="button" class="secondary filter-chip" title="Remove map area filter" aria-label="Remove map area filter" (click)="clearMapAreaFilter()">
            <span>Map area filter</span>
            <span aria-hidden="true">×</span>
          </button>
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
                      <th class="selection-column" aria-label="Select">
                        <input
                          type="checkbox"
                          title="Select all POIs"
                          aria-label="Select all POIs"
                          [checked]="areAllPoisSelected(state.items)"
                          [indeterminate]="areSomePoisSelected(state.items)"
                          (change)="setPoisSelected(state.items, $any($event.target).checked)"
                        />
                      </th>
                      <th class="poi-name-column">POI</th>
                      <th>Included in</th>
                      <th>Categories</th>
                      <th>Country</th>
                      <th class="enabled-column">Draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (poi of state.items; track poi.id) {
                      <tr
                        [attr.id]="poiRowId(poi)"
                        [class.highlight-row]="highlightedPoiId === poi.id"
                        [class.preview-selected-row]="selectedPoiIds.has(poi.id)"
                        (click)="setPoiSelected(poi, !selectedPoiIds.has(poi.id))"
                      >
                        <td class="selection-column" (click)="$event.stopPropagation()">
                          <input
                            type="checkbox"
                            title="Select POI for preview"
                            aria-label="Select POI for preview"
                            [checked]="selectedPoiIds.has(poi.id)"
                            (change)="setPoiSelected(poi, $any($event.target).checked)"
                          />
                        </td>
                        <td class="poi-name-column">
                          <strong>{{ poi.title || 'Untitled POI' }}</strong>
                          <p class="description-preview">{{ poi.description || 'No description' }}</p>
                        </td>
                        <td>
                          <div class="route-membership-badges">
                            @for (inclusion of poi.itinerary_inclusions; track inclusion.itinerary) {
                              <span class="route-membership-badge poi-inclusion-badge">
                                <span>{{ inclusion.itinerary_title || 'Itinerary ' + inclusion.itinerary }}</span>
                                @if (inclusion.stage_number !== null) {
                                  <span>{{ inclusion.stage_number }}</span>
                                }
                              </span>
                            } @empty {
                              <span class="muted">No itineraries</span>
                            }
                          </div>
                        </td>
                        <td>
                          @if (poi.categories.length) {
                            <div class="chip-list">
                              @for (category of poi.categories; track category.id) {
                                <span class="small-chip">{{ category.name || category.slug }}</span>
                              }
                            </div>
                          } @else {
                            <span class="muted">No categories</span>
                          }
                        </td>
                        <td>{{ countryName(poi.country_code) }}</td>
                        <td class="enabled-column" (click)="$event.stopPropagation()">
                          <input
                            class="enabled-checkbox"
                            type="checkbox"
                            title="Draft"
                            aria-label="Draft"
                            [checked]="!poi.enabled"
                            (change)="setPoiEnabled(poi, !$any($event.target).checked)"
                          />
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="6">No POIs found.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="load-more-row">
                @if (poiNextPage !== null) {
                  <button type="button" class="secondary" [disabled]="loadingMorePois" (click)="loadMorePois()">
                    {{ loadingMorePois ? 'Loading...' : 'Load more' }}
                  </button>
                }
              </div>
            </div>
            <aside class="preview-panel" aria-label="POI map preview">
              <header>
                <h2>Map preview</h2>
                <p>{{ poiCountLabel(state.items.length) }}</p>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
              <div class="preview-actions" aria-label="POI preview actions">
                <button type="button" class="secondary preview-action" (click)="fitPreviewToCurrentPois()">
                  <span class="preview-action-icon" aria-hidden="true">🎯</span>
                  <span>Fit view to selection</span>
                </button>

                @if (selectedPoiIds.size > 1) {
                  <button type="button" class="secondary preview-action danger-action" (click)="deleteSelectedPois()">
                    <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                    <span>Delete selected POIs</span>
                  </button>
                } @else if (previewPoi) {
                  <a class="secondary preview-action" [routerLink]="['/pois', previewPoi.id, 'edit']">
                    <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                    <span>Open in editor</span>
                  </a>
                  <button type="button" class="secondary preview-action danger-action" (click)="deletePoi(previewPoi)">
                    <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                    <span>Delete POI</span>
                  </button>
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
              <label>
                <span>Slug</span>
                <input type="text" [(ngModel)]="categoryDraft.slug" name="categorySlug" placeholder="category-slug" />
              </label>

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
            <button type="button" class="secondary" (click)="closeCategoryManagerDialog()">Close</button>
            <button type="submit" class="primary">{{ editingCategory ? 'Save category' : 'Create category' }}</button>
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

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  readonly mapFilter$ = new BehaviorSubject(0);
  query = '';
  itineraryId: string | null = null;
  itineraryTitle: string | null = null;
  itineraryPoiIds: string[] = [];
  selectedCategory = '';
  selectedCountry = '';
  statusMessage = '';
  statusIsError = false;
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
  mergeTargetCategoryId: number | null = null;
  readonly selectedPoiIds = new Set<number>();
  currentPois: Poi[] = [];
  poiTotalCount = 0;
  poiNextPage: number | null = null;
  loadingMorePois = false;
  mapBoundsFilter: MapBoundsFilter | null = null;
  highlightedPoiId: number | null = null;
  previewPoi: Poi | null = null;
  previewMessage = 'Click a POI to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewFilterLayer: any = null;
  private previewResizeObserver: ResizeObserver | null = null;
  private previewFitRequestId = 0;
  private selectedPreviewFitLocked = false;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.mapFilter$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('id')))
  ]).pipe(
    switchMap(([query, , , itineraryId]) => {
      this.itineraryId = itineraryId;
      const itinerary$ = itineraryId ? this.api.getItinerary(itineraryId) : of(null);
      return combineLatest([
        itinerary$,
        this.api.listAllCategories(),
        this.api.listPoiCountries()
      ]).pipe(
        switchMap(([itinerary, categories, countries]) => {
          this.availableCategories = categories;
          this.availableCountries = countries;
          this.itineraryTitle = itinerary?.title || null;
          this.itineraryPoiIds = itinerary ? this.poiIdsForItinerary(itinerary.itinerary_json) : [];
          if (itineraryId && this.itineraryPoiIds.length === 0) {
            this.currentPois = [];
            this.poiTotalCount = 0;
            this.poiNextPage = null;
            this.renderVisiblePoisPreview([]);
            return of({ items: [] as Poi[], count: 0, error: '' });
          }
          return this.fetchPoiPage(query, 1).pipe(
            map(page => {
              this.currentPois = page.results;
              this.poiTotalCount = page.count;
              this.poiNextPage = page.next ? 2 : null;
              this.pruneSelectedPois(this.currentPois);
              if (this.selectedPoiIds.size > 0) {
                this.renderSelectedPoiPreviewIfNeeded(!this.selectedPreviewFitLocked);
              } else {
                this.renderVisiblePoisPreview(this.currentPois);
              }
              return { items: this.currentPois, count: page.count, error: '' };
            })
          );
        }),
        catchError(error => {
          this.currentPois = [];
          this.poiTotalCount = 0;
          this.poiNextPage = null;
          this.loadingMorePois = false;
          return of({ items: [] as Poi[], count: 0, error: `Could not load POIs. ${error.message}` });
        })
      );
    }),
    startWith({ items: [] as Poi[], count: 0, error: '' })
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
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  selectPreviewPoi(poi: Poi): void {
    this.previewPoi = poi;
    if (this.selectedPoiIds.size > 0) {
      this.selectedPoiIds.clear();
      this.selectedPreviewFitLocked = false;
    }
    this.renderPreviewPoi(poi);
  }

  setPoiSelected(poi: Poi, selected: boolean): void {
    if (selected) {
      this.selectedPoiIds.add(poi.id);
    } else {
      this.selectedPoiIds.delete(poi.id);
    }
    this.previewPoi = this.selectedPoiIds.size === 1 ? this.selectedPois()[0] || null : null;
    if (this.selectedPoiIds.size > 0) {
      const shouldFit = !this.selectedPreviewFitLocked;
      if (this.selectedPoiIds.size >= 2) {
        this.selectedPreviewFitLocked = true;
      }
      this.renderSelectedPoiPreviewIfNeeded(shouldFit);
    } else {
      this.selectedPreviewFitLocked = false;
      this.previewPoi = null;
      this.renderVisiblePoisPreview(this.currentPois);
    }
  }

  setPoisSelected(pois: Poi[], selected: boolean): void {
    pois.forEach(poi => {
      if (selected) {
        this.selectedPoiIds.add(poi.id);
      } else {
        this.selectedPoiIds.delete(poi.id);
      }
    });
    this.previewPoi = this.selectedPoiIds.size === 1 ? this.selectedPois()[0] || null : null;
    if (this.selectedPoiIds.size > 0) {
      if (this.selectedPoiIds.size >= 2) {
        this.selectedPreviewFitLocked = true;
      }
      this.renderSelectedPoiPreviewIfNeeded(true);
    } else {
      this.selectedPreviewFitLocked = false;
      this.previewPoi = null;
      this.renderVisiblePoisPreview(this.currentPois);
    }
  }

  areAllPoisSelected(pois: Poi[]): boolean {
    return pois.length > 0 && pois.every(poi => this.selectedPoiIds.has(poi.id));
  }

  areSomePoisSelected(pois: Poi[]): boolean {
    return pois.some(poi => this.selectedPoiIds.has(poi.id)) && !this.areAllPoisSelected(pois);
  }

  fitPreviewToCurrentPois(): void {
    if (this.selectedPoiIds.size > 0) {
      this.renderSelectedPoiPreviewIfNeeded(true);
    } else {
      this.renderVisiblePoisPreview(this.currentPois);
    }
  }

  poiCountLabel(visibleCount: number): string {
    const suffix = this.hasActivePoiFilters() ? ' matching the filter(s)' : '';
    return `Showing ${visibleCount} of ${this.poiTotalCount} POIs${suffix}`;
  }

  selectPoiFromPreviewMarker(poi: Poi): void {
    this.setPoiSelected(poi, true);
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

  filterToPreviewArea(): void {
    if (!this.previewMap) return;
    const bounds = this.previewMap.getBounds();
    this.mapBoundsFilter = {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };
    this.selectedPoiIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewPoi = null;
    this.mapFilter$.next(this.mapFilter$.value + 1);
    this.drawMapBoundsFilter();
  }

  clearMapAreaFilter(): void {
    this.mapBoundsFilter = null;
    this.previewFilterLayer?.clearLayers();
    this.selectedPoiIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewPoi = null;
    this.mapFilter$.next(this.mapFilter$.value + 1);
  }

  async loadMorePois(): Promise<void> {
    if (this.poiNextPage === null || this.loadingMorePois) return;
    const pageToLoad = this.poiNextPage;
    this.loadingMorePois = true;
    try {
      const page = await firstValueFrom(this.fetchPoiPage(this.query, pageToLoad));
      const existingIds = new Set(this.currentPois.map(poi => poi.id));
      const newPois = page.results.filter(poi => !existingIds.has(poi.id));
      this.currentPois.push(...newPois);
      this.poiTotalCount = page.count;
      this.poiNextPage = page.next ? pageToLoad + 1 : null;
      this.pruneSelectedPois(this.currentPois);
      if (this.selectedPoiIds.size > 0) {
        this.renderSelectedPoiPreviewIfNeeded(false);
      } else {
        this.renderVisiblePoisPreview(this.currentPois);
      }
      this.clearStatus();
    } catch (error) {
      this.showStatus(`Could not load more POIs. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.loadingMorePois = false;
    }
  }

  private hasActivePoiFilters(): boolean {
    return Boolean(
      this.query.trim()
      || this.selectedCategory
      || this.selectedCountry
      || this.mapBoundsFilter
      || this.itineraryId
    );
  }

  async setPoiEnabled(poi: Poi, enabled: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.updatePoi(poi.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
    this.mergeTargetCategoryId = null;
  }

  startNewCategory(): void {
    this.editingCategory = null;
    this.categoryDraft = this.emptyCategoryDraft();
    this.categoryTranslationDrafts = [{ language_code: 'en', name: '' }];
    this.mergeTargetCategoryId = null;
  }

  selectCategoryForEditing(category: Category): void {
    this.editingCategory = category;
    this.categoryDraft = { slug: category.slug || '' };
    this.categoryTranslationDrafts = category.translations.length > 0
      ? category.translations.map(translation => ({
        language_code: translation.language_code,
        name: translation.name || ''
      }))
      : [{ language_code: 'en', name: category.name || '' }];
    this.mergeTargetCategoryId = null;
  }

  addCategoryTranslationDraft(): void {
    this.categoryTranslationDrafts.push({ language_code: '', name: '' });
  }

  mergeTargetCategories(): Category[] {
    return this.availableCategories.filter(category => category.id !== this.editingCategory?.id);
  }

  async saveCategoryDialog(): Promise<void> {
    const slug = this.categoryDraft.slug.trim();
    const translations = this.normalizedCategoryTranslations();
    if (!slug) {
      this.showStatus('Category slug is required.', true);
      return;
    }
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.name)) {
      this.showStatus('Every category translation needs a language and name.', true);
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
      this.clearStatus();
      const savedCategory = editingCategoryId
        ? this.availableCategories.find(category => category.id === editingCategoryId)
        : this.availableCategories.find(category => category.slug === slug);
      if (savedCategory) {
        this.selectCategoryForEditing(savedCategory);
      }
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async mergeSelectedCategory(): Promise<void> {
    if (!this.editingCategory || !this.mergeTargetCategoryId) {
      this.showStatus('Select a target category to merge into.', true);
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
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not merge category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deletePoi(poi: Poi): Promise<void> {
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

  async deleteSelectedPois(): Promise<void> {
    const selected = this.selectedPois();
    if (selected.length < 2) return;
    const confirmed = window.confirm(`Delete ${selected.length} selected POIs? Itineraries that reference them will not be deleted.`);
    if (!confirmed) return;

    try {
      await Promise.all(selected.map(poi => firstValueFrom(this.api.deletePoi(poi.id))));
      this.selectedPoiIds.clear();
      this.selectedPreviewFitLocked = false;
      this.previewPoi = null;
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete selected POIs. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
    this.previewFilterLayer = L.layerGroup().addTo(this.previewMap);
    this.previewResizeObserver = new ResizeObserver(() => {
      this.previewMap?.invalidateSize();
    });
    this.previewResizeObserver.observe(this.previewMapElement.nativeElement);
    window.requestAnimationFrame(() => this.previewMap?.invalidateSize());
  }

  private renderPreviewPoi(poi: Poi): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.drawMapBoundsFilter();
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
    this.renderPreviewPois(selected, shouldFit, 'selected POIs');
  }

  private renderVisiblePoisPreview(pois: Poi[]): void {
    this.previewPoi = null;
    if (pois.length === 0) {
      this.previewLayer?.clearLayers();
      this.drawMapBoundsFilter();
      this.previewMessage = 'No POIs found.';
      this.fitPreviewMapToWorld();
      return;
    }
    this.renderPreviewPois(pois, true, 'visible POIs');
  }

  private renderPreviewPois(pois: Poi[], shouldFit = true, scopeLabel = 'POIs'): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    this.drawMapBoundsFilter();
    const bounds = L.latLngBounds([]);
    let validCoordinateCount = 0;

    pois.forEach(poi => {
      if (!Number.isFinite(poi.gps_latitude) || !Number.isFinite(poi.gps_longitude)) return;
      const latLng = [poi.gps_latitude, poi.gps_longitude];
      validCoordinateCount += 1;
      bounds.extend(latLng);
      L.marker(latLng, {
        icon: this.previewMarkerIcon()
      })
        .on('click', () => this.selectPoiFromPreviewMarker(poi))
        .addTo(this.previewLayer);
    });

    if (shouldFit) {
      this.fitPreviewBounds(bounds);
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
  }

  private previewMarkerIcon(): any {
    return L.divIcon({
      className: 'preview-marker poi-preview-marker',
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  private drawMapBoundsFilter(): void {
    if (!this.previewFilterLayer) return;
    this.previewFilterLayer.clearLayers();
    if (!this.mapBoundsFilter) return;
    L.rectangle(
      [
        [this.mapBoundsFilter.south, this.mapBoundsFilter.west],
        [this.mapBoundsFilter.north, this.mapBoundsFilter.east]
      ],
      {
        color: '#1f6feb',
        weight: 2,
        opacity: 0.9,
        dashArray: '3 6',
        fill: true,
        fillColor: '#93c5fd',
        fillOpacity: 0.22,
        interactive: false
      }
    ).addTo(this.previewFilterLayer);
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
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
    });
  }

  private fitPreviewMapToWorld(): void {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      this.previewMap.fitWorld({ animate: false });
      window.requestAnimationFrame(() => this.previewMap?.invalidateSize(false));
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
      gps_latitude: null,
      gps_longitude: null,
      category_ids: []
    };
  }

  private emptyCategoryDraft(): CategoryDraft {
    return { slug: '' };
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
    for (const point of json.points || []) {
      if (point.type !== 'poi' || point.id === undefined || point.id === null) continue;
      const id = String(point.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  private fetchPoiPage(query: string, page: number): Observable<ApiPage<Poi>> {
    return this.api.listPois(
      query,
      '',
      undefined,
      this.selectedCategory,
      this.selectedCountry,
      this.itineraryId ? this.itineraryPoiIds : undefined,
      this.mapBoundsFilter ? this.bboxParam(this.mapBoundsFilter) : undefined,
      page
    );
  }

  private selectedPois(): Poi[] {
    return this.currentPois.filter(poi => this.selectedPoiIds.has(poi.id));
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

  private bboxParam(bounds: MapBoundsFilter): string {
    return [bounds.west, bounds.south, bounds.east, bounds.north].join(',');
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
