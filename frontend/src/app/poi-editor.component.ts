import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService, Category, GeoJsonPolygonGeometry, Poi, PoiMedia, PoiMediaTranslation, Translation } from './api.service';
import { PageInstructionService } from './page-instruction.service';

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
  slug: string;
  is_reference: boolean;
}

interface MediaDraft {
  id?: number;
  media_type: PoiMedia['media_type'];
  source: 'local' | 'remote';
  url: string;
  file_url?: string;
  original_filename?: string;
  content_type?: string;
  size?: number | null;
  selectedFile?: File;
  selectedPreviewUrl?: string;
  uploading?: boolean;
  captions: Record<string, string>;
  position: number;
  is_primary: boolean;
}

type EditorTab = 'basic' | 'translations' | 'media';

interface FootprintPoint {
  lat: number;
  lng: number;
}

declare const L: any;

@Component({
  selector: 'app-poi-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="page poi-editor-page">
      <header class="page-header">
        <div class="poi-editor-heading">
          <div>
            <div class="title-with-switch">
              <h1>{{ isNewPoi ? 'New POI' : (poi?.title || 'POI editor') }}</h1>
              <div class="publication-switch">
                <div class="view-toggle publication-toggle" aria-label="Publication state">
                  <button type="button" [class.active]="!enabled" (click)="setPublicationState(false)">Draft</button>
                  <button type="button" [class.active]="enabled" (click)="setPublicationState(true)">Public (read-only)</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="list-actions poi-save-actions">
          <button type="button" class="primary" [disabled]="saving || loading || isReadOnlyPublicPoi() || !canSave()" (click)="savePoi()">
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
          @if (statusMessage && !statusIsError) {
            <p class="inline-save-status">{{ statusMessage }}</p>
          }
        </div>
      </header>

      @if (statusMessage && statusIsError) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (loading) {
        <p class="status">Loading POI...</p>
      } @else if (editorReady) {
        <div class="editor-shell">
          <nav class="editor-tabs" aria-label="POI editor sections">
            <button type="button" [class.active]="activeTab === 'basic'" (click)="setActiveTab('basic')">Basic info</button>
            <button type="button" [class.active]="activeTab === 'media'" (click)="setActiveTab('media')">Media</button>
            <button type="button" [class.active]="activeTab === 'translations'" (click)="setActiveTab('translations')">Translations</button>
          </nav>

          @if (activeTab === 'basic') {
            <section class="editor-panel basic-editor-panel">
              <div class="basic-layout">
                <div class="basic-form-panel">
                  <div class="section-heading">
                    <h2>Basic info in reference language</h2>
                  </div>

                  @if (referenceTranslation(); as reference) {
                    <div class="form-grid compact-form-grid">
                      <label>
                        <span>Language</span>
                        <input type="text" [(ngModel)]="reference.language_code" name="referenceLanguage" [disabled]="!canEditContent()" />
                      </label>
                      <label class="metadata-full-row">
                        <span>Title</span>
                        <span class="title-refresh-row">
                          <input
                            type="text"
                            [class.stale-title]="titleNeedsRefresh"
                            [(ngModel)]="reference.title"
                            (ngModelChange)="referenceTitleChanged()"
                            name="referenceTitle"
                            [disabled]="!canEditContent()"
                          />
                          <button
                            type="button"
                            class="secondary title-refresh-button"
                            title="Use place name from geocoder"
                            aria-label="Use place name from geocoder"
                            [disabled]="!canEditContent() || geocodingTitle || !hasValidCoordinates()"
                            (click)="refreshTitleFromGeocoder()"
                          >
                            {{ geocodingTitle ? '...' : '↻' }}
                          </button>
                        </span>
                      </label>
                      <label class="metadata-full-row">
                        <span>Description</span>
                        <textarea rows="6" [(ngModel)]="reference.description" name="referenceDescription" [disabled]="!canEditContent()"></textarea>
                      </label>
                    </div>
                  }

                  <div class="section-heading spaced-section-heading">
                    <h2>Location</h2>
                  </div>
                  <div class="form-grid location-form-grid">
                    <label>
                      <span>Latitude</span>
                      <input type="number" step="any" [(ngModel)]="latitude" (ngModelChange)="coordinatesChanged()" name="latitude" [disabled]="!canEditContent()" />
                    </label>
                    <label>
                      <span>Longitude</span>
                      <input type="number" step="any" [(ngModel)]="longitude" (ngModelChange)="coordinatesChanged()" name="longitude" [disabled]="!canEditContent()" />
                    </label>
                    <label>
                      <span>Country</span>
                      <span class="country-value">{{ countryCode || 'Pending location' }}</span>
                    </label>
                    <div class="area-edit-cell">
                      <span>Area</span>
                      <button type="button" class="secondary" [class.active]="isEditingFootprint" [disabled]="!canEditContent() || !hasValidCoordinates()" (click)="openFootprintEditor()">
                        Edit area
                      </button>
                    </div>
                    <label class="metadata-full-row">
                      <span>Website</span>
                      <input type="url" [(ngModel)]="website" name="website" [disabled]="!canEditContent()" />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input type="tel" [(ngModel)]="phone" name="phone" [disabled]="!canEditContent()" />
                    </label>
                    <label>
                      <span>Email</span>
                      <input type="email" [(ngModel)]="email" name="email" [disabled]="!canEditContent()" />
                    </label>
                  </div>

                  <div class="section-heading spaced-section-heading">
                    <h2>Categories</h2>
                  </div>
                  <div class="category-picker">
                    <div class="category-picker-grid">
                      <section class="category-panel">
                        <header>Available categories</header>
                        <input
                          type="search"
                          placeholder="Filter"
                          [(ngModel)]="categoryAvailableFilter"
                          name="categoryAvailableFilter"
                          [disabled]="!canEditContent()"
                        />
                        <div class="category-options" aria-label="Available categories">
                          @for (category of availableCategoryOptions(); track category.id) {
                            <button type="button" [disabled]="!canEditContent()" (click)="addCategory(category.id)">
                              {{ categoryDisplayName(category) }}
                            </button>
                          } @empty {
                            <p class="muted">No available categories.</p>
                          }
                        </div>
                        <button type="button" class="secondary category-wide-action" [disabled]="!canEditContent()" (click)="chooseAllFilteredCategories()">Choose all</button>
                        <div class="new-category-row">
                          <input
                            type="text"
                            placeholder="New category"
                            [(ngModel)]="newCategoryName"
                            name="newCategoryName"
                            [disabled]="!canEditContent()"
                          />
                          <button type="button" class="primary" title="Create category" aria-label="Create category" [disabled]="!canEditContent()" (click)="createCategoryFromEditor()">+</button>
                        </div>
                      </section>

                      <div class="category-transfer" aria-hidden="true">
                        <span>→</span>
                        <span>←</span>
                      </div>

                      <section class="category-panel chosen">
                        <header>Chosen categories</header>
                        <input
                          type="search"
                          placeholder="Filter"
                          [(ngModel)]="categoryChosenFilter"
                          name="categoryChosenFilter"
                          [disabled]="!canEditContent()"
                        />
                        <div class="category-options" aria-label="Chosen categories">
                          @for (category of chosenCategoryOptions(); track category.id) {
                            <button type="button" [disabled]="!canEditContent()" (click)="removeCategory(category.id)">
                              {{ categoryDisplayName(category) }}
                            </button>
                          } @empty {
                            <p class="muted">No chosen categories.</p>
                          }
                        </div>
                        <div class="category-action-spacer"></div>
                        <div class="category-bottom-action">
                          <button type="button" class="secondary category-wide-action" [disabled]="!canEditContent()" (click)="removeAllFilteredCategories()">Remove all</button>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>

                <div class="location-picker">
                  @if (canEditContent()) {
                    <h2>{{ isEditingFootprint ? 'Edit area' : 'Pick location on map' }}</h2>
                  }
                  <div class="location-map-shell" [class.editing-area]="isEditingFootprint">
                    @if (isEditingFootprint) {
                      <aside class="footprint-edit-column" aria-label="POI area editing controls">
                        <p class="footprint-help">Add/remove polygons to delimit the POI's area; drag points to modify their shapes; double click to add new points.</p>
                        <button type="button" class="secondary" [disabled]="!hasValidCoordinates()" (click)="addFootprintPolygon()">Add polygon</button>
                        <button type="button" class="secondary danger-action" [disabled]="selectedFootprintPolygonIndex === null" (click)="removeSelectedFootprintPolygon()">Remove polygon</button>
                        <button type="button" class="secondary" (click)="fitFootprintView()">Fit view</button>
                        <button type="button" class="secondary" [disabled]="!canUndoFootprint()" (click)="undoFootprintEdit()">Undo</button>
                        <button type="button" class="secondary" [disabled]="!canRedoFootprint()" (click)="redoFootprintEdit()">Redo</button>
                        <button type="button" class="primary" (click)="saveFootprintEditor()">Done</button>
                        <button type="button" class="secondary danger-action" [disabled]="editFootprintPolygons.length === 0" (click)="clearFootprintEditor()">Clear</button>
                        @if (footprintPointWarning()) {
                          <p class="footprint-warning">{{ footprintPointWarning() }}</p>
                        }
                      </aside>
                    }
                    <div class="location-map" #locationMap></div>
                  </div>
                  <section class="basic-media-preview">
                    <h2>Media preview</h2>
                    <div class="basic-media-strip" aria-label="POI media preview">
                      @for (item of media; track $index) {
                        <a
                          class="basic-media-thumb"
                          [attr.href]="mediaDisplayUrl(item) || null"
                          target="_blank"
                          rel="noopener noreferrer"
                          [attr.title]="mediaCaptionLabel(item, $index)"
                        >
                          @if (item.media_type === 'image' && mediaDisplayUrl(item)) {
                            <img [src]="mediaDisplayUrl(item)" alt="" />
                          } @else {
                            <span>{{ mediaTypeLabel(item.media_type) }}</span>
                          }
                        </a>
                      } @empty {
                        <p class="muted">No media linked to this POI.</p>
                      }
                    </div>
                  </section>
                </div>
              </div>
            </section>
          }

          @if (activeTab === 'translations') {
            <section class="editor-panel">
              <div class="translation-tabs-panel">
                <div class="translation-tabs" role="tablist" aria-label="POI translation languages">
                  @for (translation of translations; track $index) {
                    <button
                      type="button"
                      class="translation-tab"
                      [class.active]="activeTranslationIndex === $index"
                      (click)="activeTranslationIndex = $index"
                    >
                      @if (translation.is_reference) {
                        <span class="reference-icon" title="Reference language" aria-label="Reference language">★</span>
                      }
                      <span>{{ translation.language_code || 'New language' }}</span>
                    </button>
                  }
                  <button type="button" class="translation-tab add-tab" [disabled]="!canEditContent()" (click)="addTranslation()">+</button>
                </div>

                @if (activeTranslation(); as translation) {
                  <section class="translation-tab-content">
                    <div class="translation-tab-header">
                      <label>
                        <span>Language</span>
                        <input type="text" [(ngModel)]="translation.language_code" [name]="'language' + activeTranslationIndex" [disabled]="!canEditContent()" />
                      </label>
                      @if (translation.is_reference) {
                        <span class="reference-pill"><span aria-hidden="true">★</span> Reference language</span>
                      } @else {
                        <button type="button" class="secondary" [disabled]="!canEditContent()" (click)="setReferenceTranslation(activeTranslationIndex)">Make reference</button>
                      }
                    </div>

                    @if (translation.is_reference) {
                      <div class="translation-single-column">
                        <label>
                          <span>Title</span>
                          <input type="text" [(ngModel)]="translation.title" [name]="'title' + activeTranslationIndex" [disabled]="!canEditContent()" />
                        </label>
                        <label>
                          <span>Description</span>
                          <textarea rows="8" [(ngModel)]="translation.description" [name]="'description' + activeTranslationIndex" [disabled]="!canEditContent()"></textarea>
                        </label>
                        @if (media.length > 0) {
                          <section class="media-caption-section">
                            <h3>Media captions</h3>
                            @for (item of media; track $index) {
                              <label>
                                <div class="media-caption-header">
                                  <span class="media-caption-title">{{ mediaCaptionLabel(item, $index) }}</span>
                                  @if (mediaDisplayUrl(item)) {
                                    <a [href]="mediaDisplayUrl(item)" target="_blank" rel="noopener noreferrer">Show in new tab</a>
                                  }
                                </div>
                                <textarea
                                  rows="2"
                                  [ngModel]="mediaCaption(item, translation.language_code)"
                                  (ngModelChange)="setMediaCaption(item, translation.language_code, $event)"
                                  [name]="'mediaCaption' + activeTranslationIndex + '-' + $index"
                                  [disabled]="!canEditContent()"
                                  placeholder="Optional caption"
                                ></textarea>
                              </label>
                            }
                          </section>
                        }
                      </div>
                    } @else {
                      <div class="translation-comparison">
                        <section class="reference-column">
                          <h3>Reference</h3>
                          <label>
                            <span>Title</span>
                            <input type="text" [value]="referenceTranslation()?.title || ''" readonly />
                          </label>
                          <label>
                            <span>Description</span>
                            <textarea rows="8" [value]="referenceTranslation()?.description || ''" readonly></textarea>
                          </label>
                          @if (media.length > 0) {
                            <section class="media-caption-section">
                            <h3>Media captions</h3>
                            @for (item of media; track $index) {
                                <label>
                                  <div class="media-caption-header">
                                    <span class="media-caption-title">{{ mediaCaptionLabel(item, $index) }}</span>
                                    @if (mediaDisplayUrl(item)) {
                                      <a [href]="mediaDisplayUrl(item)" target="_blank" rel="noopener noreferrer">Show in new tab</a>
                                    }
                                  </div>
                                  <textarea rows="2" [value]="referenceMediaCaption(item)" readonly></textarea>
                                </label>
                              }
                            </section>
                          }
                        </section>
                        <section>
                          <h3>{{ translation.language_code || 'Translation' }}</h3>
                          <label>
                            <span>Title</span>
                            <input type="text" [(ngModel)]="translation.title" [name]="'title' + activeTranslationIndex" [disabled]="!canEditContent()" />
                          </label>
                          <label>
                            <span>Description</span>
                            <textarea rows="8" [(ngModel)]="translation.description" [name]="'description' + activeTranslationIndex" [disabled]="!canEditContent()"></textarea>
                          </label>
                          @if (media.length > 0) {
                            <section class="media-caption-section">
                            <h3>Media captions</h3>
                            @for (item of media; track $index) {
                                <label>
                                  <div class="media-caption-header">
                                    <span class="media-caption-title">{{ mediaCaptionLabel(item, $index) }}</span>
                                    @if (mediaDisplayUrl(item)) {
                                      <a [href]="mediaDisplayUrl(item)" target="_blank" rel="noopener noreferrer">Show in new tab</a>
                                    }
                                  </div>
                                  <textarea
                                    rows="2"
                                    [ngModel]="mediaCaption(item, translation.language_code)"
                                    (ngModelChange)="setMediaCaption(item, translation.language_code, $event)"
                                    [name]="'mediaCaption' + activeTranslationIndex + '-' + $index"
                                    [disabled]="!canEditContent()"
                                    placeholder="Optional translated caption"
                                  ></textarea>
                                </label>
                              }
                            </section>
                          }
                        </section>
                      </div>
                    }
                    <button type="button" class="secondary danger-action" [disabled]="!canEditContent() || translations.length <= 1" (click)="removeTranslation(activeTranslationIndex)">
                      Remove this translation
                    </button>
                  </section>
                }
              </div>
            </section>
          }

          @if (activeTab === 'media') {
            <section class="editor-panel media-editor-panel">
              <div class="media-fixed-actions">
                <button type="button" class="secondary" [disabled]="!canEditContent()" (click)="addMedia()">Add media</button>
              </div>

              <div class="media-list">
                @for (item of media; track $index) {
                  <article class="media-row">
                    <div class="media-preview">
                      @if (item.media_type === 'image' && mediaDisplayUrl(item)) {
                        <img [src]="mediaDisplayUrl(item)" alt="" />
                      } @else {
                        <span>{{ mediaTypeLabel(item.media_type) }}</span>
                      }
                    </div>
                    <div class="media-fields">
                      <label>
                        <span>Type</span>
                        <select [(ngModel)]="item.media_type" [name]="'mediaType' + $index" [disabled]="!canEditContent()">
                          @for (type of mediaTypes; track type) {
                            <option [value]="type">{{ mediaTypeLabel(type) }}</option>
                          }
                        </select>
                      </label>
                      <label>
                        <span>Position</span>
                        <input type="number" min="0" [(ngModel)]="item.position" [name]="'mediaPosition' + $index" [disabled]="!canEditContent()" />
                      </label>
                      <label class="checkbox-label">
                        <input type="checkbox" [checked]="item.is_primary" [disabled]="!canEditContent()" (change)="setPrimaryMedia($index, $any($event.target).checked)" />
                        <span>Primary media</span>
                      </label>
                      <fieldset class="metadata-full-row media-source-fieldset">
                        <legend>Media source</legend>
                        <div class="view-toggle media-source-toggle" aria-label="Media source">
                          <button type="button" [class.active]="item.source === 'local'" [disabled]="!canEditContent()" (click)="setMediaSource($index, 'local')">Local file</button>
                          <button type="button" [class.active]="item.source === 'remote'" [disabled]="!canEditContent()" (click)="setMediaSource($index, 'remote')">Remote URL</button>
                        </div>
                        @if (item.source === 'remote') {
                          <label>
                            <span>URL</span>
                            <input
                              type="url"
                              [(ngModel)]="item.url"
                              [name]="'mediaUrl' + $index"
                              [disabled]="!canEditContent()"
                              placeholder="https://..."
                            />
                          </label>
                        } @else {
                          <div
                            class="media-drop-zone"
                            [class.disabled]="!canEditContent()"
                            (dragover)="handleMediaDragOver($event)"
                            (drop)="handleMediaDrop($index, $event)"
                          >
                            <p>Drag a file here, or choose one from your computer.</p>
                            <input type="file" [name]="'mediaFile' + $index" [disabled]="!canEditContent()" (change)="selectMediaFile($index, $event)" />
                          </div>
                          @if (item.uploading) {
                            <p class="media-file-note">Uploading...</p>
                          }
                        }
                      </fieldset>
                      <label class="metadata-full-row media-reference-caption">
                        <span>Caption in {{ referenceLanguageLabel() }}</span>
                        <textarea
                          rows="2"
                          [ngModel]="referenceMediaCaption(item)"
                          (ngModelChange)="setReferenceMediaCaption(item, $event)"
                          [name]="'mediaReferenceCaption' + $index"
                          [disabled]="!canEditContent()"
                          placeholder="Optional caption"
                        ></textarea>
                      </label>
                    </div>
                    <button type="button" class="secondary danger-action" [disabled]="!canEditContent()" (click)="removeMedia($index)">Remove</button>
                  </article>
                } @empty {
                  <p class="muted">No media linked to this POI yet.</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
  styleUrls: ['./resource-list.css', './poi-editor.component.css']
})
export class PoiEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('locationMap') private readonly locationMapElement?: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly title = inject(Title);
  private locationMap: any = null;
  private locationMarker: any = null;
  private footprintLayer: any = null;
  private footprintVertexLayer: any = null;
  private footprintDragStart: { latLng: { lat: number; lng: number }; polygons: FootprintPoint[][] } | null = null;
  private footprintDragPointerId: number | null = null;
  private locationResizeObserver: ResizeObserver | null = null;
  private countryRequestId = 0;
  private readonly poiSaveChannelName = 'smartways-poi-editor-saved';
  private readonly footprintPointerDownHandler = (event: PointerEvent) => this.handleFootprintPointerDown(event);
  private readonly footprintPointerMoveHandler = (event: PointerEvent) => this.handleFootprintPointerMove(event);
  private readonly footprintPointerUpHandler = (event: PointerEvent) => this.handleFootprintPointerUp(event);
  private readonly footprintDoubleClickHandler = (event: MouseEvent) => this.handleFootprintDoubleClick(event);

  poi: Poi | null = null;
  isNewPoi = false;
  editorReady = false;
  categories: Category[] = [];
  loading = true;
  saving = false;
  statusMessage = '';
  statusIsError = false;
  titleNeedsRefresh = false;
  geocodingTitle = false;
  activeTab: EditorTab = 'basic';
  activeTranslationIndex = 0;
  enabled = false;
  countryCode = '';
  latitude: number | null = null;
  longitude: number | null = null;
  footprint: GeoJsonPolygonGeometry | null = null;
  isEditingFootprint = false;
  editFootprintPolygons: FootprintPoint[][] = [];
  selectedFootprintPolygonIndex: number | null = null;
  private footprintUndoStack: FootprintPoint[][][] = [];
  private footprintRedoStack: FootprintPoint[][][] = [];
  website = '';
  phone = '';
  email = '';
  categoryIds: number[] = [];
  categoryAvailableFilter = '';
  categoryChosenFilter = '';
  newCategoryName = '';
  translations: TranslationDraft[] = [];
  media: MediaDraft[] = [];
  private savedSnapshot = '';

  readonly mediaTypes: PoiMedia['media_type'][] = ['image', 'video', 'audio', 'document', 'link', 'other'];

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    this.isNewPoi = !id || id === 'new';
    this.pageInstruction.setInstruction(this.isNewPoi ? 'Create a draft point of interest.' : 'View/edit metadata, translations, and linked media.');
    this.title.setTitle(this.isNewPoi ? 'SW POI New' : `SW POI ${id}`);

    try {
      const categories = await firstValueFrom(this.api.listAllCategories());
      this.categories = this.sortedUniqueCategories(categories);
      if (this.isNewPoi) {
        this.loadBlankPoi();
      } else if (id) {
        const poi = await firstValueFrom(this.api.getPoi(id));
        this.loadPoi(poi);
      }
    } catch (error) {
      this.showStatus(`Could not load POI #${id}. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.loading = false;
      window.setTimeout(() => this.initializeLocationMap(), 0);
    }
  }

  ngAfterViewInit(): void {
    window.setTimeout(() => this.initializeLocationMap(), 0);
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
    this.destroyLocationMap();
    this.revokeMediaPreviewUrls();
  }

  setActiveTab(tab: EditorTab): void {
    if (this.activeTab === 'basic' && tab !== 'basic') {
      this.destroyLocationMap();
    }
    this.activeTab = tab;
    if (tab === 'basic') {
      window.setTimeout(() => this.initializeLocationMap(), 0);
    }
  }

  private destroyLocationMap(): void {
    this.locationResizeObserver?.disconnect();
    this.locationResizeObserver = null;
    const container = this.locationMap?.getContainer?.();
    container?.removeEventListener('pointerdown', this.footprintPointerDownHandler, true);
    container?.removeEventListener('dblclick', this.footprintDoubleClickHandler, true);
    document.removeEventListener('pointermove', this.footprintPointerMoveHandler);
    document.removeEventListener('pointerup', this.footprintPointerUpHandler);
    if (this.locationMap) {
      this.locationMap.remove();
      this.locationMap = null;
    }
    this.locationMarker = null;
    this.footprintLayer = null;
    this.footprintVertexLayer = null;
  }

  referenceTranslation(): TranslationDraft | null {
    return this.translations.find(translation => translation.is_reference) || this.translations[0] || null;
  }

  activeTranslation(): TranslationDraft | null {
    return this.translations[this.activeTranslationIndex] || this.referenceTranslation();
  }

  addTranslation(): void {
    if (!this.canEditContent()) return;
    this.translations.push({
      language_code: '',
      title: '',
      description: '',
      slug: '',
      is_reference: this.translations.length === 0
    });
    this.activeTranslationIndex = this.translations.length - 1;
  }

  removeTranslation(index: number): void {
    if (!this.canEditContent()) return;
    if (this.translations.length <= 1) return;
    const wasReference = this.translations[index]?.is_reference;
    this.translations.splice(index, 1);
    if (wasReference && this.translations.length > 0) {
      this.translations[0].is_reference = true;
    }
    this.activeTranslationIndex = Math.min(this.activeTranslationIndex, this.translations.length - 1);
  }

  setReferenceTranslation(index: number): void {
    if (!this.canEditContent()) return;
    const current = this.referenceTranslation();
    const target = this.translations[index];
    if (!target) return;
    if (current && current !== target) {
      const confirmed = window.confirm(
        `Change the reference language from "${current.language_code || 'current language'}" to "${target.language_code || 'selected language'}"?`
      );
      if (!confirmed) return;
    }
    this.translations = this.translations.map((translation, currentIndex) => ({
      ...translation,
      is_reference: currentIndex === index
    }));
  }

  addMedia(): void {
    if (!this.canEditContent()) return;
    this.media.push({
      media_type: 'image',
      source: 'local',
      url: '',
      captions: {},
      position: this.media.length,
      is_primary: this.media.length === 0
    });
  }

  setMediaSource(index: number, source: 'local' | 'remote'): void {
    if (!this.canEditContent() || !this.media[index]) return;
    this.media[index].source = source;
    if (source === 'local') {
      this.media[index].url = '';
    } else {
      this.revokeMediaPreviewUrl(this.media[index]);
      this.media[index].selectedFile = undefined;
      this.media[index].selectedPreviewUrl = undefined;
    }
  }

  selectMediaFile(index: number, event: Event): void {
    if (!this.canEditContent()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.applyMediaFile(index, file);
  }

  handleMediaDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  handleMediaDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    if (!this.canEditContent()) return;
    const files = event.dataTransfer?.files;
    this.applyMediaFile(index, files?.[0]);
    const input = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[type="file"]');
    if (input && files && files.length > 0) {
      input.files = files;
    }
  }

  private applyMediaFile(index: number, file?: File): void {
    if (!file || !this.media[index]) return;
    this.revokeMediaPreviewUrl(this.media[index]);
    this.media[index].source = 'local';
    this.media[index].selectedFile = file;
    this.media[index].original_filename = file.name;
    this.media[index].content_type = file.type;
    this.media[index].size = file.size;
    this.media[index].media_type = this.mediaTypeFromFile(file);
    this.media[index].selectedPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    this.media[index].url = '';
  }

  removeMedia(index: number): void {
    if (!this.canEditContent()) return;
    const wasPrimary = this.media[index]?.is_primary;
    this.revokeMediaPreviewUrl(this.media[index]);
    this.media.splice(index, 1);
    if (wasPrimary && this.media.length > 0) {
      this.media[0].is_primary = true;
    }
  }

  setPrimaryMedia(index: number, checked: boolean): void {
    if (!this.canEditContent()) return;
    if (!checked) {
      this.media[index].is_primary = false;
      return;
    }
    this.media = this.media.map((item, currentIndex) => ({
      ...item,
      is_primary: currentIndex === index
    }));
  }

  mediaTypeLabel(type: PoiMedia['media_type']): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  mediaDisplayUrl(item: MediaDraft): string {
    return item.selectedPreviewUrl || item.url || item.file_url || '';
  }

  mediaCaption(item: MediaDraft, languageCode: string): string {
    const language = languageCode.trim();
    return language ? item.captions[language] || '' : '';
  }

  setMediaCaption(item: MediaDraft, languageCode: string, caption: string): void {
    if (!this.canEditContent()) return;
    const language = languageCode.trim();
    if (!language) return;
    item.captions[language] = caption;
  }

  referenceMediaCaption(item: MediaDraft): string {
    const referenceLanguage = this.referenceTranslation()?.language_code.trim();
    return referenceLanguage ? this.mediaCaption(item, referenceLanguage) : '';
  }

  setReferenceMediaCaption(item: MediaDraft, caption: string): void {
    const referenceLanguage = this.referenceTranslation()?.language_code.trim();
    if (referenceLanguage) {
      this.setMediaCaption(item, referenceLanguage, caption);
    }
  }

  referenceLanguageLabel(): string {
    return this.referenceTranslation()?.language_code.trim() || 'reference language';
  }

  mediaCaptionLabel(item: MediaDraft, index: number): string {
    return item.original_filename || `${this.mediaTypeLabel(item.media_type)} ${index + 1}`;
  }

  categoryDisplayName(category: Category): string {
    return category.name || category.slug;
  }

  availableCategoryOptions(): Category[] {
    const chosen = new Set(this.categoryIds);
    return this.filterCategories(this.categories.filter(category => !chosen.has(category.id)), this.categoryAvailableFilter);
  }

  chosenCategoryOptions(): Category[] {
    const chosen = new Set(this.categoryIds);
    return this.filterCategories(this.categories.filter(category => chosen.has(category.id)), this.categoryChosenFilter);
  }

  addCategory(categoryId: number): void {
    if (!this.canEditContent()) return;
    this.categoryIds = this.uniqueCategoryIds([...this.categoryIds, categoryId]);
  }

  removeCategory(categoryId: number): void {
    if (!this.canEditContent()) return;
    this.categoryIds = this.categoryIds.filter(id => id !== categoryId);
  }

  chooseAllFilteredCategories(): void {
    if (!this.canEditContent()) return;
    const ids = new Set(this.categoryIds);
    this.availableCategoryOptions().forEach(category => ids.add(category.id));
    this.categoryIds = this.uniqueCategoryIds([...ids]);
  }

  removeAllFilteredCategories(): void {
    if (!this.canEditContent()) return;
    const filteredIds = new Set(this.chosenCategoryOptions().map(category => category.id));
    this.categoryIds = this.categoryIds.filter(id => !filteredIds.has(id));
  }

  async createCategoryFromEditor(): Promise<void> {
    if (!this.canEditContent()) return;
    const name = this.newCategoryName.trim();
    if (!name) {
      this.showStatus('Enter a category name before creating it.', true);
      return;
    }
    try {
      const category = await firstValueFrom(this.api.createCategory({
        slug: this.slugFromText(name),
        translations: [{
          language_code: this.referenceTranslation()?.language_code || 'en',
          name
        }]
      }));
      this.categories = this.sortedUniqueCategories([...this.categories, category]);
      this.addCategory(category.id);
      this.newCategoryName = '';
      this.clearStatus();
    } catch (error) {
      this.showStatus(`Could not create category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async savePoi(): Promise<boolean> {
    if (!this.canSave()) {
      this.showStatus('There are no editable changes to save.', true);
      return false;
    }

    if (this.poi?.enabled && !this.enabled) {
      this.saving = true;
      try {
        const updated = await firstValueFrom(this.api.updatePoi(this.poi.id, { enabled: false }));
        this.loadPoi(updated);
        this.notifyItineraryEditorPoiSaved(updated);
        this.showStatus('POI saved as draft.', false);
        return true;
      } catch (error) {
        this.showStatus(`Could not save POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
        return false;
      } finally {
        this.saving = false;
      }
    }

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every POI translation needs a language and title.', true);
      return false;
    }
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      this.showStatus('Latitude and longitude are required.', true);
      return false;
    }
    const media = this.normalizedMedia();
    if (this.media.some(item => item.source === 'remote' && !item.url.trim())) {
      this.showStatus('Every remote media item needs a URL.', true);
      return false;
    }
    if (this.media.some(item => item.source === 'local' && !item.selectedFile)) {
      this.showStatus('Every local media item needs a selected file.', true);
      return false;
    }

    this.saving = true;
    try {
      const payload = {
        enabled: this.enabled,
        country_code: this.countryCode.trim().toUpperCase(),
        gps_latitude: Number(this.latitude),
        gps_longitude: Number(this.longitude),
        footprint: this.footprintForPayload(),
        website: this.website.trim(),
        phone: this.phone.trim(),
        email: this.email.trim(),
        category_ids: this.uniqueCategoryIds(this.categoryIds),
        translations,
        media
      };
      const updated = this.poi
        ? await firstValueFrom(this.api.updatePoi(this.poi.id, payload))
        : await firstValueFrom(this.api.createPoi(payload));
      const finalPoi = await this.uploadPendingMedia(updated);
      this.loadPoi(finalPoi);
      this.notifyItineraryEditorPoiSaved(finalPoi);
      if (this.isNewPoi) {
        this.isNewPoi = false;
        void this.router.navigate(['/pois', finalPoi.id, 'edit'], {
          replaceUrl: true,
          queryParams: this.route.snapshot.queryParams
        });
      }
      this.showStatus(this.enabled ? 'POI saved as public.' : 'POI saved as draft.', false);
      return true;
    } catch (error) {
      this.showStatus(`Could not save POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
      return false;
    } finally {
      this.saving = false;
    }
  }

  canEditContent(): boolean {
    return this.isNewPoi || !this.poi || !this.poi.enabled || !this.enabled;
  }

  async setPublicationState(enabled: boolean): Promise<void> {
    if (this.saving || this.loading || this.enabled === enabled) return;
    if (!this.confirmPublicationStateChange(enabled)) return;
    const previousEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled) {
      const saved = await this.savePoi();
      if (!saved) {
        this.enabled = previousEnabled;
      }
    }
  }

  private confirmPublicationStateChange(enabled: boolean): boolean {
    if (!this.poi) return true;
    if (enabled) {
      return window.confirm(`Really make POI "${this.poi.title || 'Untitled POI'}" public?`);
    }
    return window.confirm(`Really turn POI "${this.poi.title || 'Untitled POI'}" to draft?`);
  }

  canSave(): boolean {
    if (this.isReadOnlyPublicPoi()) {
      return false;
    }
    return this.currentSnapshot() !== this.savedSnapshot
      && (this.canEditContent() || Boolean(this.poi && this.poi.enabled !== this.enabled));
  }

  isReadOnlyPublicPoi(): boolean {
    return Boolean(this.poi?.enabled && this.enabled);
  }

  hasUnsavedChanges(): boolean {
    return !this.loading && !this.saving && this.canSave();
  }

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private loadPoi(poi: Poi): void {
    this.revokeMediaPreviewUrls();
    this.poi = poi;
    this.title.setTitle(`SW POI ${this.titlePart(poi.title || `POI ${poi.id}`)}`);
    this.enabled = poi.enabled;
    this.countryCode = poi.country_code || '';
    this.latitude = poi.gps_latitude;
    this.longitude = poi.gps_longitude;
    this.footprint = this.normalizedFootprint(poi.footprint);
    this.resetFootprintEditorState();
    this.website = poi.website || '';
    this.phone = poi.phone || '';
    this.email = poi.email || '';
    this.categoryIds = this.uniqueCategoryIds(poi.categories.map(category => category.id));
    this.translations = this.translationDraftsFrom(poi.translations, poi.title, poi.description, poi.slug);
    this.activeTranslationIndex = Math.max(0, this.translations.findIndex(translation => translation.is_reference));
    this.media = this.mediaDraftsFrom(poi.media || [], poi.images || []);
    this.titleNeedsRefresh = false;
    this.editorReady = true;
    this.savedSnapshot = this.currentSnapshot();
    window.setTimeout(() => this.updateLocationMap(true), 0);
  }

  private loadBlankPoi(): void {
    const latitude = this.queryNumber('latitude') ?? this.queryNumber('lat');
    const longitude = this.queryNumber('longitude') ?? this.queryNumber('lng') ?? this.queryNumber('lon');
    this.poi = null;
    this.title.setTitle('SW POI New');
    this.enabled = false;
    this.countryCode = '';
    this.latitude = latitude;
    this.longitude = longitude;
    this.footprint = null;
    this.resetFootprintEditorState();
    this.website = '';
    this.phone = '';
    this.email = '';
    this.categoryIds = [];
    this.translations = [{
      language_code: 'en',
      title: this.route.snapshot.queryParamMap.get('title') || '',
      description: '',
      slug: '',
      is_reference: true
    }];
    this.activeTranslationIndex = 0;
    this.media = [];
    this.titleNeedsRefresh = false;
    this.editorReady = true;
    this.savedSnapshot = (Number.isFinite(this.latitude) && Number.isFinite(this.longitude)) || Boolean(this.translations[0].title)
      ? ''
      : this.currentSnapshot();
    if (Number.isFinite(this.latitude) && Number.isFinite(this.longitude)) {
      void this.updateCountryFromCoordinates();
    }
  }

  private titlePart(value: string): string {
    return value.trim().replace(/\s+/g, ' ') || 'Untitled';
  }

  private queryNumber(name: string): number | null {
    const rawValue = this.route.snapshot.queryParamMap.get(name);
    if (rawValue === null) return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }

  private notifyItineraryEditorPoiSaved(poi: Poi): void {
    const editorToken = this.route.snapshot.queryParamMap.get('itineraryEditorToken');
    const pointId = this.route.snapshot.queryParamMap.get('convertPointId');
    if (!editorToken || !pointId) return;

    const message = {
      editorToken,
      pointId,
      poi: {
        id: poi.id,
        label: poi.title || `POI ${poi.id}`,
        lat: poi.gps_latitude,
        lng: poi.gps_longitude,
        enabled: poi.enabled
      }
    };

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(this.poiSaveChannelName);
      channel.postMessage(message);
      channel.close();
    }
    localStorage.setItem(this.poiSaveChannelName, JSON.stringify({
      ...message,
      sentAt: Date.now()
    }));
  }

  private featureProperties(feature: unknown): Record<string, string> | null {
    if (!feature || typeof feature !== 'object' || !('properties' in feature)) return null;
    const properties = (feature as { properties?: unknown }).properties;
    if (!properties || typeof properties !== 'object') return null;
    return properties as Record<string, string>;
  }

  private placeTitle(properties: Record<string, string>): string {
    return properties['name'] || properties['street'] || properties['city'] || properties['country'] || 'Unnamed place';
  }

  coordinatesChanged(): void {
    if (!this.canEditContent()) return;
    this.updateLocationMap(false);
    void this.updateCountryFromCoordinates();
    if (!this.referenceTranslation()?.title.trim()) {
      void this.refreshTitleFromGeocoder();
      return;
    }
    this.titleNeedsRefresh = true;
  }

  referenceTitleChanged(): void {
    this.titleNeedsRefresh = false;
  }

  hasValidCoordinates(): boolean {
    return Number.isFinite(this.latitude) && Number.isFinite(this.longitude);
  }

  async refreshTitleFromGeocoder(): Promise<void> {
    if (!this.hasValidCoordinates()) {
      this.showStatus('Latitude and longitude are required before using the geocoder.', true);
      return;
    }
    const reference = this.referenceTranslation();
    if (!reference) return;

    this.geocodingTitle = true;
    try {
      const data = await firstValueFrom(this.api.reverseGeocode(Number(this.latitude), Number(this.longitude)));
      const feature = Array.isArray(data.features) ? data.features[0] : null;
      const properties = this.featureProperties(feature);
      if (!properties) {
        this.showStatus('No place name found for these coordinates.', true);
        return;
      }
      reference.title = this.placeTitle(properties);
      this.titleNeedsRefresh = false;
      this.clearStatus();
    } catch (error) {
      this.showStatus(`Could not get place name. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.geocodingTitle = false;
    }
  }

  private initializeLocationMap(): void {
    if (this.activeTab !== 'basic' || !this.locationMapElement || this.locationMap) {
      this.locationMap?.invalidateSize(false);
      this.updateLocationMap(false);
      return;
    }

    this.locationMap = L.map(this.locationMapElement.nativeElement, {
      zoomControl: true
    }).setView([42.5, -8.5], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.locationMap);
    this.locationMap.on('click', (event: any) => {
      if (!this.canEditContent()) return;
      if (this.isEditingFootprint) return;
      this.latitude = Number(event.latlng.lat.toFixed(7));
      this.longitude = Number(event.latlng.lng.toFixed(7));
      this.coordinatesChanged();
    });
    this.locationMap.on('mousedown', (event: any) => this.handleFootprintMapMouseDown(event));
    this.locationMap.on('mousemove', (event: any) => this.handleFootprintPolygonDrag(event.latlng));
    this.locationMap.on('mouseup', () => this.finishFootprintPolygonDrag());
    this.locationMap.on('dblclick', (event: any) => this.handleFootprintMapDoubleClick(event));
    const container = this.locationMap.getContainer();
    container.addEventListener('pointerdown', this.footprintPointerDownHandler, true);
    container.addEventListener('dblclick', this.footprintDoubleClickHandler, true);
    document.addEventListener('pointermove', this.footprintPointerMoveHandler);
    document.addEventListener('pointerup', this.footprintPointerUpHandler);
    this.locationResizeObserver = new ResizeObserver(() => this.locationMap?.invalidateSize(false));
    this.locationResizeObserver.observe(this.locationMapElement.nativeElement);
    window.requestAnimationFrame(() => {
      this.locationMap?.invalidateSize(false);
      this.updateLocationMap(true);
    });
  }

  private updateLocationMap(shouldFit: boolean): void {
    if (!this.locationMap) return;
    this.updateLocationMarker();
    this.updateFootprintLayer();
    if (!shouldFit) return;

    const bounds = L.latLngBounds([]);
    if (this.footprintLayer?.getBounds?.()?.isValid?.()) {
      bounds.extend(this.footprintLayer.getBounds());
    }
    if (Number.isFinite(this.latitude) && Number.isFinite(this.longitude)) {
      bounds.extend([Number(this.latitude), Number(this.longitude)]);
    }
    if (bounds.isValid()) {
      this.locationMap.fitBounds(bounds.pad(0.2), { animate: false, maxZoom: 17 });
    } else {
      this.locationMap.invalidateSize(false);
    }
  }

  private updateLocationMarker(): void {
    if (!this.locationMap) return;
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      if (this.locationMarker) {
        this.locationMarker.remove();
        this.locationMarker = null;
      }
      return;
    }

    const latLng = [Number(this.latitude), Number(this.longitude)];
    if (this.locationMarker) {
      this.locationMarker.setLatLng(latLng);
    } else {
      this.locationMarker = L.marker(latLng, {
        icon: this.locationMarkerIcon()
      }).addTo(this.locationMap);
    }
  }

  private updateFootprintLayer(): void {
    if (!this.locationMap) return;
    if (this.footprintLayer) {
      this.footprintLayer.remove();
      this.footprintLayer = null;
    }
    if (this.footprintVertexLayer) {
      this.footprintVertexLayer.remove();
      this.footprintVertexLayer = null;
    }

    this.footprintLayer = L.featureGroup().addTo(this.locationMap);

    if (!this.isEditingFootprint) {
      if (this.footprint) {
        L.geoJSON(this.footprint, {
          style: {
            color: '#0f766e',
            fillColor: '#14b8a6',
            fillOpacity: 0.22,
            opacity: 0.9,
            weight: 2
          },
          interactive: false
        }).addTo(this.footprintLayer);
      }
      this.locationMap.dragging?.enable?.();
      this.locationMap.doubleClickZoom?.enable?.();
      return;
    }
    this.locationMap.dragging?.enable?.();

    const polygons = this.editFootprintPolygons;
    polygons.forEach((points, index) => {
      const selected = this.isEditingFootprint && this.selectedFootprintPolygonIndex === index;
      const polygon = L.polygon(points.map(point => [point.lat, point.lng]), {
        color: selected ? '#1d4ed8' : '#0f766e',
        fillColor: selected ? '#60a5fa' : '#14b8a6',
        fillOpacity: selected ? 0.28 : 0.2,
        opacity: 0.9,
        weight: selected ? 3 : 2
      }).addTo(this.footprintLayer);

      polygon.on('click', (event: any) => {
        if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
      });
    });

    if (this.isEditingFootprint) {
      this.locationMap.doubleClickZoom?.disable?.();
    } else {
      this.locationMap.doubleClickZoom?.enable?.();
    }

    if (!this.canEditContent() || !this.isEditingFootprint || this.selectedFootprintPolygonIndex === null) return;
    const selectedPoints = this.editFootprintPolygons[this.selectedFootprintPolygonIndex] || [];
    if (selectedPoints.length === 0) return;
    this.footprintVertexLayer = L.layerGroup().addTo(this.locationMap);
    selectedPoints.forEach((point, index) => {
      L.marker([point.lat, point.lng], {
        draggable: true,
        icon: this.footprintVertexIcon()
      })
        .on('dragstart', () => this.rememberFootprintEdit())
        .on('dragend', (event: any) => this.updateFootprintVertex(index, event.target.getLatLng()))
        .on('dblclick contextmenu', (event: any) => {
          if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
          this.removeFootprintVertex(index);
        })
        .addTo(this.footprintVertexLayer);
    });
  }

  private footprintVertexIcon(): any {
    return L.divIcon({
      className: 'poi-footprint-vertex',
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  openFootprintEditor(): void {
    if (!this.canEditContent() || !this.hasValidCoordinates() || this.isEditingFootprint) return;
    this.isEditingFootprint = true;
    this.editFootprintPolygons = this.polygonsFromFootprint(this.footprint);
    this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length > 0 ? 0 : null;
    this.footprintUndoStack = [];
    this.footprintRedoStack = [];
    this.footprintDragStart = null;
    this.clearStatus();
    this.updateLocationMap(false);
    window.requestAnimationFrame(() => {
      this.locationMap?.invalidateSize(false);
      this.updateLocationMap(true);
    });
  }

  addFootprintPolygon(): void {
    if (!this.canEditContent() || !this.hasValidCoordinates()) return;
    if (!this.isEditingFootprint) {
      this.openFootprintEditor();
    }
    const polygon = this.triangleAroundPoi();
    if (polygon.length < 3) return;
    this.rememberFootprintEdit();
    this.editFootprintPolygons.push(polygon);
    this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length - 1;
    this.updateLocationMap(false);
  }

  removeSelectedFootprintPolygon(): void {
    if (this.selectedFootprintPolygonIndex === null) return;
    this.rememberFootprintEdit();
    this.editFootprintPolygons.splice(this.selectedFootprintPolygonIndex, 1);
    this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length > 0
      ? Math.min(this.selectedFootprintPolygonIndex, this.editFootprintPolygons.length - 1)
      : null;
    this.updateLocationMap(false);
  }

  clearFootprintEditor(): void {
    if (this.editFootprintPolygons.length === 0) return;
    this.rememberFootprintEdit();
    this.editFootprintPolygons = [];
    this.selectedFootprintPolygonIndex = null;
    this.updateLocationMap(false);
  }

  saveFootprintEditor(): void {
    this.footprint = this.footprintFromPolygons(this.editFootprintPolygons);
    this.resetFootprintEditorState();
    this.clearStatus();
    this.updateLocationMap(true);
  }

  fitFootprintView(): void {
    this.updateLocationMap(true);
  }

  canUndoFootprint(): boolean {
    return this.footprintUndoStack.length > 0;
  }

  canRedoFootprint(): boolean {
    return this.footprintRedoStack.length > 0;
  }

  undoFootprintEdit(): void {
    const previous = this.footprintUndoStack.pop();
    if (!previous) return;
    this.footprintRedoStack.push(this.cloneFootprintPolygons(this.editFootprintPolygons));
    this.editFootprintPolygons = previous;
    this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length > 0
      ? Math.min(this.selectedFootprintPolygonIndex ?? 0, this.editFootprintPolygons.length - 1)
      : null;
    this.updateLocationMap(false);
  }

  redoFootprintEdit(): void {
    const next = this.footprintRedoStack.pop();
    if (!next) return;
    this.footprintUndoStack.push(this.cloneFootprintPolygons(this.editFootprintPolygons));
    this.editFootprintPolygons = next;
    this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length > 0
      ? Math.min(this.selectedFootprintPolygonIndex ?? 0, this.editFootprintPolygons.length - 1)
      : null;
    this.updateLocationMap(false);
  }

  footprintPointWarning(): string {
    if (!this.isEditingFootprint || this.editFootprintPolygons.length === 0) return '';
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) return '';
    const point = { lat: Number(this.latitude), lng: Number(this.longitude) };
    return this.pointInAnyFootprintPolygon(point, this.editFootprintPolygons)
      ? ''
      : 'POI coordinates are outside the area.';
  }

  private selectFootprintPolygon(index: number): void {
    this.selectedFootprintPolygonIndex = index;
    this.updateLocationMap(false);
  }

  private handleFootprintMapMouseDown(event: any): void {
    if (!this.isEditingFootprint || this.footprintDragStart) return;
    if (this.isFootprintVertexEvent(event)) return;
    const polygonIndex = this.footprintPolygonIndexAt(event.latlng);
    if (polygonIndex === null) return;
    if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
    if (this.selectedFootprintPolygonIndex !== polygonIndex) {
      this.selectFootprintPolygon(polygonIndex);
      return;
    }
    this.startFootprintPolygonDrag(polygonIndex, event);
  }

  private handleFootprintPointerDown(event: PointerEvent): void {
    if (!this.isEditingFootprint || this.footprintDragStart || !this.locationMap) return;
    if (this.isFootprintVertexDomTarget(event.target)) return;
    const latLng = this.latLngFromDomEvent(event);
    if (!latLng) return;
    const polygonIndex = this.footprintPolygonIndexAt(latLng);
    if (polygonIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (this.selectedFootprintPolygonIndex !== polygonIndex) {
      this.selectFootprintPolygon(polygonIndex);
      return;
    }
    this.rememberFootprintEdit();
    this.footprintDragStart = {
      latLng,
      polygons: this.cloneFootprintPolygons(this.editFootprintPolygons)
    };
    this.footprintDragPointerId = event.pointerId;
  }

  private handleFootprintPointerMove(event: PointerEvent): void {
    if (!this.footprintDragStart || this.footprintDragPointerId !== event.pointerId) return;
    const latLng = this.latLngFromDomEvent(event);
    if (!latLng) return;
    event.preventDefault();
    this.handleFootprintPolygonDrag(latLng);
  }

  private handleFootprintPointerUp(event: PointerEvent): void {
    if (!this.footprintDragStart || this.footprintDragPointerId !== event.pointerId) return;
    event.preventDefault();
    this.footprintDragPointerId = null;
    this.finishFootprintPolygonDrag();
  }

  private handleFootprintDoubleClick(event: MouseEvent): void {
    if (!this.isEditingFootprint || this.selectedFootprintPolygonIndex === null || !this.locationMap) return;
    if (this.isFootprintVertexDomTarget(event.target)) return;
    const latLng = this.latLngFromDomEvent(event);
    if (!latLng) return;
    const selectedPolygon = this.editFootprintPolygons[this.selectedFootprintPolygonIndex];
    if (!selectedPolygon) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.insertFootprintVertex(this.selectedFootprintPolygonIndex, latLng);
  }

  private handleFootprintMapDoubleClick(event: any): void {
    if (!this.isEditingFootprint || this.selectedFootprintPolygonIndex === null) return;
    if (this.isFootprintVertexEvent(event)) return;
    const selectedPolygon = this.editFootprintPolygons[this.selectedFootprintPolygonIndex];
    if (!selectedPolygon) return;
    if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
    this.insertFootprintVertex(this.selectedFootprintPolygonIndex, event.latlng);
  }

  private footprintPolygonIndexAt(latLng: { lat: number; lng: number }): number | null {
    for (let index = this.editFootprintPolygons.length - 1; index >= 0; index -= 1) {
      if (this.pointInFootprintPolygon(latLng, this.editFootprintPolygons[index])) {
        return index;
      }
    }
    return null;
  }

  private isFootprintVertexEvent(event: any): boolean {
    return this.isFootprintVertexDomTarget(event?.originalEvent?.target);
  }

  private isFootprintVertexDomTarget(target: EventTarget | null | undefined): boolean {
    return Boolean(target instanceof Element && target.closest('.poi-footprint-vertex'));
  }

  private latLngFromDomEvent(event: MouseEvent | PointerEvent): { lat: number; lng: number } | null {
    if (!this.locationMap) return null;
    const container = this.locationMap.getContainer();
    const bounds = container.getBoundingClientRect();
    const point = L.point(event.clientX - bounds.left, event.clientY - bounds.top);
    return this.locationMap.containerPointToLatLng(point);
  }

  private startFootprintPolygonDrag(index: number, event: any): void {
    if (!this.isEditingFootprint) return;
    if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
    if (this.selectedFootprintPolygonIndex !== index) {
      this.selectFootprintPolygon(index);
      return;
    }
    this.rememberFootprintEdit();
    this.footprintDragStart = {
      latLng: { lat: event.latlng.lat, lng: event.latlng.lng },
      polygons: this.cloneFootprintPolygons(this.editFootprintPolygons)
    };
  }

  private handleFootprintPolygonDrag(latLng: { lat: number; lng: number }): void {
    if (!this.footprintDragStart || this.selectedFootprintPolygonIndex === null) return;
    const deltaLat = latLng.lat - this.footprintDragStart.latLng.lat;
    const deltaLng = latLng.lng - this.footprintDragStart.latLng.lng;
    this.editFootprintPolygons = this.footprintDragStart.polygons.map((polygon, index) => (
      index === this.selectedFootprintPolygonIndex
        ? polygon.map(point => ({
          lat: this.roundCoordinate(point.lat + deltaLat),
          lng: this.roundCoordinate(point.lng + deltaLng)
        }))
        : polygon.map(point => ({ ...point }))
    ));
    this.updateFootprintLayer();
  }

  private finishFootprintPolygonDrag(): void {
    if (!this.footprintDragStart) return;
    this.footprintDragStart = null;
    this.updateLocationMap(false);
  }

  private updateFootprintVertex(vertexIndex: number, latLng: { lat: number; lng: number }): void {
    if (this.selectedFootprintPolygonIndex === null) return;
    const polygon = this.editFootprintPolygons[this.selectedFootprintPolygonIndex];
    if (!polygon?.[vertexIndex]) return;
    polygon[vertexIndex] = {
      lat: this.roundCoordinate(latLng.lat),
      lng: this.roundCoordinate(latLng.lng)
    };
    this.updateLocationMap(false);
  }

  private removeFootprintVertex(vertexIndex: number): void {
    if (this.selectedFootprintPolygonIndex === null) return;
    const polygon = this.editFootprintPolygons[this.selectedFootprintPolygonIndex];
    if (!polygon?.[vertexIndex]) return;
    this.rememberFootprintEdit();
    if (polygon.length <= 3) {
      this.editFootprintPolygons.splice(this.selectedFootprintPolygonIndex, 1);
      this.selectedFootprintPolygonIndex = this.editFootprintPolygons.length > 0
        ? Math.min(this.selectedFootprintPolygonIndex, this.editFootprintPolygons.length - 1)
        : null;
    } else {
      polygon.splice(vertexIndex, 1);
    }
    this.updateLocationMap(false);
  }

  private insertFootprintVertex(polygonIndex: number, latLng: { lat: number; lng: number }): void {
    const polygon = this.editFootprintPolygons[polygonIndex];
    if (!polygon || polygon.length < 3) return;
    this.selectedFootprintPolygonIndex = polygonIndex;
    const insertion = this.nearestFootprintSegmentInsertion(polygon, latLng);
    if (!insertion) return;
    this.rememberFootprintEdit();
    polygon.splice(insertion.index, 0, insertion.point);
    this.updateLocationMap(false);
  }

  private nearestFootprintSegmentInsertion(
    polygon: FootprintPoint[],
    latLng: { lat: number; lng: number }
  ): { index: number; point: FootprintPoint } | null {
    if (!this.locationMap) return null;
    const clickPoint = this.locationMap.latLngToLayerPoint(latLng);
    let best: { distance: number; index: number; point: FootprintPoint } | null = null;
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      const startPoint = this.locationMap.latLngToLayerPoint([start.lat, start.lng]);
      const endPoint = this.locationMap.latLngToLayerPoint([end.lat, end.lng]);
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) return;
      const ratio = Math.max(0, Math.min(1, ((clickPoint.x - startPoint.x) * dx + (clickPoint.y - startPoint.y) * dy) / lengthSquared));
      const projected = L.point(startPoint.x + ratio * dx, startPoint.y + ratio * dy);
      const distance = clickPoint.distanceTo(projected);
      const projectedLatLng = this.locationMap.layerPointToLatLng(projected);
      const candidate = {
        distance,
        index: index + 1,
        point: {
          lat: this.roundCoordinate(projectedLatLng.lat),
          lng: this.roundCoordinate(projectedLatLng.lng)
        }
      };
      if (!best || candidate.distance < best.distance) {
        best = candidate;
      }
    });
    return best;
  }

  private footprintForPayload(): GeoJsonPolygonGeometry | null {
    if (this.isEditingFootprint) {
      return this.footprintFromPolygons(this.editFootprintPolygons);
    }
    return this.normalizedFootprint(this.footprint);
  }

  private normalizedFootprint(value: unknown): GeoJsonPolygonGeometry | null {
    if (!value || typeof value !== 'object') return null;
    const geometry = value as { type?: unknown; coordinates?: unknown };
    if ((geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
      return null;
    }
    return JSON.parse(JSON.stringify({
      type: geometry.type,
      coordinates: geometry.coordinates
    })) as GeoJsonPolygonGeometry;
  }

  private polygonsFromFootprint(value: unknown): FootprintPoint[][] {
    if (!value || typeof value !== 'object') return [];
    const geometry = value as { type?: unknown; coordinates?: unknown };
    if ((geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
      return [];
    }
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.coordinates;
    return (polygons as unknown[])
      .map(polygon => this.pointsFromPolygonCoordinates(polygon))
      .filter(points => points.length >= 3);
  }

  private pointsFromPolygonCoordinates(value: unknown): FootprintPoint[] {
    if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
    const ring = value[0] as unknown[];
    const points = ring
      .map(position => this.footprintPointFromPosition(position))
      .filter((point): point is FootprintPoint => Boolean(point));
    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first.lat === last.lat && first.lng === last.lng) {
        points.pop();
      }
    }
    return points;
  }

  private footprintPointFromPosition(position: unknown): FootprintPoint | null {
    if (!Array.isArray(position) || position.length < 2) return null;
    const lng = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  private footprintFromPolygons(polygons: FootprintPoint[][]): GeoJsonPolygonGeometry | null {
    const validPolygons = polygons.filter(points => points.length >= 3);
    if (validPolygons.length === 0) return null;
    const coordinates = validPolygons.map(points => [this.closedFootprintRing(points)]);
    if (coordinates.length === 1) {
      return {
        type: 'Polygon',
        coordinates: coordinates[0]
      };
    }
    return {
      type: 'MultiPolygon',
      coordinates
    };
  }

  private closedFootprintRing(points: FootprintPoint[]): number[][] {
    const ring = points.map(point => [this.roundCoordinate(point.lng), this.roundCoordinate(point.lat)]);
    ring.push([this.roundCoordinate(points[0].lng), this.roundCoordinate(points[0].lat)]);
    return ring;
  }

  private triangleAroundPoi(): FootprintPoint[] {
    if (!this.locationMap) return [];
    const center = this.locationMap.latLngToLayerPoint([Number(this.latitude), Number(this.longitude)]);
    const mapSize = this.locationMap.getSize();
    const height = Math.max(60, mapSize.y * 0.75);
    const halfSide = height / Math.sqrt(3);
    const vertices = [
      L.point(center.x, center.y - height * 2 / 3),
      L.point(center.x + halfSide, center.y + height / 3),
      L.point(center.x - halfSide, center.y + height / 3)
    ];
    return vertices.map((point: any) => {
      const latLng = this.locationMap.layerPointToLatLng(point);
      return {
        lat: this.roundCoordinate(latLng.lat),
        lng: this.roundCoordinate(latLng.lng)
      };
    });
  }

  private pointInAnyFootprintPolygon(point: FootprintPoint, polygons: FootprintPoint[][]): boolean {
    return polygons.some(polygon => this.pointInFootprintPolygon(point, polygon));
  }

  private pointInFootprintPolygon(point: FootprintPoint, polygon: FootprintPoint[]): boolean {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
      const currentPoint = polygon[current];
      const previousPoint = polygon[previous];
      const crossesLatitude = (currentPoint.lat > point.lat) !== (previousPoint.lat > point.lat);
      if (!crossesLatitude) continue;
      const crossingLng = ((previousPoint.lng - currentPoint.lng) * (point.lat - currentPoint.lat)) / (previousPoint.lat - currentPoint.lat) + currentPoint.lng;
      if (point.lng < crossingLng) {
        inside = !inside;
      }
    }
    return inside;
  }

  private rememberFootprintEdit(): void {
    this.footprintUndoStack.push(this.cloneFootprintPolygons(this.editFootprintPolygons));
    this.footprintRedoStack = [];
  }

  private resetFootprintEditorState(): void {
    this.isEditingFootprint = false;
    this.editFootprintPolygons = [];
    this.selectedFootprintPolygonIndex = null;
    this.footprintUndoStack = [];
    this.footprintRedoStack = [];
    this.footprintDragStart = null;
    this.locationMap?.dragging?.enable?.();
    this.locationMap?.doubleClickZoom?.enable?.();
  }

  private cloneFootprintPolygons(polygons: FootprintPoint[][]): FootprintPoint[][] {
    return polygons.map(polygon => polygon.map(point => ({ ...point })));
  }

  private roundCoordinate(value: number): number {
    return Number(value.toFixed(7));
  }

  private locationMarkerIcon(): any {
    return L.divIcon({
      className: 'poi-location-marker',
      html: '<span></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  private async updateCountryFromCoordinates(): Promise<void> {
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      this.countryCode = '';
      return;
    }
    const requestId = ++this.countryRequestId;
    try {
      const response = await firstValueFrom(this.api.getCountryAt(Number(this.latitude), Number(this.longitude)));
      if (requestId === this.countryRequestId) {
        this.countryCode = response.country || '';
      }
    } catch {
      if (requestId === this.countryRequestId) {
        this.countryCode = '';
      }
    }
  }

  private translationDraftsFrom(
    translations: Translation[],
    title: string | null,
    description: string | null,
    slug: string | null
  ): TranslationDraft[] {
    if (translations.length === 0) {
      return [{ language_code: 'en', title: title || '', description: description || '', slug: slug || '', is_reference: true }];
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

  private mediaDraftsFrom(media: PoiMedia[], images: Array<{ image_url: string; position: number; is_primary: boolean }>): MediaDraft[] {
    const source: PoiMedia[] = media.length > 0
      ? media
      : images.map(image => ({
        media_type: 'image' as const,
        url: image.image_url,
        position: image.position,
        is_primary: image.is_primary
    }));
    return source.map(item => ({
      id: item.id,
      media_type: item.media_type || 'image',
      source: 'remote',
      url: item.url || item.file_url || item.image_url || '',
      file_url: item.file_url || item.image_url || '',
      original_filename: item.original_filename || '',
      content_type: item.content_type || '',
      size: item.size ?? null,
      captions: this.mediaCaptionsFrom(item.translations || []),
      position: item.position || 0,
      is_primary: Boolean(item.is_primary)
    }));
  }

  private mediaCaptionsFrom(translations: PoiMediaTranslation[]): Record<string, string> {
    return Object.fromEntries(
      translations
        .filter(translation => translation.language_code)
        .map(translation => [translation.language_code, translation.caption || ''])
    );
  }

  private revokeMediaPreviewUrl(item?: MediaDraft): void {
    if (item?.selectedPreviewUrl) {
      URL.revokeObjectURL(item.selectedPreviewUrl);
      item.selectedPreviewUrl = undefined;
    }
  }

  private revokeMediaPreviewUrls(): void {
    for (const item of this.media) {
      this.revokeMediaPreviewUrl(item);
    }
  }

  private async uploadPendingMedia(poi: Poi): Promise<Poi> {
    const pending = this.media
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.selectedFile);
    if (pending.length === 0) return poi;

    for (const { item, index } of pending) {
      if (!item.selectedFile) continue;
      item.uploading = true;
      if (item.id) {
        await firstValueFrom(this.api.updatePoiMedia(
          item.id,
          item.selectedFile,
          item.media_type,
          Number.isFinite(Number(item.position)) ? Number(item.position) : index,
          item.is_primary,
          this.mediaTranslationsForPayload(item)
        ));
      } else {
        await firstValueFrom(this.api.uploadPoiMedia(
          poi.id,
          item.selectedFile,
          item.media_type,
          Number.isFinite(Number(item.position)) ? Number(item.position) : index,
          item.is_primary,
          this.mediaTranslationsForPayload(item)
        ));
      }
      item.uploading = false;
    }

    return firstValueFrom(this.api.getPoi(poi.id));
  }

  private mediaTypeFromFile(file: File): PoiMedia['media_type'] {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type === 'application/pdf' || file.type.startsWith('text/')) return 'document';
    return 'other';
  }

  private normalizedTranslations() {
    const translations = this.translations
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

  private normalizedMedia(): PoiMedia[] {
    const media = this.media
      .map((item, index) => ({
        id: item.id,
        media_type: item.media_type,
        url: item.source === 'remote' ? item.url.trim() : '',
        file_url: item.source === 'remote' ? item.file_url : undefined,
        original_filename: item.original_filename,
        content_type: item.content_type,
        size: item.size,
        position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
        is_primary: item.is_primary,
        translations: this.mediaTranslationsForPayload(item)
      }))
      .filter((item, index) => Boolean(item.url || (item.id && this.media[index].selectedFile)));
    if (!media.some(item => item.is_primary) && media.length > 0) {
      media[0].is_primary = true;
    }
    return media;
  }

  private currentSnapshot(): string {
    return JSON.stringify({
      enabled: Boolean(this.enabled),
      country_code: this.countryCode.trim().toUpperCase(),
      gps_latitude: Number.isFinite(Number(this.latitude)) ? Number(this.latitude) : null,
      gps_longitude: Number.isFinite(Number(this.longitude)) ? Number(this.longitude) : null,
      footprint: this.footprintForPayload(),
      website: this.website.trim(),
      phone: this.phone.trim(),
      email: this.email.trim(),
      category_ids: this.uniqueCategoryIds(this.categoryIds).sort((left, right) => left - right),
      translations: this.normalizedTranslations(),
      media: this.normalizedMedia(),
      pending_media: this.media
        .filter(item => item.selectedFile)
        .map(item => ({
          name: item.selectedFile?.name,
          size: item.selectedFile?.size,
          type: item.selectedFile?.type,
          position: item.position,
          is_primary: item.is_primary,
          translations: this.mediaTranslationsForPayload(item)
        }))
    });
  }

  private mediaTranslationsForPayload(item: MediaDraft): PoiMediaTranslation[] {
    return Object.entries(item.captions)
      .map(([language_code, caption]) => ({
        language_code: language_code.trim(),
        caption: caption.trim()
      }))
      .filter(translation => translation.language_code && translation.caption);
  }

  private filterCategories(categories: Category[], filter: string): Category[] {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return categories;
    return categories.filter(category =>
      this.categoryDisplayName(category).toLowerCase().includes(normalizedFilter)
      || category.slug.toLowerCase().includes(normalizedFilter)
    );
  }

  private uniqueCategoryIds(categoryIds: number[]): number[] {
    return [...new Set(categoryIds.filter(id => Number.isFinite(id)))];
  }

  private sortedUniqueCategories(categories: Category[]): Category[] {
    const categoriesById = new Map<number, Category>();
    categories.forEach(category => categoriesById.set(category.id, category));
    return [...categoriesById.values()].sort((left, right) =>
      this.categoryDisplayName(left).localeCompare(this.categoryDisplayName(right), undefined, { sensitivity: 'base' }) || left.id - right.id
    );
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

  private clearStatus(): void {
    this.statusMessage = '';
    this.statusIsError = false;
  }

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }
}
