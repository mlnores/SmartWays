import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService, Fest, FestCategory, FestEdition, FestMedia, FestMediaTranslation, GeoJsonPolygonGeometry, Translation } from './api.service';
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
  media_type: FestMedia['media_type'];
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

interface FestEditionDraft {
  id?: number;
  year: number;
  notes: string;
  is_cancelled: boolean;
  dates: string[];
  newDate: string;
}

interface CalendarDay {
  key: string;
  day: number | null;
  date: string | null;
}

interface CalendarMonth {
  key: string;
  name: string;
  days: CalendarDay[];
}

type EditorTab = 'basic' | 'translations' | 'media';

interface FootprintPoint {
  lat: number;
  lng: number;
}

declare const L: any;

const DEFAULT_FEST_FOOTPRINT_RADIUS_METERS = 5000;
const DEFAULT_FEST_FOOTPRINT_SIDES = 6;
const EARTH_RADIUS_METERS = 6371008.8;
const IMAGE_COMPRESSION_TARGET_SIZE = 7 * 1024 * 1024;
const IMAGE_COMPRESSION_MAX_DIMENSION = 2560;
const IMAGE_COMPRESSION_QUALITY = 0.86;

@Component({
  selector: 'app-fest-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="page poi-editor-page">
      <header class="page-header">
        <div class="poi-editor-heading">
          <div>
            <div class="title-with-switch">
              <h1>{{ isNewFest ? 'New Fest' : (fest?.title || 'Fest editor') }}</h1>
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
          @if (statusMessage) {
            <p class="inline-save-status" [class.error]="statusIsError">{{ statusMessage }}</p>
          }
          <button type="button" class="primary" [disabled]="saving || loading || isReadOnlyPublicFest() || !canSave()" (click)="saveFest()">
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </header>

      @if (loading) {
        <p class="status">Loading Fest...</p>
      } @else if (editorReady) {
        <div class="editor-shell">
          <nav class="editor-tabs" aria-label="Fest editor sections">
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
                    <h2>Location and celebration dates</h2>
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
                    <div class="metadata-full-row fest-dates-field">
                      <span>Dates</span>
                      <div class="fest-dates-summary-row">
                        <div class="date-badge-list" aria-label="Celebration dates">
                          @for (date of editionDateBadges(); track date) {
                            <span class="date-badge">{{ date }}</span>
                          } @empty {
                            <p class="muted">No dates selected.</p>
                          }
                        </div>
                        <button type="button" class="secondary" [disabled]="!canEditContent()" (click)="openDateDialog()">See/edit dates</button>
                      </div>
                    </div>
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
                          @for (category of availableFestCategoryOptions(); track category.id) {
                            <button type="button" [disabled]="!canEditContent()" (click)="addFestCategory(category.id)">
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
                            [(ngModel)]="newFestCategoryName"
                            name="newFestCategoryName"
                            [disabled]="!canEditContent()"
                          />
                          <button type="button" class="primary" title="Create category" aria-label="Create category" [disabled]="!canEditContent()" (click)="createFestCategoryFromEditor()">+</button>
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
                          @for (category of chosenFestCategoryOptions(); track category.id) {
                            <button type="button" [disabled]="!canEditContent()" (click)="removeFestCategory(category.id)">
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
                      <aside class="footprint-edit-column" aria-label="Fest area editing controls">
                        <p class="footprint-help">Add/remove polygons to delimit the fest's area; drag points to modify their shapes; double click to add new points.</p>
                        <button type="button" class="secondary" [disabled]="!hasValidCoordinates()" (click)="addFootprintPolygon()">Add polygon</button>
                        <button type="button" class="secondary danger-action" [disabled]="selectedFootprintPolygonIndex === null" (click)="removeSelectedFootprintPolygon()">Remove polygon</button>
                        <button type="button" class="secondary" (click)="fitFootprintView()">Fit view</button>
                        <button type="button" class="secondary" [disabled]="!canUndoFootprint()" (click)="undoFootprintEdit()">Undo</button>
                        <button type="button" class="secondary" [disabled]="!canRedoFootprint()" (click)="redoFootprintEdit()">Redo</button>
                        <button type="button" class="primary" (click)="saveFootprintEditor()">Done</button>
                        <button type="button" class="secondary" [disabled]="!hasValidCoordinates()" (click)="resetFootprintEditorToDefault()">Back to default</button>
                        @if (footprintPointWarning()) {
                          <p class="footprint-warning">{{ footprintPointWarning() }}</p>
                        }
                      </aside>
                    }
                    <div class="location-map" #locationMap></div>
                  </div>
                  <section class="basic-media-preview">
                    <h2>Media preview</h2>
                    <div class="basic-media-strip" aria-label="Fest media preview">
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
                        <p class="muted">No media linked to this Fest.</p>
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
                <div class="translation-tabs" role="tablist" aria-label="Fest translation languages">
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
                        <select [(ngModel)]="item.media_type" (ngModelChange)="mediaTypeChanged($index)" [name]="'mediaType' + $index" [disabled]="!canEditContent()">
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
                        @if (item.media_type !== 'link') {
                          <div class="view-toggle media-source-toggle" aria-label="Media source">
                            <button type="button" [class.active]="item.source === 'local'" [disabled]="!canEditContent()" (click)="setMediaSource($index, 'local')">Local file</button>
                            <button type="button" [class.active]="item.source === 'remote'" [disabled]="!canEditContent()" (click)="setMediaSource($index, 'remote')">Remote URL</button>
                          </div>
                        }
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
                  <p class="muted">No media linked to this Fest yet.</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>

    @if (isDateDialogOpen) {
      <div class="account-dialog-backdrop" role="presentation">
        <section class="account-dialog fest-date-dialog" role="dialog" aria-modal="true" aria-labelledby="fest-dates-title">
          <div class="account-dialog-header">
            <h2 id="fest-dates-title">Celebration dates</h2>
            <button type="button" class="icon-button" aria-label="Close celebration dates dialog" (click)="closeDateDialog()">✖</button>
          </div>

          <div class="fest-date-dialog-body">
            <aside class="fest-year-tabs" aria-label="Celebration years">
              @for (year of dateDialogYears(); track year) {
                <button
                  type="button"
                  class="translation-tab"
                  [class.has-dates]="editionHasDates(year)"
                  [class.not-held]="editionNotHeld(year)"
                  [class.active]="selectedDateEditionIndex === $index"
                  (click)="selectedDateEditionIndex = $index"
                >
                  {{ year }}
                </button>
              }
            </aside>

            @if (activeDateEdition(); as edition) {
              <article class="fest-edition-row">
                <header>
                  <h3>{{ edition.year }}</h3>
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      [ngModel]="edition.is_cancelled"
                      (ngModelChange)="setEditionNotHeld(edition, $event)"
                      [name]="'editionCancelled' + edition.year"
                      [disabled]="!canEditContent()"
                    />
                    <span>Not held</span>
                  </label>
                </header>
                <div class="edition-calendar" [attr.aria-label]="'Calendar for ' + edition.year">
                  @for (month of calendarMonthsForEdition(edition); track month.key) {
                    <section class="calendar-month">
                      <h4>{{ month.name }}</h4>
                      <div class="calendar-weekdays" aria-hidden="true">
                        @for (weekday of weekdayLabels; track weekday) {
                          <span>{{ weekday }}</span>
                        }
                      </div>
                      <div class="calendar-grid">
                        @for (day of month.days; track day.key) {
                          @if (day.date) {
                            <button
                              type="button"
                              class="calendar-day"
                              [class.selected]="isEditionDateSelected(edition, day.date)"
                              [disabled]="!canEditContent() || edition.is_cancelled"
                              (click)="toggleEditionDate(edition, day.date)"
                            >
                              {{ day.day }}
                            </button>
                          } @else {
                            <span class="calendar-day empty" aria-hidden="true"></span>
                          }
                        }
                      </div>
                    </section>
                  }
                </div>
                <div class="date-chip-list">
                  @for (date of edition.dates; track date) {
                    <button type="button" class="date-chip" [disabled]="!canEditContent()" (click)="removeDateFromEdition(edition, date)">
                      {{ date }}
                    </button>
                  } @empty {
                    <p class="muted">No dates selected for this year.</p>
                  }
                </div>
              </article>
            } @else {
              <p class="muted">No celebration years yet.</p>
            }
          </div>

          <div class="account-dialog-actions">
            <button type="button" class="primary" (click)="closeDateDialog()">Done</button>
          </div>
        </section>
      </div>
    }
  `,
  styleUrls: ['./resource-list.css', './poi-editor.component.css']
})
export class FestEditorComponent implements OnInit, AfterViewInit, OnDestroy {
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
  private readonly footprintPointerDownHandler = (event: PointerEvent) => this.handleFootprintPointerDown(event);
  private readonly footprintPointerMoveHandler = (event: PointerEvent) => this.handleFootprintPointerMove(event);
  private readonly footprintPointerUpHandler = (event: PointerEvent) => this.handleFootprintPointerUp(event);
  private readonly footprintDoubleClickHandler = (event: MouseEvent) => this.handleFootprintDoubleClick(event);

  fest: Fest | null = null;
  isNewFest = false;
  editorReady = false;
  categories: FestCategory[] = [];
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
  newFestCategoryName = '';
  translations: TranslationDraft[] = [];
  media: MediaDraft[] = [];
  editions: FestEditionDraft[] = [];
  isDateDialogOpen = false;
  selectedDateEditionIndex = 0;
  private savedSnapshot = '';

  readonly mediaTypes: FestMedia['media_type'][] = ['image', 'video', 'audio', 'document', 'link', 'other'];
  readonly weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  private readonly monthLabels = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    this.isNewFest = !id || id === 'new';
    this.pageInstruction.setInstruction(this.isNewFest ? 'Create a draft fest.' : 'View/edit fest metadata, dates, translations, and linked media.');
    this.title.setTitle(this.isNewFest ? 'SW Fest New' : `SW Fest ${id}`);

    try {
      const categories = await firstValueFrom(this.api.listAllFestCategories());
      this.categories = this.sortedUniqueCategories(categories);
      if (this.isNewFest) {
        this.loadBlankFest();
      } else if (id) {
        const fest = await firstValueFrom(this.api.getFest(id));
        this.loadFest(fest);
      }
    } catch (error) {
      this.showStatus(`Could not load Fest #${id}. ${this.requestErrorMessage(error)}`, true);
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

  mediaTypeChanged(index: number): void {
    if (this.media[index]?.media_type === 'link') {
      this.setMediaSource(index, 'remote');
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

  mediaTypeLabel(type: FestMedia['media_type']): string {
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

  categoryDisplayName(category: FestCategory): string {
    return category.name || category.slug;
  }

  availableFestCategoryOptions(): FestCategory[] {
    const chosen = new Set(this.categoryIds);
    return this.filterCategories(this.categories.filter(category => !chosen.has(category.id)), this.categoryAvailableFilter);
  }

  chosenFestCategoryOptions(): FestCategory[] {
    const chosen = new Set(this.categoryIds);
    return this.filterCategories(this.categories.filter(category => chosen.has(category.id)), this.categoryChosenFilter);
  }

  addFestCategory(categoryId: number): void {
    if (!this.canEditContent()) return;
    this.categoryIds = this.uniqueFestCategoryIds([...this.categoryIds, categoryId]);
  }

  removeFestCategory(categoryId: number): void {
    if (!this.canEditContent()) return;
    this.categoryIds = this.categoryIds.filter(id => id !== categoryId);
  }

  chooseAllFilteredCategories(): void {
    if (!this.canEditContent()) return;
    const ids = new Set(this.categoryIds);
    this.availableFestCategoryOptions().forEach(category => ids.add(category.id));
    this.categoryIds = this.uniqueFestCategoryIds([...ids]);
  }

  removeAllFilteredCategories(): void {
    if (!this.canEditContent()) return;
    const filteredIds = new Set(this.chosenFestCategoryOptions().map(category => category.id));
    this.categoryIds = this.categoryIds.filter(id => !filteredIds.has(id));
  }

  async createFestCategoryFromEditor(): Promise<void> {
    if (!this.canEditContent()) return;
    const name = this.newFestCategoryName.trim();
    if (!name) {
      this.showStatus('Enter a category name before creating it.', true);
      return;
    }
    try {
      const category = await firstValueFrom(this.api.createFestCategory({
        slug: this.slugFromText(name),
        translations: [{
          language_code: this.referenceTranslation()?.language_code || 'en',
          name
        }]
      }));
      this.categories = this.sortedUniqueCategories([...this.categories, category]);
      this.addFestCategory(category.id);
      this.newFestCategoryName = '';
      this.clearStatus();
    } catch (error) {
      this.showStatus(`Could not create category. ${this.requestErrorMessage(error)}`, true);
    }
  }

  openDateDialog(): void {
    this.isDateDialogOpen = true;
    this.ensureDateDialogEditionDrafts();
    this.selectedDateEditionIndex = Math.min(this.selectedDateEditionIndex, this.dateDialogYears().length - 1);
  }

  closeDateDialog(): void {
    this.isDateDialogOpen = false;
  }

  activeDateEdition(): FestEditionDraft | null {
    const year = this.dateDialogYears()[this.selectedDateEditionIndex];
    return year ? this.ensureEditionDraft(year) : null;
  }

  dateDialogYears(): number[] {
    const firstYear = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, index) => firstYear + index);
  }

  editionHasDates(year: number): boolean {
    return Boolean(this.editions.find(edition => edition.year === year)?.dates.length);
  }

  editionNotHeld(year: number): boolean {
    return Boolean(this.editions.find(edition => edition.year === year)?.is_cancelled);
  }

  setEditionNotHeld(edition: FestEditionDraft, notHeld: boolean): void {
    if (!this.canEditContent()) return;
    edition.is_cancelled = Boolean(notHeld);
    if (edition.is_cancelled) {
      edition.dates = [];
    }
    this.clearStatus();
  }

  calendarMonthsForEdition(edition: FestEditionDraft): CalendarMonth[] {
    const year = Number(edition.year);
    if (!Number.isInteger(year) || year < 1 || year > 9999) return [];
    return this.monthLabels.map((name, monthIndex) => ({
      key: `${year}-${monthIndex}`,
      name,
      days: this.calendarDays(year, monthIndex)
    }));
  }

  isEditionDateSelected(edition: FestEditionDraft, date: string | null): boolean {
    return Boolean(date && edition.dates.includes(date));
  }

  toggleEditionDate(edition: FestEditionDraft, date: string | null): void {
    if (!this.canEditContent() || !date || edition.is_cancelled) return;
    edition.is_cancelled = false;
    if (edition.dates.includes(date)) {
      edition.dates = edition.dates.filter(item => item !== date);
    } else {
      edition.dates = [...edition.dates, date].sort();
    }
    this.clearStatus();
  }

  addDateToEdition(edition: FestEditionDraft): void {
    if (!this.canEditContent()) return;
    const date = (edition.newDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.showStatus('Choose a valid celebration date.', true);
      return;
    }
    if (!date.startsWith(`${edition.year}-`)) {
      this.showStatus('The celebration date must belong to its edition year.', true);
      return;
    }
    edition.dates = [...new Set([...edition.dates, date])].sort();
    this.clearStatus();
  }

  removeDateFromEdition(edition: FestEditionDraft, date: string): void {
    if (!this.canEditContent()) return;
    edition.dates = edition.dates.filter(item => item !== date);
  }

  editionDateSummary(): string {
    const dates = this.normalizedEditions().flatMap(edition => edition.dates);
    if (dates.length === 0) return 'No dates selected.';
    if (dates.length <= 4) return dates.join(', ');
    return `${dates.slice(0, 4).join(', ')} and ${dates.length - 4} more`;
  }

  editionDateBadges(): string[] {
    return this.normalizedEditions().flatMap(edition => edition.dates);
  }

  private calendarDays(year: number, monthIndex: number): CalendarDay[] {
    const firstDay = new Date(Date.UTC(year, monthIndex, 1));
    const leadingEmptyDays = (firstDay.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const days: CalendarDay[] = [];
    for (let index = 0; index < leadingEmptyDays; index += 1) {
      days.push({ key: `${year}-${monthIndex}-empty-${index}`, day: null, date: null });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push({
        key: `${year}-${monthIndex}-${day}`,
        day,
        date: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      });
    }
    return days;
  }

  async saveFest(): Promise<boolean> {
    if (!this.canSave()) {
      this.showStatus('There are no editable changes to save.', true);
      return false;
    }

    if (this.fest?.enabled && !this.enabled) {
      this.saving = true;
      try {
        const updated = await firstValueFrom(this.api.updateFest(this.fest.id, { enabled: false }));
        this.loadFest(updated);
        this.showStatus('Fest saved as draft.', false);
        return true;
      } catch (error) {
        this.showStatus('Could not save Fest.', true);
        return false;
      } finally {
        this.saving = false;
      }
    }

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every Fest translation needs a language and title.', true);
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
        category_ids: this.uniqueFestCategoryIds(this.categoryIds),
        translations,
        media,
        editions: this.normalizedEditions()
      };
      const updated = this.fest
        ? await firstValueFrom(this.api.updateFest(this.fest.id, payload))
        : await firstValueFrom(this.api.createFest(payload));
      const finalFest = await this.uploadPendingMedia(updated);
      this.loadFest(finalFest);
      if (this.isNewFest) {
        this.isNewFest = false;
        void this.router.navigate(['/fests', finalFest.id, 'edit'], {
          replaceUrl: true,
          queryParams: this.route.snapshot.queryParams
        });
      }
      this.showStatus(this.enabled ? 'Fest saved as public.' : 'Fest saved as draft.', false);
      return true;
    } catch (error) {
      this.showStatus('Could not save Fest.', true);
      return false;
    } finally {
      this.saving = false;
    }
  }

  canEditContent(): boolean {
    return this.isNewFest || !this.fest || !this.fest.enabled || !this.enabled;
  }

  async setPublicationState(enabled: boolean): Promise<void> {
    if (this.saving || this.loading || this.enabled === enabled) return;
    if (!this.confirmPublicationStateChange(enabled)) return;
    const previousEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled) {
      const saved = await this.saveFest();
      if (!saved) {
        this.enabled = previousEnabled;
      }
    }
  }

  private confirmPublicationStateChange(enabled: boolean): boolean {
    if (!this.fest) return true;
    if (enabled) {
      return window.confirm(`Really make Fest "${this.fest.title || 'Untitled Fest'}" public?`);
    }
    return window.confirm(`Really turn Fest "${this.fest.title || 'Untitled Fest'}" to draft?`);
  }

  canSave(): boolean {
    if (this.isReadOnlyPublicFest()) {
      return false;
    }
    return this.currentSnapshot() !== this.savedSnapshot
      && (this.canEditContent() || Boolean(this.fest && this.fest.enabled !== this.enabled));
  }

  isReadOnlyPublicFest(): boolean {
    return Boolean(this.fest?.enabled && this.enabled);
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

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.isDateDialogOpen) {
      this.closeDateDialog();
    }
  }

  private loadFest(fest: Fest): void {
    this.revokeMediaPreviewUrls();
    this.fest = fest;
    this.title.setTitle(`SW Fest ${this.titlePart(fest.title || `Fest ${fest.id}`)}`);
    this.enabled = fest.enabled;
    this.countryCode = fest.country_code || '';
    this.latitude = fest.gps_latitude;
    this.longitude = fest.gps_longitude;
    this.footprint = this.normalizedFootprint(fest.footprint);
    this.resetFootprintEditorState();
    this.website = fest.website || '';
    this.phone = fest.phone || '';
    this.email = fest.email || '';
    this.categoryIds = this.uniqueFestCategoryIds(fest.categories.map(category => category.id));
    this.translations = this.translationDraftsFrom(fest.translations, fest.title, fest.description, fest.slug);
    this.activeTranslationIndex = Math.max(0, this.translations.findIndex(translation => translation.is_reference));
    this.media = this.mediaDraftsFrom(fest.media || []);
    this.editions = this.editionDraftsFrom(fest.editions || []);
    this.titleNeedsRefresh = false;
    this.editorReady = true;
    this.savedSnapshot = this.currentSnapshot();
    window.setTimeout(() => this.updateLocationMap(true), 0);
  }

  private loadBlankFest(): void {
    const latitude = this.queryNumber('latitude') ?? this.queryNumber('lat');
    const longitude = this.queryNumber('longitude') ?? this.queryNumber('lng') ?? this.queryNumber('lon');
    this.fest = null;
    this.title.setTitle('SW Fest New');
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
    this.editions = [];
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
      this.showStatus(`Could not get place name. ${this.requestErrorMessage(error)}`, true);
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
      const footprint = this.effectiveFootprint();
      if (footprint) {
        L.geoJSON(footprint, {
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
    this.editFootprintPolygons = this.polygonsFromFootprint(this.effectiveFootprint());
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

  resetFootprintEditorToDefault(): void {
    if (!this.hasValidCoordinates()) return;
    const defaultPolygons = this.defaultFestFootprintPolygons();
    if (defaultPolygons.length === 0) return;
    this.rememberFootprintEdit();
    this.editFootprintPolygons = defaultPolygons;
    this.selectedFootprintPolygonIndex = 0;
    this.updateLocationMap(true);
  }

  saveFootprintEditor(): void {
    this.footprint = this.footprintFromPolygons(this.editFootprintPolygons) || this.defaultFestFootprint();
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
      : 'Fest coordinates are outside the area.';
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
      return this.footprintFromPolygons(this.editFootprintPolygons) || this.defaultFestFootprint();
    }
    return this.effectiveFootprint();
  }

  private effectiveFootprint(): GeoJsonPolygonGeometry | null {
    return this.normalizedFootprint(this.footprint) || this.defaultFestFootprint();
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

  private defaultFestFootprint(): GeoJsonPolygonGeometry | null {
    return this.footprintFromPolygons(this.defaultFestFootprintPolygons());
  }

  private defaultFestFootprintPolygons(): FootprintPoint[][] {
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) return [];
    return [
      this.regularPolygonAroundCoordinate(
        Number(this.latitude),
        Number(this.longitude),
        DEFAULT_FEST_FOOTPRINT_RADIUS_METERS,
        DEFAULT_FEST_FOOTPRINT_SIDES
      )
    ];
  }

  private regularPolygonAroundCoordinate(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    sides: number
  ): FootprintPoint[] {
    return Array.from({ length: sides }, (_, index) => (
      this.destinationPoint(latitude, longitude, radiusMeters, index * (360 / sides))
    ));
  }

  private destinationPoint(latitude: number, longitude: number, distanceMeters: number, bearingDegrees: number): FootprintPoint {
    const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
    const bearing = bearingDegrees * Math.PI / 180;
    const startLat = latitude * Math.PI / 180;
    const startLng = longitude * Math.PI / 180;
    const endLat = Math.asin(
      Math.sin(startLat) * Math.cos(angularDistance)
      + Math.cos(startLat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const endLng = startLng + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(startLat),
      Math.cos(angularDistance) - Math.sin(startLat) * Math.sin(endLat)
    );
    return {
      lat: this.roundCoordinate(endLat * 180 / Math.PI),
      lng: this.roundCoordinate(((endLng * 180 / Math.PI + 540) % 360) - 180)
    };
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

  private mediaDraftsFrom(media: FestMedia[]): MediaDraft[] {
    return media.map(item => ({
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

  private editionDraftsFrom(editions: FestEdition[]): FestEditionDraft[] {
    return this.sortedEditions(editions.map(edition => ({
      id: edition.id,
      year: edition.year,
      notes: '',
      is_cancelled: Boolean(edition.is_cancelled),
      dates: edition.is_cancelled ? [] : [...new Set(edition.dates || [])].sort(),
      newDate: `${edition.year}-01-01`
    })));
  }

  private ensureDateDialogEditionDrafts(): void {
    const existingYears = new Set(this.editions.map(edition => edition.year));
    const additions = this.dateDialogYears()
      .filter(year => !existingYears.has(year))
      .map(year => this.blankEditionDraft(year));
    if (additions.length > 0) {
      this.editions = this.sortedEditions([...this.editions, ...additions]);
    }
  }

  private ensureEditionDraft(year: number): FestEditionDraft {
    let edition = this.editions.find(item => item.year === year);
    if (!edition) {
      edition = this.blankEditionDraft(year);
      this.editions = this.sortedEditions([...this.editions, edition]);
    }
    return edition;
  }

  private blankEditionDraft(year: number): FestEditionDraft {
    return {
      year,
      notes: '',
      is_cancelled: false,
      dates: [],
      newDate: `${year}-01-01`
    };
  }

  private sortedEditions(editions: FestEditionDraft[]): FestEditionDraft[] {
    return [...editions].sort((left, right) => left.year - right.year);
  }

  private mediaCaptionsFrom(translations: FestMediaTranslation[]): Record<string, string> {
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

  private async uploadPendingMedia(fest: Fest): Promise<Fest> {
    const pending = this.media
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.selectedFile);
    if (pending.length === 0) return fest;

    for (const { item, index } of pending) {
      if (!item.selectedFile) continue;
      item.uploading = true;
      const uploadFile = await this.fileForMediaUpload(item.selectedFile);
      if (item.id) {
        await firstValueFrom(this.api.updateFestMedia(
          item.id,
          uploadFile,
          item.media_type,
          Number.isFinite(Number(item.position)) ? Number(item.position) : index,
          item.is_primary,
          this.mediaTranslationsForPayload(item)
        ));
      } else {
        await firstValueFrom(this.api.uploadFestMedia(
          fest.id,
          uploadFile,
          item.media_type,
          Number.isFinite(Number(item.position)) ? Number(item.position) : index,
          item.is_primary,
          this.mediaTranslationsForPayload(item)
        ));
      }
      item.uploading = false;
    }

    return firstValueFrom(this.api.getFest(fest.id));
  }

  private async fileForMediaUpload(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) {
      return file;
    }
    try {
      return await this.compressedImageFile(file);
    } catch {
      return file;
    }
  }

  private async compressedImageFile(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    try {
      let bestBlob: Blob | null = null;
      const maxDimensions = [IMAGE_COMPRESSION_MAX_DIMENSION, 2048, 1600, 1280];
      const qualities = [IMAGE_COMPRESSION_QUALITY, 0.78, 0.7, 0.62];
      for (const maxDimension of maxDimensions) {
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of qualities) {
          const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
          });
          if (!blob) continue;
          if (!bestBlob || blob.size < bestBlob.size) {
            bestBlob = blob;
          }
          if (blob.size <= IMAGE_COMPRESSION_TARGET_SIZE) {
            bestBlob = blob;
            break;
          }
        }
        if (bestBlob && bestBlob.size <= IMAGE_COMPRESSION_TARGET_SIZE) break;
      }
      if (!bestBlob || bestBlob.size >= file.size) return file;
      const filename = file.name.replace(/\.[^.]+$/, '') || 'image';
      return new File([bestBlob], `${filename}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified
      });
    } finally {
      bitmap.close?.();
    }
  }

  private mediaTypeFromFile(file: File): FestMedia['media_type'] {
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

  private normalizedMedia(): FestMedia[] {
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

  private normalizedEditions(): FestEdition[] {
    return this.sortedEditions(this.editions)
      .map(edition => ({
        id: edition.id,
        year: Number(edition.year),
        notes: '',
        is_cancelled: Boolean(edition.is_cancelled),
        dates: edition.is_cancelled ? [] : [...new Set(edition.dates)]
          .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(`${edition.year}-`))
          .sort()
      }))
      .filter(edition => Number.isInteger(edition.year))
      .filter(edition => Boolean(edition.id || edition.dates.length > 0 || edition.notes || edition.is_cancelled));
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
      category_ids: this.uniqueFestCategoryIds(this.categoryIds).sort((left, right) => left - right),
      translations: this.normalizedTranslations(),
      media: this.normalizedMedia(),
      editions: this.normalizedEditions(),
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

  private mediaTranslationsForPayload(item: MediaDraft): FestMediaTranslation[] {
    return Object.entries(item.captions)
      .map(([language_code, caption]) => ({
        language_code: language_code.trim(),
        caption: caption.trim()
      }))
      .filter(translation => translation.language_code && translation.caption);
  }

  private filterCategories(categories: FestCategory[], filter: string): FestCategory[] {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return categories;
    return categories.filter(category =>
      this.categoryDisplayName(category).toLowerCase().includes(normalizedFilter)
      || category.slug.toLowerCase().includes(normalizedFilter)
    );
  }

  private uniqueFestCategoryIds(categoryIds: number[]): number[] {
    return [...new Set(categoryIds.filter(id => Number.isFinite(id)))];
  }

  private sortedUniqueCategories(categories: FestCategory[]): FestCategory[] {
    const categoriesById = new Map<number, FestCategory>();
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

  private requestErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return this.errorBodyMessage(error.error) || `Service returned ${error.status}.`;
    }
    return error instanceof Error ? error.message : 'Request failed.';
  }

  private errorBodyMessage(errorBody: unknown): string {
    if (!errorBody) return '';
    if (typeof errorBody === 'string') {
      return errorBody.trim().startsWith('<') ? '' : errorBody;
    }
    if (Array.isArray(errorBody)) {
      return errorBody.map(item => this.errorBodyMessage(item)).filter(Boolean).join(' ');
    }
    if (typeof errorBody === 'object') {
      return Object.entries(errorBody)
        .map(([field, value]) => {
          const message = this.errorBodyMessage(value);
          return field === 'detail' ? message : `${field}: ${message}`;
        })
        .filter(Boolean)
        .join(' ');
    }
    return String(errorBody);
  }
}
