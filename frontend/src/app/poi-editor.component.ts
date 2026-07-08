import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService, Category, Poi, PoiMedia, Translation } from './api.service';

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
  slug: string;
  is_reference: boolean;
}

interface MediaDraft {
  media_type: PoiMedia['media_type'];
  url: string;
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
        <div>
          <h1>{{ isNewPoi ? 'New POI' : (poi?.title || 'POI editor') }}</h1>
          <p>{{ isNewPoi ? 'Create a draft point of interest.' : 'Edit metadata, translations, and linked media.' }}</p>
        </div>
        <div class="list-actions">
          <a class="secondary" [routerLink]="backLink">{{ backLabel }}</a>
          <button type="button" class="secondary" [disabled]="saving || loading" (click)="savePoi(false)">
            {{ saving ? 'Saving...' : 'Save draft' }}
          </button>
          <button type="button" class="primary" [disabled]="saving || loading" (click)="savePoi(true)">
            {{ saving ? 'Saving...' : 'Save and make public' }}
          </button>
        </div>
      </header>

      @if (statusMessage) {
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
                    <h2>Reference language</h2>
                    @if (referenceTranslation(); as reference) {
                      <span class="reference-pill"><span aria-hidden="true">★</span> {{ reference.language_code || 'Reference' }}</span>
                    }
                  </div>

                  @if (referenceTranslation(); as reference) {
                    <div class="form-grid compact-form-grid">
                      <label>
                        <span>Language</span>
                        <input type="text" [(ngModel)]="reference.language_code" name="referenceLanguage" />
                      </label>
                      <label>
                        <span>Title</span>
                        <input type="text" [(ngModel)]="reference.title" name="referenceTitle" />
                      </label>
                      <label class="metadata-full-row">
                        <span>Description</span>
                        <textarea rows="6" [(ngModel)]="reference.description" name="referenceDescription"></textarea>
                      </label>
                    </div>
                  }

                  <div class="section-heading">
                    <h2>Location</h2>
                    <span class="country-label">{{ countryCode ? 'Country: ' + countryCode : 'Country pending location' }}</span>
                  </div>
                  <div class="form-grid compact-form-grid">
                    <label>
                      <span>Latitude</span>
                      <input type="number" step="any" [(ngModel)]="latitude" (ngModelChange)="coordinatesChanged()" name="latitude" />
                    </label>
                    <label>
                      <span>Longitude</span>
                      <input type="number" step="any" [(ngModel)]="longitude" (ngModelChange)="coordinatesChanged()" name="longitude" />
                    </label>
                    <label class="metadata-full-row">
                      <span>Website</span>
                      <input type="url" [(ngModel)]="website" name="website" />
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
                          />
                          <div class="category-options" aria-label="Available categories">
                            @for (category of availableCategoryOptions(); track category.id) {
                              <button type="button" (click)="addCategory(category.id)">
                                {{ categoryDisplayName(category) }}
                              </button>
                            } @empty {
                              <p class="muted">No available categories.</p>
                            }
                          </div>
                          <button type="button" class="secondary category-wide-action" (click)="chooseAllFilteredCategories()">Choose all</button>
                          <div class="new-category-row">
                            <input
                              type="text"
                              placeholder="New category"
                              [(ngModel)]="newCategoryName"
                              name="newCategoryName"
                            />
                            <button type="button" class="primary" title="Create category" aria-label="Create category" (click)="createCategoryFromEditor()">+</button>
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
                          />
                          <div class="category-options" aria-label="Chosen categories">
                            @for (category of chosenCategoryOptions(); track category.id) {
                              <button type="button" (click)="removeCategory(category.id)">
                                {{ categoryDisplayName(category) }}
                              </button>
                            } @empty {
                              <p class="muted">No chosen categories.</p>
                            }
                          </div>
                          <div class="category-action-spacer"></div>
                          <div class="category-bottom-action">
                            <button type="button" class="secondary category-wide-action" (click)="removeAllFilteredCategories()">Remove all</button>
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
                  <button type="button" class="translation-tab add-tab" (click)="addTranslation()">+</button>
                </div>

                @if (activeTranslation(); as translation) {
                  <section class="translation-tab-content">
                    <div class="translation-tab-header">
                      <label>
                        <span>Language</span>
                        <input type="text" [(ngModel)]="translation.language_code" [name]="'language' + activeTranslationIndex" />
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
                          <input type="text" [(ngModel)]="translation.title" [name]="'title' + activeTranslationIndex" />
                        </label>
                        <label>
                          <span>Description</span>
                          <textarea rows="8" [(ngModel)]="translation.description" [name]="'description' + activeTranslationIndex"></textarea>
                        </label>
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
                        </section>
                        <section>
                          <h3>{{ translation.language_code || 'Translation' }}</h3>
                          <label>
                            <span>Title</span>
                            <input type="text" [(ngModel)]="translation.title" [name]="'title' + activeTranslationIndex" />
                          </label>
                          <label>
                            <span>Description</span>
                            <textarea rows="8" [(ngModel)]="translation.description" [name]="'description' + activeTranslationIndex"></textarea>
                          </label>
                        </section>
                      </div>
                    }
                    @if (translations.length > 1) {
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
                <button type="button" class="secondary" (click)="addMedia()">Add media</button>
              </div>

              <div class="media-list">
                @for (item of media; track $index) {
                  <article class="media-row">
                    <div class="media-preview">
                      @if (item.media_type === 'image' && item.url) {
                        <img [src]="item.url" alt="" />
                      } @else {
                        <span>{{ mediaTypeLabel(item.media_type) }}</span>
                      }
                    </div>
                    <div class="media-fields">
                      <label>
                        <span>Type</span>
                        <select [(ngModel)]="item.media_type" [name]="'mediaType' + $index">
                          @for (type of mediaTypes; track type) {
                            <option [value]="type">{{ mediaTypeLabel(type) }}</option>
                          }
                        </select>
                      </label>
                      <label>
                        <span>Position</span>
                        <input type="number" min="0" [(ngModel)]="item.position" [name]="'mediaPosition' + $index" />
                      </label>
                      <label class="metadata-full-row">
                        <span>URL</span>
                        <input type="url" [(ngModel)]="item.url" [name]="'mediaUrl' + $index" />
                      </label>
                      <label class="checkbox-label">
                        <input type="checkbox" [checked]="item.is_primary" (change)="setPrimaryMedia($index, $any($event.target).checked)" />
                        <span>Primary media</span>
                      </label>
                    </div>
                    <button type="button" class="secondary danger-action" (click)="removeMedia($index)">Remove</button>
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

  poi: Poi | null = null;
  isNewPoi = false;
  editorReady = false;
  categories: Category[] = [];
  loading = true;
  saving = false;
  statusMessage = '';
  statusIsError = false;
  activeTab: EditorTab = 'basic';
  activeTranslationIndex = 0;
  backLink = '/pois';
  backLabel = 'Back to POIs';

  enabled = false;
  countryCode = '';
  latitude: number | null = null;
  longitude: number | null = null;
  website = '';
  categoryIds: number[] = [];
  categoryAvailableFilter = '';
  categoryChosenFilter = '';
  newCategoryName = '';
  translations: TranslationDraft[] = [];
  media: MediaDraft[] = [];

  readonly mediaTypes: PoiMedia['media_type'][] = ['image', 'video', 'audio', 'document', 'link', 'other'];

  async ngOnInit(): Promise<void> {
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    const returnLabel = this.route.snapshot.queryParamMap.get('returnLabel');
    if (returnTo?.startsWith('/')) {
      this.backLink = returnTo;
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
    if (this.translations.length <= 1) return;
    const wasReference = this.translations[index]?.is_reference;
    this.translations.splice(index, 1);
    if (wasReference && this.translations.length > 0) {
      this.translations[0].is_reference = true;
    }
    this.activeTranslationIndex = Math.min(this.activeTranslationIndex, this.translations.length - 1);
  }

  setReferenceTranslation(index: number): void {
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
    this.media.push({
      media_type: 'image',
      url: '',
      position: this.media.length,
      is_primary: this.media.length === 0
    });
  }

  removeMedia(index: number): void {
    const wasPrimary = this.media[index]?.is_primary;
    this.media.splice(index, 1);
    if (wasPrimary && this.media.length > 0) {
      this.media[0].is_primary = true;
    }
  }

  setPrimaryMedia(index: number, checked: boolean): void {
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
    if (!this.categoryIds.includes(categoryId)) {
      this.categoryIds = [...this.categoryIds, categoryId];
    }
  }

  removeCategory(categoryId: number): void {
    this.categoryIds = this.categoryIds.filter(id => id !== categoryId);
  }

  chooseAllFilteredCategories(): void {
    const ids = new Set(this.categoryIds);
    this.availableCategoryOptions().forEach(category => ids.add(category.id));
    this.categoryIds = [...ids];
  }

  removeAllFilteredCategories(): void {
    const filteredIds = new Set(this.chosenCategoryOptions().map(category => category.id));
    this.categoryIds = this.categoryIds.filter(id => !filteredIds.has(id));
  }

  async createCategoryFromEditor(): Promise<void> {
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

  async savePoi(makePublic: boolean): Promise<void> {
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
    if (media.some(item => !item.url)) {
      this.showStatus('Every media item needs a URL.', true);
      return;
    }

    this.saving = true;
    try {
      const payload = {
        enabled: makePublic,
        country_code: this.countryCode.trim().toUpperCase(),
        gps_latitude: Number(this.latitude),
        gps_longitude: Number(this.longitude),
        website: this.website.trim(),
        category_ids: this.categoryIds,
        translations,
        media
      };
      const updated = this.poi
        ? await firstValueFrom(this.api.updatePoi(this.poi.id, payload))
        : await firstValueFrom(this.api.createPoi(payload));
      this.loadPoi(updated);
      if (this.isNewPoi) {
        this.isNewPoi = false;
        void this.router.navigate(['/pois', updated.id, 'edit'], { replaceUrl: true });
      }
      this.showStatus(makePublic ? 'POI saved and made public.' : 'Draft saved.', false);
    } catch (error) {
      this.showStatus(`Could not save POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.saving = false;
    }
  }

  private loadPoi(poi: Poi): void {
    this.poi = poi;
    this.enabled = poi.enabled;
    this.countryCode = poi.country_code || '';
    this.latitude = poi.gps_latitude;
    this.longitude = poi.gps_longitude;
    this.website = poi.website || '';
    this.categoryIds = poi.categories.map(category => category.id);
    this.translations = this.translationDraftsFrom(poi.translations, poi.title, poi.description, poi.slug);
    this.activeTranslationIndex = Math.max(0, this.translations.findIndex(translation => translation.is_reference));
    this.media = this.mediaDraftsFrom(poi.media || [], poi.images || []);
    this.editorReady = true;
    window.setTimeout(() => this.updateLocationMarker(true), 0);
  }

  private loadBlankPoi(): void {
    this.poi = null;
    this.enabled = false;
    this.countryCode = '';
    this.latitude = null;
    this.longitude = null;
    this.website = '';
    this.categoryIds = [];
    this.translations = [{
      language_code: 'en',
      title: '',
      description: '',
      slug: '',
      is_reference: true
    }];
    this.activeTranslationIndex = 0;
    this.media = [];
    this.editorReady = true;
  }

  coordinatesChanged(): void {
    this.updateLocationMarker(false);
    void this.updateCountryFromCoordinates();
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
      this.latitude = Number(event.latlng.lat.toFixed(7));
      this.longitude = Number(event.latlng.lng.toFixed(7));
      this.updateLocationMarker(false);
      void this.updateCountryFromCoordinates();
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
      media_type: item.media_type || 'image',
      url: item.url || item.image_url || '',
      position: item.position || 0,
      is_primary: Boolean(item.is_primary)
    }));
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
        media_type: item.media_type,
        url: item.url.trim(),
        position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
        is_primary: item.is_primary
      }))
      .filter(item => item.url);
    if (!media.some(item => item.is_primary) && media.length > 0) {
      media[0].is_primary = true;
    }
    return media;
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
