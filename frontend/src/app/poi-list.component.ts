import { AsyncPipe } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Category, Poi, PoiImage, Translation } from './api.service';

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
          <a class="secondary" [routerLink]="['/itineraries']">Back to itineraries</a>
        } @else {
          <div class="list-actions">
            <button type="button" class="secondary" (click)="openCategoryManagerDialog()">Manage categories</button>
            <button type="button" class="primary icon-action" title="New POI" aria-label="New POI" (click)="openNewPoiDialog()">+</button>
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
      </div>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <div class="table-wrap">
            <table class="resource-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Categories</th>
                  <th>Country</th>
                  <th class="enabled-column">Enabled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (poi of state.items; track poi.id) {
                  <tr>
                    <td>
                      <strong>{{ poi.title || 'Untitled POI' }}</strong>
                      <p class="description-preview">{{ poi.description || 'No description' }}</p>
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
                    <td class="enabled-column">
                      <input
                        class="enabled-checkbox"
                        type="checkbox"
                        title="Enable"
                        aria-label="Enable"
                        [checked]="poi.enabled"
                        (change)="setPoiEnabled(poi, $any($event.target).checked)"
                      />
                    </td>
                    <td>
                      <div class="table-actions">
                        <button type="button" class="secondary icon-action" title="Edit metadata" aria-label="Edit metadata" (click)="openMetadataDialog(poi)">📝</button>
                        <button type="button" class="secondary icon-action" [title]="duplicatingIds.has(poi.id) ? 'Duplicating...' : 'Duplicate'" [attr.aria-label]="duplicatingIds.has(poi.id) ? 'Duplicating...' : 'Duplicate'" [disabled]="duplicatingIds.has(poi.id)" (click)="duplicatePoi(poi)">📄</button>
                        <button type="button" class="secondary icon-action danger-action" title="Delete" aria-label="Delete" (click)="deletePoi(poi)">🗑️</button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5">No POIs found.</td>
                  </tr>
                }
              </tbody>
            </table>
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
export class PoiListComponent {
  @ViewChild('metadataDialog') private readonly metadataDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('categoryManagerDialog') private readonly categoryManagerDialog?: ElementRef<HTMLDialogElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
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
  editingPoi: Poi | null = null;
  poiDraft: PoiDraft = this.emptyPoiDraft();
  translationDrafts: TranslationDraft[] = [];
  editingCategory: Category | null = null;
  categoryDraft: CategoryDraft = this.emptyCategoryDraft();
  categoryTranslationDrafts: CategoryTranslationDraft[] = [];
  mergeTargetCategoryId: number | null = null;
  readonly duplicatingIds = new Set<number>();

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('id')))
  ]).pipe(
    switchMap(([query, , itineraryId]) => {
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
            return of({ items: [] as Poi[], error: '' });
          }
          return this.api.listPois(
            query,
            '',
            undefined,
            this.selectedCategory,
            this.selectedCountry,
            itineraryId ? this.itineraryPoiIds : undefined
          ).pipe(
            map(page => ({ items: page.results, error: '' }))
          );
        }),
        catchError(error => of({ items: [] as Poi[], error: `Could not load POIs. ${error.message}` }))
      );
    }),
    startWith({ items: [] as Poi[], error: '' })
  );

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

  async duplicatePoi(poi: Poi): Promise<void> {
    const title = window.prompt('New title for duplicated POI:', `Copy of ${poi.title || 'Untitled POI'}`)?.trim();
    if (!title) return;

    this.duplicatingIds.add(poi.id);
    this.clearStatus();

    try {
      await firstValueFrom(this.api.createPoi({
        enabled: poi.enabled,
        country_code: poi.country_code,
        gps_latitude: poi.gps_latitude,
        gps_longitude: poi.gps_longitude,
        website: poi.website || '',
        category_ids: poi.categories.map(category => category.id),
        translations: this.duplicateTranslations(poi, title),
        images: this.duplicateImages(poi.images)
      }));
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not duplicate POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.duplicatingIds.delete(poi.id);
    }
  }

  async deletePoi(poi: Poi): Promise<void> {
    const confirmed = window.confirm(`Delete POI "${poi.title || 'Untitled POI'}"?`);
    if (!confirmed) return;

    try {
      await firstValueFrom(this.api.deletePoi(poi.id));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not delete POI. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  private duplicateTranslations(poi: Poi, title: string) {
    const translations = poi.translations.length > 0
      ? poi.translations
      : [{ language_code: 'en', title: poi.title || '', description: poi.description || '', slug: '', is_reference: true }];
    let hasEnglishTranslation = false;

    const duplicatedTranslations = translations
      .filter(translation => translation.language_code)
      .map(translation => {
        const languageCode = translation.language_code;
        const isEnglish = languageCode.toLowerCase() === 'en';
        hasEnglishTranslation = hasEnglishTranslation || isEnglish;
        return {
          language_code: languageCode,
          title: isEnglish ? title : this.translationTitle(translation, poi),
          description: translation.description || '',
          is_reference: Boolean(translation.is_reference)
        };
      });

    if (!hasEnglishTranslation) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: poi.description || '',
        is_reference: !duplicatedTranslations.some(translation => translation.is_reference)
      });
    }
    if (!duplicatedTranslations.some(translation => translation.is_reference) && duplicatedTranslations.length > 0) {
      duplicatedTranslations[0].is_reference = true;
    }
    return duplicatedTranslations;
  }

  private duplicateImages(images: PoiImage[]): PoiImage[] {
    return images.map(image => ({
      image_url: image.image_url,
      position: image.position,
      is_primary: image.is_primary
    }));
  }

  private translationTitle(translation: Translation, poi: Poi): string {
    return translation.title || poi.title || 'Untitled POI';
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

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }

  private clearStatus(): void {
    this.statusMessage = '';
    this.statusIsError = false;
  }
}
