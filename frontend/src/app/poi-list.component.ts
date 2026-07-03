import { AsyncPipe } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
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

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>POIs</h1>
          <p>Browse and manage points of interest from the backend API.</p>
        </div>
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
        <input
          class="country-filter"
          type="text"
          maxlength="2"
          placeholder="Country"
          aria-label="Filter by country code"
          [ngModel]="selectedCountry"
          (ngModelChange)="selectedCountry = $event.toUpperCase(); refresh$.next(refresh$.value + 1)"
        />
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
                    <td>{{ poi.country_code || '-' }}</td>
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
                        <button type="button" class="secondary icon-action double-icon-action" title="Edit metadata" aria-label="Edit metadata" (click)="openMetadataDialog(poi)">✎▤</button>
                        <button type="button" class="secondary icon-action" [title]="duplicatingIds.has(poi.id) ? 'Duplicating...' : 'Duplicate'" [attr.aria-label]="duplicatingIds.has(poi.id) ? 'Duplicating...' : 'Duplicate'" [disabled]="duplicatingIds.has(poi.id)" (click)="duplicatePoi(poi)">⧉</button>
                        <button type="button" class="secondary icon-action danger-action" title="Delete" aria-label="Delete" (click)="deletePoi(poi)">⌫</button>
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
            <h2>Edit POI metadata</h2>
            <button type="button" class="icon-button" aria-label="Close metadata dialog" (click)="closeMetadataDialog()">x</button>
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
            <button type="submit" class="primary">Save metadata</button>
          </footer>
        </form>
      </dialog>
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class PoiListComponent {
  @ViewChild('metadataDialog') private readonly metadataDialog?: ElementRef<HTMLDialogElement>;

  private readonly api = inject(ApiService);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  selectedCategory = '';
  selectedCountry = '';
  statusMessage = '';
  statusIsError = false;
  availableCategories: Category[] = [];
  editingPoi: Poi | null = null;
  poiDraft: PoiDraft = this.emptyPoiDraft();
  translationDrafts: TranslationDraft[] = [];
  readonly duplicatingIds = new Set<number>();

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$
  ]).pipe(
    switchMap(([query]) => combineLatest([
      this.api.listPois(query, '', undefined, this.selectedCategory, this.selectedCountry),
      this.api.listAllCategories()
    ]).pipe(
      map(([page, categories]) => {
        this.availableCategories = categories;
        return { items: page.results, error: '' };
      }),
      catchError(error => of({ items: [] as Poi[], error: `Could not load POIs. ${error.message}` }))
    )),
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
    if (!this.editingPoi) return;

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
      await firstValueFrom(this.api.updatePoi(this.editingPoi.id, {
        enabled: this.poiDraft.enabled,
        country_code: this.poiDraft.country_code.trim().toUpperCase(),
        gps_latitude: Number(this.poiDraft.gps_latitude),
        gps_longitude: Number(this.poiDraft.gps_longitude),
        website: this.poiDraft.website.trim(),
        category_ids: this.poiDraft.category_ids,
        translations
      }));
      this.closeMetadataDialog();
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save POI metadata. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }

  private clearStatus(): void {
    this.statusMessage = '';
    this.statusIsError = false;
  }
}
