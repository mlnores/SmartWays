import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService, Category, Poi, PoiMedia, PoiMediaTranslation, Translation } from './api.service';

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

declare const L: any;

@Component({
  selector: 'app-poi-editor',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page poi-editor-page">
      <header class="page-header">
        <div class="poi-editor-heading">
          <div>
            <h1>{{ isNewPoi ? 'New POI' : (poi?.title || 'POI editor') }}</h1>
            <p>{{ isNewPoi ? 'Create a draft point of interest.' : 'View/edit metadata, translations, and linked media.' }}</p>
          </div>
        </div>
        <div class="publication-switch">
          <span>State</span>
          <div class="view-toggle publication-toggle" aria-label="Publication state">
            <button type="button" [class.active]="!enabled" (click)="enabled = false">Draft</button>
            <button type="button" [class.active]="enabled" (click)="enabled = true">Public (read-only)</button>
          </div>
        </div>
        <div class="list-actions poi-save-actions">
          <a class="secondary" [routerLink]="backLink">{{ backLabel }}</a>
          <button type="button" class="primary" [disabled]="saving || loading || !canSave()" (click)="savePoi()">
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
            <button type="button" [class.active]="activeTab === 'translations'" (click)="setActiveTab('translations')">Translations</button>
            <button type="button" [class.active]="activeTab === 'media'" (click)="setActiveTab('media')">Media</button>
          </nav>

          @if (activeTab === 'basic') {
            <section class="editor-panel">
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

                  <div class="section-heading">
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
                    <div class="metadata-full-row category-picker">
                      <span>Categories</span>
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
                </div>

                <div class="location-picker">
                  <span>Pick location on map</span>
                  <div class="location-map" #locationMap></div>
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
                  @if (canEditContent()) {
                    <button type="button" class="translation-tab add-tab" (click)="addTranslation()">+</button>
                  }
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
                        @if (canEditContent()) {
                          <button type="button" class="secondary" (click)="setReferenceTranslation(activeTranslationIndex)">Make reference</button>
                        }
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
                    @if (canEditContent() && translations.length > 1) {
                      <button type="button" class="secondary danger-action" (click)="removeTranslation(activeTranslationIndex)">
                        Remove this translation
                      </button>
                    }
                  </section>
                }
              </div>
            </section>
          }

          @if (activeTab === 'media') {
            <section class="editor-panel">
              <div class="section-heading">
                <h2>Linked media</h2>
                @if (canEditContent()) {
                  <button type="button" class="secondary" (click)="addMedia()">Add media</button>
                }
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
                    @if (canEditContent()) {
                      <button type="button" class="secondary danger-action" (click)="removeMedia($index)">Remove</button>
                    }
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
  private locationMap: any = null;
  private locationMarker: any = null;
  private locationResizeObserver: ResizeObserver | null = null;
  private countryRequestId = 0;
  private readonly poiSaveChannelName = 'smartways-poi-editor-saved';

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
  backLink: string | UrlTree = '/pois';
  backLabel = 'Back to POIs';

  enabled = false;
  countryCode = '';
  latitude: number | null = null;
  longitude: number | null = null;
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
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    const returnLabel = this.route.snapshot.queryParamMap.get('returnLabel');
    if (returnTo?.startsWith('/')) {
      this.backLink = this.router.parseUrl(returnTo);
    }
    if (returnLabel) {
      this.backLabel = returnLabel;
    }

    const id = this.route.snapshot.paramMap.get('id');
    this.isNewPoi = !id || id === 'new';

    try {
      const categories = await firstValueFrom(this.api.listAllCategories());
      this.categories = categories;
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
    if (this.locationMap) {
      this.locationMap.remove();
      this.locationMap = null;
    }
    this.locationMarker = null;
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
    if (!this.categoryIds.includes(categoryId)) {
      this.categoryIds = [...this.categoryIds, categoryId];
    }
  }

  removeCategory(categoryId: number): void {
    if (!this.canEditContent()) return;
    this.categoryIds = this.categoryIds.filter(id => id !== categoryId);
  }

  chooseAllFilteredCategories(): void {
    if (!this.canEditContent()) return;
    const ids = new Set(this.categoryIds);
    this.availableCategoryOptions().forEach(category => ids.add(category.id));
    this.categoryIds = [...ids];
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
      this.categories = [...this.categories, category].sort((left, right) =>
        this.categoryDisplayName(left).localeCompare(this.categoryDisplayName(right))
      );
      this.addCategory(category.id);
      this.newCategoryName = '';
      this.clearStatus();
    } catch (error) {
      this.showStatus(`Could not create category. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async savePoi(): Promise<void> {
    if (!this.canSave()) {
      this.showStatus('There are no editable changes to save.', true);
      return;
    }

    if (this.poi && this.poi.enabled !== this.enabled && !this.confirmPublicationStateChange()) {
      return;
    }

    if (this.poi?.enabled && !this.enabled) {
      this.saving = true;
      try {
        const updated = await firstValueFrom(this.api.updatePoi(this.poi.id, { enabled: false }));
        this.loadPoi(updated);
        this.notifyItineraryEditorPoiSaved(updated);
        this.showStatus('POI saved as draft.', false);
      } catch (error) {
        this.showStatus(`Could not save POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
      } finally {
        this.saving = false;
      }
      return;
    }

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every POI translation needs a language and title.', true);
      return;
    }
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      this.showStatus('Latitude and longitude are required.', true);
      return;
    }

    const media = this.normalizedMedia();
    if (this.media.some(item => item.source === 'remote' && !item.url.trim())) {
      this.showStatus('Every remote media item needs a URL.', true);
      return;
    }
    if (this.media.some(item => item.source === 'local' && !item.selectedFile)) {
      this.showStatus('Every local media item needs a selected file.', true);
      return;
    }

    this.saving = true;
    try {
      const payload = {
        enabled: this.enabled,
        country_code: this.countryCode.trim().toUpperCase(),
        gps_latitude: Number(this.latitude),
        gps_longitude: Number(this.longitude),
        website: this.website.trim(),
        phone: this.phone.trim(),
        email: this.email.trim(),
        category_ids: this.categoryIds,
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
        const highlightedReturnTo = this.returnToWithHighlight(finalPoi.id);
        void this.router.navigate(['/pois', finalPoi.id, 'edit'], {
          replaceUrl: true,
          queryParams: highlightedReturnTo
            ? { ...this.route.snapshot.queryParams, returnTo: highlightedReturnTo }
            : this.route.snapshot.queryParams
        });
      }
      this.showStatus(this.enabled ? 'POI saved as public.' : 'POI saved as draft.', false);
    } catch (error) {
      this.showStatus(`Could not save POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.saving = false;
    }
  }

  canEditContent(): boolean {
    return this.isNewPoi || !this.poi || !this.poi.enabled || !this.enabled;
  }

  private confirmPublicationStateChange(): boolean {
    if (!this.poi) return true;
    if (this.enabled) {
      return window.confirm('Really make this POI public?');
    }
    return window.confirm(
      'Really turn this POI to draft?\n\nItineraries containing this POI, and routes containing those itineraries, will also be turned to draft.'
    );
  }

  canSave(): boolean {
    return this.currentSnapshot() !== this.savedSnapshot
      && (this.canEditContent() || Boolean(this.poi && this.poi.enabled !== this.enabled));
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

  private returnToWithHighlight(poiId: number): string | null {
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (!returnTo?.startsWith('/pois')) return null;

    const returnUrl = this.router.parseUrl(returnTo);
    returnUrl.queryParams = {
      ...returnUrl.queryParams,
      highlight: String(poiId)
    };
    this.backLink = returnUrl;
    return this.router.serializeUrl(returnUrl);
  }

  private loadPoi(poi: Poi): void {
    this.revokeMediaPreviewUrls();
    this.poi = poi;
    this.enabled = poi.enabled;
    this.countryCode = poi.country_code || '';
    this.latitude = poi.gps_latitude;
    this.longitude = poi.gps_longitude;
    this.website = poi.website || '';
    this.phone = poi.phone || '';
    this.email = poi.email || '';
    this.categoryIds = poi.categories.map(category => category.id);
    this.translations = this.translationDraftsFrom(poi.translations, poi.title, poi.description, poi.slug);
    this.activeTranslationIndex = Math.max(0, this.translations.findIndex(translation => translation.is_reference));
    this.media = this.mediaDraftsFrom(poi.media || [], poi.images || []);
    this.titleNeedsRefresh = false;
    this.editorReady = true;
    this.savedSnapshot = this.currentSnapshot();
    window.setTimeout(() => this.updateLocationMarker(true), 0);
  }

  private loadBlankPoi(): void {
    const latitude = this.queryNumber('latitude') ?? this.queryNumber('lat');
    const longitude = this.queryNumber('longitude') ?? this.queryNumber('lng') ?? this.queryNumber('lon');
    this.poi = null;
    this.enabled = false;
    this.countryCode = '';
    this.latitude = latitude;
    this.longitude = longitude;
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
    this.updateLocationMarker(false);
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
      this.updateLocationMarker(false);
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
      this.latitude = Number(event.latlng.lat.toFixed(7));
      this.longitude = Number(event.latlng.lng.toFixed(7));
      this.coordinatesChanged();
    });
    this.locationResizeObserver = new ResizeObserver(() => this.locationMap?.invalidateSize(false));
    this.locationResizeObserver.observe(this.locationMapElement.nativeElement);
    window.requestAnimationFrame(() => {
      this.locationMap?.invalidateSize(false);
      this.updateLocationMarker(true);
    });
  }

  private updateLocationMarker(shouldFit: boolean): void {
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
    if (shouldFit) {
      this.locationMap.setView(latLng, 14, { animate: false });
    }
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
      website: this.website.trim(),
      phone: this.phone.trim(),
      email: this.email.trim(),
      category_ids: [...this.categoryIds].sort((left, right) => left - right),
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
