import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, finalize, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary, ItineraryRouteMembership, Route, Translation } from './api.service';
import { MediaManagerDialogComponent } from './media-manager-dialog.component';
import { PageInstructionService } from './page-instruction.service';

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
  routeId: number | null;
  stageNumber: number | null;
}

type RouteInsertMode = 'beginning' | 'end' | 'before' | 'after';

interface RouteInsertDraft {
  mode: RouteInsertMode;
  anchorItineraryId: number | null;
}

interface ImportRouteSource {
  id: number | 'unassigned';
  title: string;
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
const PREVIEW_COLORS = ['#1f6feb', '#d97706', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];

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

interface PreviewLineStyle {
  weight: number;
  opacity: number;
  dashArray?: string | null;
}

interface PreviewRenderOptions {
  showMarkers?: boolean;
  fitItineraryIds?: Set<number>;
  markerClickFor?: (itinerary: Itinerary) => void;
}

interface ViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

type ItinerarySortKey = 'stage' | 'title' | 'length' | 'missingPaths' | 'draft';
type SortDirection = 'asc' | 'desc';

declare const L: any;

@Component({
  selector: 'app-itinerary-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, NgTemplateOutlet, RouterLink, MediaManagerDialogComponent],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <div class="title-with-switch">
            <h1>{{ routeSlug ? routeTitle || 'Route itineraries' : 'Itineraries' }}</h1>
            @if (routeSlug) {
              @if (currentRoute) {
                <div class="publication-inline-switch" aria-label="Route state">
                  <div class="publication-inline-toggle">
                    <button type="button" [class.active]="!currentRoute.enabled" (click)="setCurrentRouteState(false)">Draft</button>
                    <button type="button" [class.active]="currentRoute.enabled" (click)="setCurrentRouteState(true)">Public (read-only)</button>
                  </div>
                </div>
              }
            }
          </div>
        </div>
        @if (!routeSlug) {
          <button type="button" class="primary" title="New itinerary" aria-label="New itinerary" (click)="openNewItineraryDialog()">New itinerary</button>
        }
      </header>
      <app-media-manager-dialog #mediaManagerDialog (saved)="refreshList()"></app-media-manager-dialog>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search itineraries by title or description"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
        @if (!routeSlug) {
          <div class="view-toggle" aria-label="Itinerary display mode">
            <button type="button" [class.active]="viewMode === 'flat'" (click)="viewMode = 'flat'">Plain list</button>
            <button type="button" [class.active]="viewMode === 'grouped'" (click)="viewMode = 'grouped'">Grouped by route</button>
          </div>
          <label class="toolbar-switch">
            <span>Update list with map view</span>
            <input
              type="checkbox"
              [ngModel]="listUpdatesWithMapView"
              (ngModelChange)="setListUpdatesWithMapView($event)"
            />
            <span class="switch-track" aria-hidden="true">
              <span class="switch-thumb"></span>
            </span>
          </label>
          @if (loadingItineraries) {
            <span class="toolbar-loading-indicator" role="status" aria-live="polite">
              <span class="toolbar-loading-spinner" aria-hidden="true"></span>
              <span>Downloading itinerary info</span>
            </span>
          } @else {
            <span class="toolbar-result-count">Found {{ displayedItineraries.length }} itineraries</span>
          }
        } @else {
          <button type="button" class="secondary toolbar-action" [disabled]="!currentRouteIsDraft" (click)="openNewItineraryForCurrentRoute()">Create new itinerary</button>
          <button type="button" class="secondary toolbar-action" [disabled]="!currentRouteIsDraft" (click)="openAddExistingItinerariesDialog()">Add existing itinerary</button>
          <button type="button" class="secondary toolbar-action" [disabled]="!currentRouteIsDraft" (click)="openImportItinerariesDialog()">Import itineraries from other routes</button>
          <button type="button" class="secondary toolbar-action" [disabled]="!currentRouteIsDraft" (click)="openRouteMediaDialog()">Manage route metadata, translations and media</button>
        }
      </div>
      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <div class="preview-layout itinerary-preview-layout">
            <div class="preview-list">
              @if (routeSlug || viewMode === 'flat') {
                <ng-container *ngTemplateOutlet="itineraryTable; context: { items: routeSlug ? state.items : displayedItineraries, routes: state.routes }"></ng-container>
              } @else {
                <div class="route-group-list">
              @for (group of groupsFor(displayedItineraries); track groupKey(group)) {
                <section class="route-group">
                  <header class="route-group-header">
                    <button
                      type="button"
                      class="route-group-toggle"
                      [attr.aria-expanded]="!isGroupCollapsed(group)"
                      (click)="toggleGroup(group)"
                    >
                      <span class="route-group-caret" aria-hidden="true">{{ isGroupCollapsed(group) ? '▶' : '▼' }}</span>
                      <span>{{ group.title }}</span>
                      <span class="muted">{{ group.items.length }} {{ group.items.length === 1 ? 'itinerary' : 'itineraries' }}</span>
                    </button>
                  </header>
                  @if (!isGroupCollapsed(group)) {
                    <div class="table-wrap">
                      <table class="resource-table">
                        <thead>
                          <tr>
                          <th>
                            <button type="button" class="sortable-header" (click)="toggleItinerarySort('title')">
                              <span>Itinerary</span>
                              <span aria-hidden="true">{{ itinerarySortIndicator('title') }}</span>
                            </button>
                          </th>
                            <th class="length-column">
                              <button type="button" class="sortable-header" (click)="toggleItinerarySort('length')">
                                <span>Length</span>
                                <span aria-hidden="true">{{ itinerarySortIndicator('length') }}</span>
                              </button>
                            </th>
                            <th class="missing-paths-column">
                              <button type="button" class="sortable-header" (click)="toggleItinerarySort('missingPaths')">
                                <span>Missing paths?</span>
                                <span aria-hidden="true">{{ itinerarySortIndicator('missingPaths') }}</span>
                              </button>
                            </th>
                            <th class="enabled-column">
                            <button type="button" class="sortable-header" (click)="toggleItinerarySort('draft')">
                              <span>Draft?</span>
                              <span aria-hidden="true">{{ itinerarySortIndicator('draft') }}</span>
                            </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (itinerary of group.items; track itinerary.id) {
                            <tr
                              [attr.id]="itineraryRowId(itinerary)"
                              [class.highlight-row]="highlightedItineraryId === itinerary.id"
                              [class.preview-selected-row]="previewItinerary?.id === itinerary.id"
                              (click)="toggleItineraryRowPreview(itinerary)"
                              (dblclick)="openItineraryFromDoubleClick(itinerary)"
                            >
                            <td>
                              {{ itinerary.title || 'Untitled itinerary' }}
                              <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                              <p class="point-preview">{{ firstPointName(itinerary) }} → {{ lastPointName(itinerary) }}</p>
                              </td>
                              <td class="length-column">{{ estimatedDistance(itinerary) }}</td>
                              <td class="missing-paths-column">
                                {{ hasMissingPaths(itinerary) ? 'Yes' : 'No' }}
                              </td>
                              <td class="enabled-column">
                                {{ itinerary.enabled ? 'No' : 'Yes' }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </section>
              } @empty {
                <p class="empty">{{ listUpdatesWithMapView && currentItineraries.length ? 'No itineraries visible in the current map view.' : 'No itineraries found.' }}</p>
              }
                </div>
              }
            </div>
            <aside class="preview-panel" aria-label="Itinerary map preview">
              <header>
                <h2>Map preview</h2>
                <p>{{ previewLabel() }}</p>
              </header>
              <div class="preview-map" #previewMap></div>
              @if (previewMessage) {
                <p class="muted preview-message">{{ previewMessage }}</p>
              }
              <div class="preview-actions" aria-label="Itinerary preview actions">
                @if (routeSlug || !listUpdatesWithMapView) {
                  <button type="button" class="secondary preview-action" (click)="fitPreviewToCurrentItineraries()">
                    <span class="preview-action-icon" aria-hidden="true">🎯</span>
                    <span>Fit view to list</span>
                  </button>
                }

                @if (previewItinerary) {
                  @if (!previewItinerary.enabled) {
                    <button type="button" class="secondary preview-action" (click)="setItineraryEnabled(previewItinerary, true)">
                      <span class="preview-action-icon" aria-hidden="true">🌐</span>
                      <span>Make public</span>
                    </button>
                  }
                  @if (previewItinerary.enabled) {
                    <button type="button" class="secondary preview-action" (click)="setItineraryEnabled(previewItinerary, false)">
                      <span class="preview-action-icon" aria-hidden="true">✎</span>
                      <span>Turn to draft</span>
                    </button>
                  }
                  <button type="button" class="secondary preview-action" [disabled]="previewItinerary.enabled" (click)="openSelectedItineraryMediaDialog(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">🖼️</span>
                    <span>Manage metadata, media and translations</span>
                  </button>
                  @if (!previewItinerary.enabled) {
                    <a class="secondary preview-action" [routerLink]="['/itineraries', previewItinerary.id, 'edit']" target="_blank" rel="noopener">
                      <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                      <span>Open in editor</span>
                    </a>
                  } @else {
                    <button type="button" class="secondary preview-action" disabled>
                      <span class="preview-action-icon" aria-hidden="true">🗺️</span>
                      <span>Open in editor</span>
                    </button>
                  }
                  <a class="secondary preview-action" [routerLink]="['/itineraries', previewItinerary.id, 'pois']" target="_blank" rel="noopener">
                    <span class="preview-action-icon" aria-hidden="true">📍</span>
                    <span>View POIs on the path and nearby</span>
                  </a>
                  <button type="button" class="secondary preview-action" [disabled]="duplicatingIds.has(previewItinerary.id)" (click)="duplicateItinerary(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">📄</span>
                    <span>{{ duplicatingIds.has(previewItinerary.id) ? 'Duplicating...' : 'Duplicate' }}</span>
                  </button>
                  <button type="button" class="secondary preview-action" [disabled]="previewItinerary.enabled" (click)="openRouteInclusionDialog()">
                    <span class="preview-action-icon" aria-hidden="true">🔗</span>
                    <span>Manage route inclusions</span>
                  </button>
                  <button type="button" class="secondary preview-action danger-action" [disabled]="previewItinerary.enabled" (click)="deleteItinerary(previewItinerary)">
                    <span class="preview-action-icon" aria-hidden="true">🗑️</span>
                    <span>Delete itinerary</span>
                  </button>
                }
              </div>
            </aside>
          </div>
        }
      }

      <ng-template #itineraryTable let-items="items" let-routes="routes">
        <div class="table-wrap">
          <table class="resource-table">
            <thead>
              <tr>
                <th>
                  <button type="button" class="sortable-header" (click)="toggleItinerarySort('title')">
                    <span>Itinerary</span>
                    <span aria-hidden="true">{{ itinerarySortIndicator('title') }}</span>
                  </button>
                </th>
                @if (!routeSlug) {
                  <th>Included in</th>
                }
                <th class="length-column">
                  <button type="button" class="sortable-header" (click)="toggleItinerarySort('length')">
                    <span>Length</span>
                    <span aria-hidden="true">{{ itinerarySortIndicator('length') }}</span>
                  </button>
                </th>
                <th class="missing-paths-column">
                  <button type="button" class="sortable-header" (click)="toggleItinerarySort('missingPaths')">
                    <span>Missing paths?</span>
                    <span aria-hidden="true">{{ itinerarySortIndicator('missingPaths') }}</span>
                  </button>
                </th>
                <th class="enabled-column">
                  <button type="button" class="sortable-header" (click)="toggleItinerarySort('draft')">
                    <span>Draft?</span>
                    <span aria-hidden="true">{{ itinerarySortIndicator('draft') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (itinerary of items; track itinerary.id) {
                <tr
                  [attr.id]="itineraryRowId(itinerary)"
                  [class.highlight-row]="highlightedItineraryId === itinerary.id"
                  [class.preview-selected-row]="previewItinerary?.id === itinerary.id"
                  [class.dragging-row]="draggedItineraryId === itinerary.id"
                  [attr.draggable]="routeSlug && currentRouteIsDraft ? true : null"
                  (click)="toggleItineraryRowPreview(itinerary)"
                  (dblclick)="openItineraryFromDoubleClick(itinerary)"
                  (dragstart)="startStageDrag(itinerary)"
                  (dragover)="allowStageDrop($event)"
                  (drop)="dropStage(itinerary, items)"
                  (dragend)="endStageDrag()"
                >
                  <td>
                    {{ itinerary.title || 'Untitled itinerary' }}
                    <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                    <p class="point-preview">{{ firstPointName(itinerary) }} → {{ lastPointName(itinerary) }}</p>
                  </td>
                  @if (!routeSlug) {
                    <td>
                      <div class="route-membership-badges">
                        @for (membership of routeMembershipsFor(itinerary); track membership.route) {
                          <a
                            class="route-membership-badge"
                            [routerLink]="['/route', membership.route_slug || membership.route]"
                            [queryParams]="routeMembershipQueryParams(membership, itinerary)"
                            target="_blank"
                            rel="noopener"
                            title="Open route itineraries"
                            aria-label="Open route itineraries"
                            (click)="$event.stopPropagation()"
                          >
                            <span>{{ membership.route_title || 'Route ' + membership.route }}</span>
                            <span>{{ membership.stage_number }}</span>
                          </a>
                        } @empty {
                          <span class="muted">No routes</span>
                        }
                      </div>
                    </td>
                  }
                  <td class="length-column">{{ estimatedDistance(itinerary) }}</td>
                  <td class="missing-paths-column">
                    {{ hasMissingPaths(itinerary) ? 'Yes' : 'No' }}
                  </td>
                  <td class="enabled-column">
                    {{ itinerary.enabled ? 'No' : 'Yes' }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="routeSlug ? 4 : 5">{{ !routeSlug && listUpdatesWithMapView && currentItineraries.length ? 'No itineraries visible in the current map view.' : 'No itineraries found.' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template>

      <dialog class="metadata-dialog wide" #addExistingItinerariesDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveAddExistingItinerariesDialog()">
          <header class="metadata-dialog-header">
            <h2>Add itineraries</h2>
            <button type="button" class="icon-button" aria-label="Close add itineraries dialog" (click)="closeAddExistingItinerariesDialog()">✖</button>
          </header>
          <div class="route-construction-dialog">
            <div class="dialog-search-row">
              <input
                type="search"
                placeholder="Search title or description"
                [(ngModel)]="addItinerarySearch"
                name="addItinerarySearch"
                (keyup.enter)="loadAddItineraryCandidates()"
              />
              <button type="button" class="secondary" (click)="loadAddItineraryCandidates()">Search</button>
            </div>

            <div class="dialog-list" aria-label="Available itineraries">
              @if (addItineraryLoading) {
                <p class="muted dialog-list-message">Loading itineraries...</p>
              } @else {
                @for (itinerary of addItineraryCandidates; track itinerary.id) {
                  <label class="dialog-list-item">
                    <input
                      type="checkbox"
                      [checked]="addItinerarySelectedIds.has(itinerary.id)"
                      (change)="toggleAddItinerarySelection(itinerary.id, $any($event.target).checked)"
                    />
                    <span>
                      <strong>{{ itinerary.title || 'Untitled itinerary' }}</strong>
                      <span class="description-preview">{{ itinerary.description || 'No description' }}</span>
                      <span class="point-preview">{{ firstPointName(itinerary) }} → {{ lastPointName(itinerary) }} · {{ estimatedDistance(itinerary) }}</span>
                    </span>
                  </label>
                } @empty {
                  <p class="muted dialog-list-message">No itineraries found.</p>
                }
              }
            </div>

            <ng-container *ngTemplateOutlet="insertControls; context: { draft: addItineraryInsert, prefix: 'add' }"></ng-container>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeAddExistingItinerariesDialog()">Cancel</button>
            <button type="submit" class="primary" [disabled]="addItinerarySelectedIds.size === 0">Add selected</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #importItinerariesDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveImportItinerariesDialog()">
          <header class="metadata-dialog-header">
            <h2>Import from other routes</h2>
            <button type="button" class="icon-button" aria-label="Close import itineraries dialog" (click)="closeImportItinerariesDialog()">✖</button>
          </header>
          <div class="route-construction-dialog">
            <div class="route-import-grid">
              <section class="route-import-lane" aria-label="Routes">
                <h3>Routes</h3>
                <div class="dialog-list compact">
                  @for (source of importRouteSources; track source.id) {
                    <button
                      type="button"
                      class="route-source-button"
                      [class.active]="importSelectedSourceId === source.id"
                      (click)="selectImportRouteSource(source.id)"
                    >
                      {{ source.title }}
                    </button>
                  } @empty {
                    <p class="muted dialog-list-message">No routes found.</p>
                  }
                </div>
              </section>

              <section class="route-import-lane" aria-label="Itineraries in selected route">
                <h3>Itineraries</h3>
                <div class="dialog-list compact">
                  @if (importItineraryLoading) {
                    <p class="muted dialog-list-message">Loading itineraries...</p>
                  } @else {
                    @for (itinerary of importItineraries; track itinerary.id) {
                      <label class="dialog-list-item">
                        <input
                          type="checkbox"
                          [checked]="importItinerarySelectedIds.has(itinerary.id)"
                          (change)="toggleImportItinerarySelection(itinerary.id, $any($event.target).checked)"
                        />
                        <span>
                          <strong>{{ itinerary.title || 'Untitled itinerary' }}</strong>
                          <span class="description-preview">{{ itinerary.description || 'No description' }}</span>
                          <span class="point-preview">{{ firstPointName(itinerary) }} → {{ lastPointName(itinerary) }} · {{ estimatedDistance(itinerary) }}</span>
                        </span>
                      </label>
                    } @empty {
                      <p class="muted dialog-list-message">No itineraries found.</p>
                    }
                  }
                </div>
              </section>
            </div>

            <ng-container *ngTemplateOutlet="insertControls; context: { draft: importItineraryInsert, prefix: 'import' }"></ng-container>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeImportItinerariesDialog()">Cancel</button>
            <button type="submit" class="primary" [disabled]="importItinerarySelectedIds.size === 0">Import selected</button>
          </footer>
        </form>
      </dialog>

      <ng-template #insertControls let-draft="draft" let-prefix="prefix">
        <fieldset class="insert-controls">
          <legend>Insert selected itineraries</legend>
          <label>
            <input type="radio" [name]="prefix + 'InsertMode'" value="beginning" [(ngModel)]="draft.mode" />
            <span>At the beginning</span>
          </label>
          <label>
            <input type="radio" [name]="prefix + 'InsertMode'" value="end" [(ngModel)]="draft.mode" />
            <span>At the end</span>
          </label>
          <label>
            <input type="radio" [name]="prefix + 'InsertMode'" value="before" [(ngModel)]="draft.mode" [disabled]="routeStageOrder().length === 0" />
            <span>Before</span>
            <select
              [name]="prefix + 'BeforeAnchor'"
              [(ngModel)]="draft.anchorItineraryId"
              [disabled]="draft.mode !== 'before' || routeStageOrder().length === 0"
            >
              @for (itinerary of routeStageOrder(); track itinerary.id) {
                <option [ngValue]="itinerary.id">{{ itinerary.title || 'Untitled itinerary' }}</option>
              }
            </select>
          </label>
          <label>
            <input type="radio" [name]="prefix + 'InsertMode'" value="after" [(ngModel)]="draft.mode" [disabled]="routeStageOrder().length === 0" />
            <span>After</span>
            <select
              [name]="prefix + 'AfterAnchor'"
              [(ngModel)]="draft.anchorItineraryId"
              [disabled]="draft.mode !== 'after' || routeStageOrder().length === 0"
            >
              @for (itinerary of routeStageOrder(); track itinerary.id) {
                <option [ngValue]="itinerary.id">{{ itinerary.title || 'Untitled itinerary' }}</option>
              }
            </select>
          </label>
        </fieldset>
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
            <label>
              <span>Route</span>
              <select [ngModel]="newItinerary.routeId" (ngModelChange)="setNewItineraryRoute($event)" name="newItineraryRoute">
                <option [ngValue]="null">No route</option>
                @for (route of availableRoutes; track route.id) {
                  <option [ngValue]="route.id" [disabled]="route.enabled">{{ route.title || 'Route ' + route.id }}{{ route.enabled ? ' (public)' : '' }}</option>
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

      <dialog class="metadata-dialog wide" #routeInclusionDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveRouteInclusionDialog()">
          <header class="metadata-dialog-header">
            <h2>Manage route inclusions</h2>
            <button type="button" class="icon-button" aria-label="Close route inclusions dialog" (click)="closeRouteInclusionDialog()">✖</button>
          </header>
          <div class="form-stack">
            <p class="muted">
              Managing {{ routeInclusionTargets().length }} {{ routeInclusionTargets().length === 1 ? 'itinerary' : 'itineraries' }}.
            </p>

            <section class="inclusion-list">
              @for (route of availableRoutes; track route.id) {
                <label class="inclusion-row">
                  <input
                    type="checkbox"
                    [checked]="routeInclusionCheckboxState(route.id) === 'all'"
                    [indeterminate]="routeInclusionCheckboxState(route.id) === 'some'"
                    [disabled]="route.enabled"
                    (change)="setRouteInclusionOverride(route.id, $any($event.target).checked)"
                  />
                  <span class="inclusion-row-text">
                    <strong>{{ route.title || 'Route ' + route.id }}</strong>
                    <span class="muted">
                      {{ route.enabled ? 'Public route' : routeInclusionCount(route.id) + ' of ' + routeInclusionTargets().length + ' target ' + (routeInclusionTargets().length === 1 ? 'itinerary' : 'itineraries') }}
                    </span>
                  </span>
                </label>
              } @empty {
                <p class="muted">No routes are available yet.</p>
              }
            </section>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeRouteInclusionDialog()">Cancel</button>
            <button type="submit" class="primary" [disabled]="routeInclusionOverrides.size === 0 || assigningIds.size > 0">Save changes</button>
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
  @ViewChild('routeInclusionDialog') private readonly routeInclusionDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('addExistingItinerariesDialog') private readonly addExistingItinerariesDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('importItinerariesDialog') private readonly importItinerariesDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('mediaManagerDialog') private readonly mediaManagerDialog?: MediaManagerDialogComponent;
  @ViewChild('previewMap') private readonly previewMapElement?: ElementRef<HTMLDivElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly title = inject(Title);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  routeSlug: string | null = null;
  routeTitle: string | null = null;
  currentRoute: Route | null = null;
  currentRouteId: number | null = null;
  currentRouteIsDraft = false;
  viewMode: 'flat' | 'grouped' = 'flat';
  readonly languageOptions = LANGUAGE_OPTIONS;
  statusMessage = '';
  statusIsError = false;
  availableRoutes: Route[] = [];
  newItinerary: NewItineraryDraft = { language_code: 'en', title: '', description: '', routeId: null, stageNumber: null };
  readonly routeInclusionOverrides = new Map<number, boolean>();
  duplicatedItinerary: Itinerary | null = null;
  highlightedItineraryId: number | null = null;
  pendingHighlightItineraryId: number | null = null;
  pendingScrollItineraryId: number | null = null;
  currentItineraries: Itinerary[] = [];
  displayedItineraries: Itinerary[] = [];
  itineraryTotalCount = 0;
  loadingItineraries = false;
  listUpdatesWithMapView = true;
  editingItinerary: Itinerary | null = null;
  translationDrafts: TranslationDraft[] = [];
  activeTranslationIndex = 0;
  addItinerarySearch = '';
  addItineraryCandidates: Itinerary[] = [];
  readonly addItinerarySelectedIds = new Set<number>();
  addItineraryLoading = false;
  addItineraryInsert: RouteInsertDraft = { mode: 'end', anchorItineraryId: null };
  importRouteSources: ImportRouteSource[] = [];
  importSelectedSourceId: number | 'unassigned' | null = null;
  importItineraries: Itinerary[] = [];
  readonly importItinerarySelectedIds = new Set<number>();
  importItineraryLoading = false;
  importItineraryInsert: RouteInsertDraft = { mode: 'end', anchorItineraryId: null };
  readonly duplicatingIds = new Set<number>();
  readonly assigningIds = new Set<number>();
  readonly assignmentDrafts = new Map<number, AssignmentDraft>();
  readonly collapsedGroupKeys = new Set<string>();
  readonly initializedCollapsedGroupKeys = new Set<string>();
  draggedItineraryId: number | null = null;
  reorderingStages = false;
  readonly selectedItineraryIds = new Set<number>();
  itinerarySortKey: ItinerarySortKey = 'stage';
  itinerarySortDirection: SortDirection = 'asc';
  previewItinerary: Itinerary | null = null;
  previewMessage = 'Click an itinerary to preview it.';
  private previewMap: any = null;
  private previewLayer: any = null;
  private previewResizeObserver: ResizeObserver | null = null;
  private previewFitRequestId = 0;
  private displayedItinerariesUpdateRequestId = 0;
  private selectedPreviewFitLocked = false;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('slug'))),
    this.activatedRoute.queryParamMap.pipe(map(params => Number(params.get('highlight')) || null))
  ]).pipe(
    switchMap(([query, , routeSlug, highlightedItineraryId]) => {
      this.loadingItineraries = true;
      this.routeSlug = routeSlug;
      return combineLatest([
        this.api.listAllRoutes(''),
        this.resolveRoute(routeSlug)
      ]).pipe(
        switchMap(([routes, selectedRoute]) => {
          this.availableRoutes = routes;
          this.currentRoute = selectedRoute;
          this.currentRouteId = selectedRoute?.id || null;
          this.routeTitle = selectedRoute?.title || null;
          this.currentRouteIsDraft = selectedRoute ? !selectedRoute.enabled : false;
          this.pageInstruction.setInstruction(this.currentInstruction());
          this.title.setTitle(this.currentPageTitle(routeSlug, selectedRoute));
          if (routeSlug && !selectedRoute) {
            this.currentItineraries = [];
            this.displayedItineraries = [];
            this.itineraryTotalCount = 0;
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
              const sortedItems = this.sortedItineraries(itineraries);
              const items = sortedItems;
              this.currentItineraries = items;
              this.displayedItineraries = this.displayedItinerariesForCurrentMode(items);
              this.itineraryTotalCount = items.length;
              this.pruneSelectedItineraries(items);
              if (this.selectedItineraryIds.size > 1) {
                const firstSelectedId = this.selectedItineraryIds.values().next().value as number | undefined;
                this.selectedItineraryIds.clear();
                if (firstSelectedId) {
                  this.selectedItineraryIds.add(firstSelectedId);
                }
                this.selectedPreviewFitLocked = false;
              }
              if (this.selectedItineraryIds.size > 0) {
                this.renderSelectedItineraryPreviewIfNeeded(!this.selectedPreviewFitLocked);
              } else if (this.routeSlug) {
                this.renderRouteItinerarySelectionPreview(true);
              } else {
                this.renderVisibleItinerariesPreview(this.displayedItineraries, true);
              }
              return {
                items,
                routes,
                groups: this.groupItineraries(items),
                count: itineraries.length,
                error: ''
              };
            }),
            map(state => {
              this.scheduleHighlight(highlightedItineraryId || this.pendingHighlightItineraryId, state.items);
              this.scheduleScrollToItinerary(this.pendingScrollItineraryId, state.items);
              return state;
            })
          );
        }),
        catchError(error => {
          this.currentItineraries = [];
          this.displayedItineraries = [];
          this.itineraryTotalCount = 0;
          return of({
            items: [] as Itinerary[],
            routes: [] as Route[],
            groups: [] as ItineraryGroup[],
            count: 0,
            error: `Could not load itineraries. ${error.message}`
          });
        }),
        finalize(() => {
          this.loadingItineraries = false;
        })
      );
    }),
    startWith({ items: [] as Itinerary[], routes: [] as Route[], groups: [] as ItineraryGroup[], count: 0, error: '' })
  );

  ngAfterViewInit(): void {
    this.initializePreviewMap();
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    if (this.previewMap) {
      this.previewMap.remove();
      this.previewMap = null;
    }
  }

  selectPreviewItinerary(itinerary: Itinerary): void {
    if (this.highlightedItineraryId !== itinerary.id) {
      this.highlightedItineraryId = null;
    }
    this.selectedItineraryIds.clear();
    this.selectedItineraryIds.add(itinerary.id);
    this.selectedPreviewFitLocked = false;
    this.previewItinerary = itinerary;
    this.renderSelectedItineraryPreviewIfNeeded(true);
  }

  toggleItineraryRowPreview(itinerary: Itinerary): void {
    this.freezeListUpdatesWithCurrentList();
    if (this.previewItinerary?.id === itinerary.id) {
      this.clearItineraryPreview(true);
      return;
    }
    this.selectPreviewItinerary(itinerary);
  }

  openRouteMediaDialog(): void {
    if (!this.currentRoute || this.currentRoute.enabled) return;
    this.mediaManagerDialog?.open('route', this.currentRoute);
  }

  openSelectedItineraryMediaDialog(itinerary: Itinerary): void {
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be edited.', true);
      return;
    }
    this.mediaManagerDialog?.open('itinerary', itinerary);
  }

  async setCurrentRouteState(enabled: boolean): Promise<void> {
    if (!this.currentRoute || this.currentRoute.enabled === enabled) return;
    if (!this.confirmRouteStateChange(this.currentRoute, enabled)) return;

    try {
      const route = await firstValueFrom(this.api.updateRoute(this.currentRoute.id, { enabled }));
      this.currentRoute = route;
      this.currentRouteIsDraft = !route.enabled;
      this.clearStatus();
      this.refreshList();
    } catch (error) {
      this.showStatus(`Could not update route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  refreshList(): void {
    this.refresh$.next(this.refresh$.value + 1);
  }

  setListUpdatesWithMapView(enabled: boolean): void {
    if (this.listUpdatesWithMapView === enabled) return;
    this.listUpdatesWithMapView = enabled;
    if (!this.routeSlug) {
      if (enabled) {
        this.selectedItineraryIds.clear();
        this.selectedPreviewFitLocked = false;
        this.previewItinerary = null;
        this.displayedItineraries = this.visibleItinerariesForCurrentMap(this.currentItineraries);
        this.pruneSelectedItineraries(this.displayedItineraries);
        this.renderVisibleItinerariesPreview(this.displayedItineraries, true);
        this.changeDetector.detectChanges();
      } else {
        this.changeDetector.detectChanges();
      }
    }
  }

  private freezeListUpdatesWithCurrentList(): void {
    if (this.routeSlug || !this.listUpdatesWithMapView) return;
    this.listUpdatesWithMapView = false;
    this.changeDetector.detectChanges();
  }

  clearItineraryPreview(shouldFit = true): void {
    this.highlightedItineraryId = null;
    this.selectedItineraryIds.clear();
    this.selectedPreviewFitLocked = false;
    this.previewItinerary = null;
    if (this.routeSlug) {
      this.renderRouteItinerarySelectionPreview(shouldFit);
    } else {
      this.renderVisibleItinerariesPreview(this.displayedItineraries);
    }
  }

  previewLabel(): string {
    if (this.previewItinerary) return this.previewItinerary.title || 'Untitled itinerary';
    return 'All itineraries';
  }

  fitPreviewToCurrentItineraries(): void {
    if (!this.routeSlug && !this.listUpdatesWithMapView) {
      this.clearItineraryPreview(true);
    } else if (this.previewItinerary) {
      this.renderSelectedItineraryPreviewIfNeeded(true);
    } else if (this.routeSlug) {
      this.renderRouteItinerarySelectionPreview(true);
    } else {
      this.renderVisibleItinerariesPreview(this.displayedItineraries);
    }
  }

  toggleItinerarySort(key: Exclude<ItinerarySortKey, 'stage'>): void {
    if (this.itinerarySortKey === key) {
      this.itinerarySortDirection = this.itinerarySortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.itinerarySortKey = key;
      this.itinerarySortDirection = 'asc';
    }
    this.refresh$.next(this.refresh$.value + 1);
  }

  itinerarySortIndicator(key: Exclude<ItinerarySortKey, 'stage'>): string {
    if (this.itinerarySortKey !== key) return '';
    return this.itinerarySortDirection === 'asc' ? '▲' : '▼';
  }

  selectItineraryFromPreviewMarker(itinerary: Itinerary): void {
    this.selectPreviewItinerary(itinerary);
    this.highlightedItineraryId = itinerary.id;
    window.setTimeout(() => {
      document.getElementById(this.itineraryRowId(itinerary))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
    window.setTimeout(() => {
      if (this.highlightedItineraryId === itinerary.id) {
        this.highlightedItineraryId = null;
      }
    }, 2500);
  }

  openItineraryInEditor(itinerary: Itinerary): void {
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be edited.', true);
      return;
    }
    this.openUrlTreeInNewTab(this.router.createUrlTree(['/itineraries', itinerary.id, 'edit']));
  }

  openItineraryFromDoubleClick(itinerary: Itinerary): void {
    if (itinerary.enabled) {
      this.openUrlTreeInNewTab(this.router.createUrlTree(['/itineraries', itinerary.id, 'pois']));
      return;
    }
    this.openItineraryInEditor(itinerary);
  }

  openNewItineraryDialog(): void {
    this.newItineraryDialog?.nativeElement.showModal();
  }

  openNewItineraryForCurrentRoute(): void {
    if (this.currentRouteId === null) return;
    if (!this.currentRouteIsDraft) {
      this.showStatus('New stages can only be added to draft routes.', true);
      return;
    }
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
      if (routeId !== null && this.routeForId(routeId)?.enabled) {
        this.showStatus('New itineraries can only be assigned to draft routes.', true);
        return;
      }
      const stageNumber = routeId === null ? null : await this.nextStageNumberForRoute(routeId);
      const itinerary = await firstValueFrom(this.api.createItinerary({
        enabled: false,
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
      this.newItinerary = { language_code: 'en', title: '', description: '', routeId: null, stageNumber: null };
      this.closeNewItineraryDialog();
      this.showStatus(`Created itinerary "${itinerary.title || title}".`, false);
      this.pendingHighlightItineraryId = itinerary.id;
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not create itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openAddExistingItinerariesDialog(): void {
    if (!this.currentRouteCanBeEdited()) return;
    this.addItinerarySearch = '';
    this.addItinerarySelectedIds.clear();
    this.addItineraryInsert = this.defaultRouteInsertDraft();
    this.addExistingItinerariesDialog?.nativeElement.showModal();
    void this.loadAddItineraryCandidates();
  }

  closeAddExistingItinerariesDialog(): void {
    this.addExistingItinerariesDialog?.nativeElement.close();
  }

  async loadAddItineraryCandidates(): Promise<void> {
    if (!this.currentRouteCanBeEdited()) return;
    this.addItineraryLoading = true;
    try {
      const existingIds = new Set(this.currentItineraries.map(itinerary => itinerary.id));
      const itineraries = await firstValueFrom(this.api.listAllItineraries(this.addItinerarySearch, ''));
      this.addItineraryCandidates = this.sortedItineraries(itineraries.filter(itinerary => !existingIds.has(itinerary.id)));
      const candidateIds = new Set(this.addItineraryCandidates.map(itinerary => itinerary.id));
      [...this.addItinerarySelectedIds].forEach(id => {
        if (!candidateIds.has(id)) this.addItinerarySelectedIds.delete(id);
      });
    } catch (error) {
      this.showStatus(`Could not load itineraries. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.addItineraryLoading = false;
    }
  }

  toggleAddItinerarySelection(itineraryId: number, selected: boolean): void {
    if (selected) {
      this.addItinerarySelectedIds.add(itineraryId);
    } else {
      this.addItinerarySelectedIds.delete(itineraryId);
    }
  }

  async saveAddExistingItinerariesDialog(): Promise<void> {
    const itineraryIds = [...this.addItinerarySelectedIds];
    if (itineraryIds.length === 0) return;
    if (await this.insertItinerariesIntoCurrentRoute(itineraryIds, this.addItineraryInsert)) {
      this.closeAddExistingItinerariesDialog();
    }
  }

  openImportItinerariesDialog(): void {
    if (!this.currentRouteCanBeEdited()) return;
    this.importRouteSources = [
      { id: 'unassigned', title: 'Unassigned itineraries' },
      ...this.availableRoutes
        .filter(route => route.id !== this.currentRouteId)
        .map(route => ({ id: route.id, title: route.title || `Route ${route.id}` }))
    ];
    this.importSelectedSourceId = this.importRouteSources[0]?.id || null;
    this.importItinerarySelectedIds.clear();
    this.importItineraryInsert = this.defaultRouteInsertDraft();
    this.importItinerariesDialog?.nativeElement.showModal();
    if (this.importSelectedSourceId !== null) {
      void this.selectImportRouteSource(this.importSelectedSourceId);
    }
  }

  closeImportItinerariesDialog(): void {
    this.importItinerariesDialog?.nativeElement.close();
  }

  async selectImportRouteSource(sourceId: number | 'unassigned'): Promise<void> {
    if (!this.currentRouteCanBeEdited()) return;
    this.importSelectedSourceId = sourceId;
    this.importItinerarySelectedIds.clear();
    this.importItineraryLoading = true;
    try {
      const route = sourceId === 'unassigned' ? 'null' : sourceId;
      const existingIds = new Set(this.currentItineraries.map(itinerary => itinerary.id));
      const itineraries = await firstValueFrom(this.api.listAllItineraries('', '', route));
      this.importItineraries = this.routeStageOrderFor(itineraries.filter(itinerary => !existingIds.has(itinerary.id)));
    } catch (error) {
      this.showStatus(`Could not load route itineraries. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.importItineraryLoading = false;
    }
  }

  toggleImportItinerarySelection(itineraryId: number, selected: boolean): void {
    if (selected) {
      this.importItinerarySelectedIds.add(itineraryId);
    } else {
      this.importItinerarySelectedIds.delete(itineraryId);
    }
  }

  async saveImportItinerariesDialog(): Promise<void> {
    const itineraryIds = [...this.importItinerarySelectedIds];
    if (itineraryIds.length === 0) return;
    if (await this.insertItinerariesIntoCurrentRoute(itineraryIds, this.importItineraryInsert)) {
      this.closeImportItinerariesDialog();
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
        enabled: false,
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
      this.selectedItineraryIds.clear();
      this.selectedItineraryIds.add(duplicate.id);
      this.previewItinerary = duplicate;
      this.pendingHighlightItineraryId = duplicate.id;
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
    if (!this.confirmItineraryDraftChange([itinerary], enabled)) return;
    try {
      await firstValueFrom(this.api.updateItinerary(itinerary.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deleteItinerary(itinerary: Itinerary): Promise<void> {
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be deleted.', true);
      return;
    }
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
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be edited.', true);
      return;
    }
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

  openRouteInclusionDialog(): void {
    const targets = this.routeInclusionTargets();
    if (targets.length === 0) return;
    if (targets.some(itinerary => itinerary.enabled)) {
      this.showStatus('Route inclusions can only be managed for draft itineraries.', true);
      return;
    }
    this.routeInclusionOverrides.clear();
    this.routeInclusionDialog?.nativeElement.showModal();
  }

  closeRouteInclusionDialog(): void {
    this.routeInclusionDialog?.nativeElement.close();
    this.routeInclusionOverrides.clear();
  }

  routeInclusionTargets(): Itinerary[] {
    const selected = this.selectedItineraries();
    if (selected.length > 0) return selected;
    return this.previewItinerary ? [this.previewItinerary] : [];
  }

  routeInclusionCount(routeId: number): number {
    const targets = this.routeInclusionTargets();
    return targets.filter(itinerary =>
      this.routeMembershipsFor(itinerary).some(membership => membership.route === routeId)
    ).length;
  }

  routeInclusionCheckboxState(routeId: number): 'all' | 'some' | 'none' {
    const override = this.routeInclusionOverrides.get(routeId);
    if (override !== undefined) return override ? 'all' : 'none';

    const total = this.routeInclusionTargets().length;
    const count = this.routeInclusionCount(routeId);
    if (count === 0 || total === 0) return 'none';
    if (count === total) return 'all';
    return 'some';
  }

  setRouteInclusionOverride(routeId: number, included: boolean): void {
    const total = this.routeInclusionTargets().length;
    const currentCount = this.routeInclusionCount(routeId);
    const matchesCurrentState = included ? currentCount === total : currentCount === 0;
    if (matchesCurrentState) {
      this.routeInclusionOverrides.delete(routeId);
    } else {
      this.routeInclusionOverrides.set(routeId, included);
    }
  }

  async saveRouteInclusionDialog(): Promise<void> {
    const targets = this.routeInclusionTargets();
    const overrides = [...this.routeInclusionOverrides.entries()];
    if (targets.length === 0 || overrides.length === 0) return;
    if (overrides.some(([routeId]) => this.routeForId(routeId)?.enabled)) {
      this.showStatus('Public route memberships cannot be edited.', true);
      return;
    }

    targets.forEach(itinerary => this.assigningIds.add(itinerary.id));
    this.clearStatus();
    try {
      const requests: Array<Promise<unknown>> = [];
      for (const [routeId, shouldInclude] of overrides) {
        if (shouldInclude) {
          const itineraryIdsToAdd = targets
            .filter(itinerary => !this.routeMembershipsFor(itinerary).some(membership => membership.route === routeId))
            .map(itinerary => itinerary.id);
          if (itineraryIdsToAdd.length > 0) {
            requests.push(firstValueFrom(this.api.addItinerariesToRoute(routeId, itineraryIdsToAdd)));
          }
        } else {
          for (const itinerary of targets) {
            if (this.routeMembershipsFor(itinerary).some(membership => membership.route === routeId)) {
              requests.push(firstValueFrom(this.api.removeItineraryFromRoute(routeId, itinerary.id)));
            }
          }
        }
      }
      await Promise.all(requests);
      this.closeRouteInclusionDialog();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save route inclusions. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      targets.forEach(itinerary => this.assigningIds.delete(itinerary.id));
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
    if (routeId !== null && this.routeForId(routeId)?.enabled) {
      this.showStatus('Itineraries can only be assigned to draft routes.', true);
      return;
    }
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = routeId;
    draft.stageNumber = null;
  }

  async unassignItinerary(itinerary: Itinerary): Promise<void> {
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be edited.', true);
      return;
    }
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = null;
    draft.stageNumber = null;
    await this.saveAssignment(itinerary);
  }

  async saveAssignment(itinerary: Itinerary): Promise<void> {
    if (itinerary.enabled) {
      this.showStatus('Public itineraries cannot be edited.', true);
      return;
    }
    const draft = this.assignmentDraftFor(itinerary);
    if (draft.routeId === itinerary.route) return;
    if (draft.routeId !== null && this.routeForId(draft.routeId)?.enabled) {
      this.showStatus('Itineraries can only be assigned to draft routes.', true);
      draft.routeId = itinerary.route;
      draft.stageNumber = itinerary.stage_number;
      return;
    }
    if (itinerary.route !== null && this.routeForId(itinerary.route)?.enabled) {
      this.showStatus('Public route memberships cannot be edited.', true);
      draft.routeId = itinerary.route;
      draft.stageNumber = itinerary.stage_number;
      return;
    }

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
    if (!this.routeSlug || this.currentRouteId === null || !this.currentRouteIsDraft) return;
    this.draggedItineraryId = itinerary.id;
  }

  allowStageDrop(event: DragEvent): void {
    if (this.draggedItineraryId === null || this.reorderingStages || !this.currentRouteIsDraft) return;
    event.preventDefault();
  }

  async dropStage(targetItinerary: Itinerary, visibleItineraries: Itinerary[]): Promise<void> {
    if (this.draggedItineraryId === null || this.currentRouteId === null || this.reorderingStages || !this.currentRouteIsDraft) return;
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

  routeMembershipQueryParams(
    _membership: ItineraryRouteMembership,
    itinerary: Itinerary
  ): { highlight: string } {
    return {
      highlight: String(itinerary.id)
    };
  }

  private openUrlTreeInNewTab(urlTree: UrlTree): void {
    window.open(this.router.serializeUrl(urlTree), '_blank', 'noopener');
  }

  private currentInstruction(): string {
    if (!this.routeSlug) {
      return 'Browse saved itinerary definitions and open the editor.';
    }
    return this.currentRouteIsDraft
      ? 'Browse the constituent itineraries of this route. Drag rows up or down to define their order.'
      : 'Browse the constituent itineraries of this public route.';
  }

  private currentPageTitle(routeSlug: string | null, route: Route | null): string {
    if (!routeSlug) {
      return 'SW Itineraries';
    }
    return `SW R ${this.titlePart(route?.title || routeSlug)}`;
  }

  private titlePart(value: string): string {
    return value.trim().replace(/\s+/g, ' ') || 'Untitled';
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
    this.previewMap.on('moveend zoomend', () => this.updateDisplayedItinerariesFromPreviewMap());
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
    const result = this.drawItineraryPreview(this.previewItinerary, PREVIEW_COLORS[0]);
    this.fitPreviewMap(result.bounds);

    if (!result.bounds.isValid() && result.routeGeometryCount === 0) {
      this.previewMessage = 'This itinerary does not store coordinates yet.';
    } else if (!result.hasPointCoordinates) {
      this.previewMessage = 'Previewing saved route geometry. Point coordinates are not stored.';
    } else if (result.straightSegmentCount > 0 && result.routeGeometryCount > 0) {
      this.previewMessage = 'Straight segments do not have saved walking routes yet.';
    } else if (result.straightSegmentCount > 0) {
      this.previewMessage = 'Previewing straight lines for segments without walking routes.';
    } else {
      this.previewMessage = '';
    }
  }

  private renderSelectedItineraryPreviewIfNeeded(shouldFit = true): void {
    if (this.selectedItineraryIds.size === 0) return;
    const selected = this.selectedItineraries();
    if (selected.length === 0) {
      this.selectedItineraryIds.clear();
      this.selectedPreviewFitLocked = false;
      this.previewItinerary = null;
      if (this.routeSlug) {
        this.renderRouteItinerarySelectionPreview(true);
      } else {
        this.renderVisibleItinerariesPreview(this.currentItineraries);
      }
      return;
    }
    this.previewItinerary = selected.length === 1 ? selected[0] : null;
    this.renderPreviewItineraries(selected, shouldFit, 'selected itinerary', undefined, {
      showMarkers: Boolean(this.routeSlug),
      markerClickFor: this.routeSlug ? itinerary => this.selectItineraryFromPreviewMarker(itinerary) : undefined
    });
  }

  private renderVisibleItinerariesPreview(itineraries: Itinerary[], shouldFit = true): void {
    this.previewItinerary = null;
    if (itineraries.length === 0) {
      this.previewLayer?.clearLayers();
      this.previewMessage = 'No itineraries found.';
      if (shouldFit) {
        this.fitPreviewMapToWorld();
      }
      return;
    }
    this.renderPreviewItineraries(itineraries, shouldFit, 'visible itineraries');
  }

  private renderRouteItinerarySelectionPreview(shouldFit = true): void {
    if (this.currentItineraries.length === 0) {
      this.previewLayer?.clearLayers();
      this.previewMessage = 'No itineraries found.';
      this.fitPreviewMapToWorld();
      return;
    }
    this.previewItinerary = null;
    this.renderPreviewItineraries(
      this.currentItineraries,
      shouldFit,
      'visible itineraries',
      undefined,
      {
        showMarkers: true,
        markerClickFor: itinerary => this.selectItineraryFromPreviewMarker(itinerary)
      }
    );
  }

  private renderPreviewItineraries(
    itineraries: Itinerary[],
    shouldFit = true,
    scopeLabel = 'selected itinerary',
    lineStyleFor?: (itinerary: Itinerary, index: number) => PreviewLineStyle,
    options: PreviewRenderOptions = {}
  ): void {
    this.initializePreviewMap();
    if (!this.previewMap || !this.previewLayer) return;

    this.previewLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    const fitBounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;
    let hasPointCoordinates = false;

    itineraries.forEach((itinerary, index) => {
      const result = this.drawItineraryPreview(
        itinerary,
        PREVIEW_COLORS[index % PREVIEW_COLORS.length],
        lineStyleFor?.(itinerary, index),
        options.showMarkers ? index + 1 : null,
        options.markerClickFor ? () => options.markerClickFor?.(itinerary) : undefined
      );
      if (result.bounds.isValid()) bounds.extend(result.bounds);
      if (result.bounds.isValid() && (!options.fitItineraryIds || options.fitItineraryIds.has(itinerary.id))) {
        fitBounds.extend(result.bounds);
      }
      routeGeometryCount += result.routeGeometryCount;
      straightSegmentCount += result.straightSegmentCount;
      hasPointCoordinates ||= result.hasPointCoordinates;
    });

    if (shouldFit) {
      this.fitPreviewMap(fitBounds.isValid() ? fitBounds : bounds);
    } else {
      this.previewMap.invalidateSize(false);
    }
    if (!bounds.isValid() && routeGeometryCount === 0) {
      this.previewMessage = `The ${scopeLabel} do not store coordinates yet.`;
    } else if (!hasPointCoordinates) {
      this.previewMessage = 'Previewing saved route geometry. Point coordinates are not stored.';
    } else if (straightSegmentCount > 0 && routeGeometryCount > 0) {
      this.previewMessage = 'Straight segments do not have saved walking routes yet.';
    } else if (straightSegmentCount > 0) {
      this.previewMessage = 'Previewing straight lines for segments without walking routes.';
    } else {
      this.previewMessage = '';
    }
  }

  private drawItineraryPreview(
    itinerary: Itinerary,
    color: string,
    lineStyle: PreviewLineStyle = { weight: 5, opacity: 0.8 },
    markerNumber: number | null = null,
    markerClick?: () => void
  ): { bounds: any; routeGeometryCount: number; straightSegmentCount: number; hasPointCoordinates: boolean } {
    const json = this.itineraryJson(itinerary);
    const pointCoordinates = this.previewPointCoordinatesByIndex(json.points || []);
    const segments = json.segments || [];
    const bounds = L.latLngBounds([]);
    let routeGeometryCount = 0;
    let straightSegmentCount = 0;
    const hasPointCoordinates = pointCoordinates.some(point => point !== null);

    const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));
    const markerCoordinate = markerNumber === null ? null : this.itineraryPreviewMidpoint(pointCoordinates, segments);
    if (markerCoordinate && markerNumber !== null) {
      const marker = L.marker([markerCoordinate.lat, markerCoordinate.lng], {
        icon: this.previewMarkerIcon(markerNumber)
      }).addTo(this.previewLayer);
      if (markerClick) {
        marker.on('click', markerClick);
      }
    }

    for (let index = 0; index < segmentCount; index += 1) {
      const geometry = segments[index]?.selectedWalkingRoute?.geometry;
      if (geometry) {
        const routeLayer = L.geoJSON(geometry, {
          style: {
            color,
            weight: lineStyle.weight,
            opacity: lineStyle.opacity,
            dashArray: lineStyle.dashArray || undefined
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
          color,
          weight: lineStyle.weight,
          opacity: lineStyle.opacity,
          dashArray: lineStyle.dashArray || undefined
        }).addTo(this.previewLayer);
        bounds.extend(line.getBounds());
        straightSegmentCount += 1;
      }
    }

    return { bounds, routeGeometryCount, straightSegmentCount, hasPointCoordinates };
  }

  private previewMarkerIcon(markerNumber: number): any {
    return L.divIcon({
      className: 'preview-marker',
      html: `<span>${markerNumber}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  private itineraryPreviewMidpoint(
    pointCoordinates: Array<{ lat: number; lng: number; label: string } | null>,
    segments: SegmentExport[]
  ): { lat: number; lng: number } | null {
    const pathCoordinates: Array<{ lat: number; lng: number }> = [];
    const segmentCount = Math.max(0, Math.max(pointCoordinates.length - 1, segments.length));

    for (let index = 0; index < segmentCount; index += 1) {
      const geometryCoordinates: Array<{ lat: number; lng: number }> = [];
      this.collectGeometryCoordinates(segments[index]?.selectedWalkingRoute?.geometry, geometryCoordinates);
      if (geometryCoordinates.length > 0) {
        this.appendPathCoordinates(pathCoordinates, geometryCoordinates);
        continue;
      }

      const start = pointCoordinates[index];
      const end = pointCoordinates[index + 1];
      if (start && end) {
        this.appendPathCoordinates(pathCoordinates, [start, end]);
      }
    }

    if (pathCoordinates.length === 0) {
      return pointCoordinates.find(point => point !== null) || null;
    }
    if (pathCoordinates.length === 1) return pathCoordinates[0];

    const totalDistance = pathCoordinates
      .slice(1)
      .reduce((total, coordinate, index) => total + this.coordinateDistance(pathCoordinates[index], coordinate), 0);
    if (totalDistance <= 0) return pathCoordinates[Math.floor(pathCoordinates.length / 2)];

    const targetDistance = totalDistance / 2;
    let accumulatedDistance = 0;
    for (let index = 1; index < pathCoordinates.length; index += 1) {
      const start = pathCoordinates[index - 1];
      const end = pathCoordinates[index];
      const segmentDistance = this.coordinateDistance(start, end);
      if (accumulatedDistance + segmentDistance >= targetDistance) {
        const ratio = segmentDistance > 0 ? (targetDistance - accumulatedDistance) / segmentDistance : 0;
        return {
          lat: start.lat + (end.lat - start.lat) * ratio,
          lng: start.lng + (end.lng - start.lng) * ratio
        };
      }
      accumulatedDistance += segmentDistance;
    }
    return pathCoordinates[pathCoordinates.length - 1];
  }

  private appendPathCoordinates(
    target: Array<{ lat: number; lng: number }>,
    coordinates: Array<{ lat: number; lng: number }>
  ): void {
    for (const coordinate of coordinates) {
      const previous = target[target.length - 1];
      if (previous && previous.lat === coordinate.lat && previous.lng === coordinate.lng) continue;
      target.push({ lat: coordinate.lat, lng: coordinate.lng });
    }
  }

  private coordinateDistance(start: { lat: number; lng: number }, end: { lat: number; lng: number }): number {
    const radiusMeters = 6371000;
    const startLat = this.degreesToRadians(start.lat);
    const endLat = this.degreesToRadians(end.lat);
    const deltaLat = this.degreesToRadians(end.lat - start.lat);
    const deltaLng = this.degreesToRadians(end.lng - start.lng);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
    return 2 * radiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private degreesToRadians(value: number): number {
    return value * Math.PI / 180;
  }

  private selectedItineraries(): Itinerary[] {
    return this.currentItineraries.filter(itinerary => this.selectedItineraryIds.has(itinerary.id));
  }

  private scheduleDisplayedItinerariesUpdate(): void {
    const requestId = ++this.displayedItinerariesUpdateRequestId;
    window.requestAnimationFrame(() => {
      if (requestId !== this.displayedItinerariesUpdateRequestId) return;
      this.updateDisplayedItinerariesFromPreviewMap();
    });
  }

  private updateDisplayedItinerariesFromPreviewMap(): void {
    if (this.routeSlug || !this.listUpdatesWithMapView) return;
    this.displayedItineraries = this.visibleItinerariesForCurrentMap(this.currentItineraries);
    this.pruneSelectedItineraries(this.displayedItineraries);
    if (!this.previewItinerary) {
      this.renderVisibleItinerariesPreview(this.displayedItineraries, false);
    }
    this.changeDetector.detectChanges();
  }

  private displayedItinerariesForCurrentMode(itineraries: Itinerary[]): Itinerary[] {
    if (this.routeSlug || !this.listUpdatesWithMapView) return itineraries;
    return this.visibleItinerariesForCurrentMap(itineraries);
  }

  private visibleItinerariesForCurrentMap(itineraries: Itinerary[]): Itinerary[] {
    const bounds = this.currentPreviewBounds();
    if (!bounds) return itineraries;
    return itineraries.filter(itinerary => this.itineraryIntersectsBounds(itinerary, bounds));
  }

  private currentPreviewBounds(): ViewportBounds | null {
    if (!this.previewMap) return null;
    const bounds = this.previewMap.getBounds();
    if (!bounds?.isValid?.()) return null;
    return {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };
  }

  private itineraryIntersectsBounds(itinerary: Itinerary, bounds: ViewportBounds): boolean {
    const coordinates = this.itineraryCoordinates(itinerary);
    if (coordinates.length === 0) return true;
    if (coordinates.some(coordinate => this.coordinateInsideBounds(coordinate, bounds))) return true;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      if (this.segmentBoundsOverlap(coordinates[index], coordinates[index + 1], bounds)) return true;
    }
    return false;
  }

  private itineraryCoordinates(itinerary: Itinerary): Array<{ lat: number; lng: number }> {
    const json = this.itineraryJson(itinerary);
    const coordinates: Array<{ lat: number; lng: number }> = [];
    for (const point of json.points || []) {
      const lat = point.coordinates?.lat ?? point.lat;
      const lng = point.coordinates?.lng ?? point.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coordinates.push({ lat: Number(lat), lng: Number(lng) });
      }
    }
    for (const segment of json.segments || []) {
      this.collectGeometryCoordinates(segment.selectedWalkingRoute?.geometry, coordinates);
    }
    return coordinates;
  }

  private collectGeometryCoordinates(geometry: unknown, coordinates: Array<{ lat: number; lng: number }>): void {
    if (!geometry || typeof geometry !== 'object') return;
    const candidate = geometry as { coordinates?: unknown };
    this.collectCoordinatePairs(candidate.coordinates, coordinates);
  }

  private collectCoordinatePairs(value: unknown, coordinates: Array<{ lat: number; lng: number }>): void {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      coordinates.push({ lng: Number(value[0]), lat: Number(value[1]) });
      return;
    }
    value.forEach(child => this.collectCoordinatePairs(child, coordinates));
  }

  private coordinateInsideBounds(coordinate: { lat: number; lng: number }, bounds: ViewportBounds): boolean {
    return (
      coordinate.lat >= bounds.south &&
      coordinate.lat <= bounds.north &&
      coordinate.lng >= bounds.west &&
      coordinate.lng <= bounds.east
    );
  }

  private segmentBoundsOverlap(
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    bounds: ViewportBounds
  ): boolean {
    const south = Math.min(start.lat, end.lat);
    const north = Math.max(start.lat, end.lat);
    const west = Math.min(start.lng, end.lng);
    const east = Math.max(start.lng, end.lng);
    return south <= bounds.north && north >= bounds.south && west <= bounds.east && east >= bounds.west;
  }

  private pruneSelectedItineraries(items: Itinerary[]): void {
    const visibleIds = new Set(items.map(item => item.id));
    [...this.selectedItineraryIds].forEach(id => {
      if (!visibleIds.has(id)) this.selectedItineraryIds.delete(id);
    });
    if (this.selectedItineraryIds.size === 0) {
      this.selectedPreviewFitLocked = false;
      this.previewItinerary = null;
    } else {
      this.previewItinerary = this.selectedItineraryIds.size === 1 ? this.selectedItineraries()[0] || null : null;
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

  private fitPreviewMap(bounds: any): void {
    const requestId = ++this.previewFitRequestId;
    window.requestAnimationFrame(() => {
      if (!this.previewMap || requestId !== this.previewFitRequestId) return;
      this.previewMap.invalidateSize(false);
      if (bounds.isValid()) {
        this.previewMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 15, animate: false });
      } else {
        this.previewMap.fitWorld({ animate: false });
      }
      window.requestAnimationFrame(() => {
        if (requestId === this.previewFitRequestId) {
          this.previewMap?.invalidateSize(false);
          this.scheduleDisplayedItinerariesUpdate();
        }
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
        if (requestId === this.previewFitRequestId) {
          this.previewMap?.invalidateSize(false);
          this.scheduleDisplayedItinerariesUpdate();
        }
      });
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
    const totalMeters = this.itineraryLengthMeters(itinerary);

    if (totalMeters <= 0) return 'Not estimated';
    if (totalMeters >= 1000) return `~${(totalMeters / 1000).toFixed(1)} km`;
    return `~${Math.round(totalMeters)} m`;
  }

  private itineraryLengthMeters(itinerary: Itinerary): number {
    const segments = this.itineraryJson(itinerary).segments || [];
    return segments.reduce((total, segment) => {
      const distance = segment.selectedWalkingRoute?.distanceMeters;
      return Number.isFinite(distance) ? total + Number(distance) : total;
    }, 0);
  }

  routeMembershipsFor(itinerary: Itinerary): ItineraryRouteMembership[] {
    if (itinerary.route_memberships?.length) return itinerary.route_memberships;
    if (itinerary.route === null || itinerary.stage_number === null) return [];
    return [{
      route: itinerary.route,
      route_title: itinerary.route_title,
      route_slug: itinerary.route_slug,
      stage_number: itinerary.stage_number
    }];
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
    this.openUrlTreeInNewTab(this.router.createUrlTree(['/itineraries'], {
      queryParams: { highlight: itineraryId }
    }));
  }

  groupKey(group: ItineraryGroup): string {
    return group.routeId === null ? 'unassigned' : String(group.routeId);
  }

  isGroupCollapsed(group: ItineraryGroup): boolean {
    return this.collapsedGroupKeys.has(this.groupKey(group));
  }

  toggleGroup(group: ItineraryGroup): void {
    const key = this.groupKey(group);
    if (this.collapsedGroupKeys.has(key)) {
      this.collapsedGroupKeys.delete(key);
    } else {
      this.collapsedGroupKeys.add(key);
    }
  }

  groupsFor(itineraries: Itinerary[]): ItineraryGroup[] {
    const groups = this.groupItineraries(itineraries);
    this.collapseNewGroupsByDefault(groups);
    return groups;
  }

  private collapseNewGroupsByDefault(groups: ItineraryGroup[]): void {
    groups.forEach(group => {
      const key = this.groupKey(group);
      if (this.initializedCollapsedGroupKeys.has(key)) return;
      this.initializedCollapsedGroupKeys.add(key);
      this.collapsedGroupKeys.add(key);
    });
  }

  routeStageOrder(): Itinerary[] {
    return this.routeStageOrderFor(this.currentItineraries);
  }

  private resolveRoute(routeSlug: string | null) {
    if (!routeSlug) return of(null);
    return this.api.listAllRoutes('').pipe(
      map(routes => routes.find(route => route.slug === routeSlug || String(route.id) === routeSlug) || null)
    );
  }

  private routeNameForId(routeId: number | null): string {
    if (routeId === null) return 'No route';
    const route = this.routeForId(routeId);
    return route?.title || `Route ${routeId}`;
  }

  private routeForId(routeId: number): Route | undefined {
    return this.availableRoutes.find(candidate => candidate.id === routeId);
  }

  private currentRouteCanBeEdited(): boolean {
    if (!this.routeSlug || this.currentRouteId === null) {
      this.showStatus('Choose a route before adding itineraries.', true);
      return false;
    }
    if (!this.currentRouteIsDraft) {
      this.showStatus('Only draft routes can be modified.', true);
      return false;
    }
    return true;
  }

  private defaultRouteInsertDraft(): RouteInsertDraft {
    return {
      mode: 'end',
      anchorItineraryId: this.routeStageOrder()[0]?.id || null
    };
  }

  private async insertItinerariesIntoCurrentRoute(
    itineraryIds: number[],
    insertDraft: RouteInsertDraft
  ): Promise<boolean> {
    if (!this.currentRouteCanBeEdited() || this.currentRouteId === null) return false;

    const currentIds = this.routeStageOrder().map(itinerary => itinerary.id);
    const currentIdSet = new Set(currentIds);
    const insertedIds = itineraryIds.filter((id, index) => itineraryIds.indexOf(id) === index && !currentIdSet.has(id));
    if (insertedIds.length === 0) {
      this.showStatus('The selected itineraries are already included in this route.', true);
      return false;
    }

    try {
      await firstValueFrom(this.api.addItinerariesToRoute(this.currentRouteId, insertedIds));
      const nextOrder = this.insertIdsIntoRouteOrder(currentIds, insertedIds, insertDraft);
      await firstValueFrom(this.api.reorderRouteItineraries(
        this.currentRouteId,
        nextOrder.map((id, index) => ({
          id,
          stage_number: index + 1
        }))
      ));
      this.selectedItineraryIds.clear();
      if (insertedIds[0]) {
        this.selectedItineraryIds.add(insertedIds[0]);
      }
      this.selectedPreviewFitLocked = false;
      this.previewItinerary = null;
      this.pendingScrollItineraryId = insertedIds[0] || null;
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
      return true;
    } catch (error) {
      this.showStatus(`Could not add itineraries to route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
      return false;
    }
  }

  private insertIdsIntoRouteOrder(currentIds: number[], insertedIds: number[], insertDraft: RouteInsertDraft): number[] {
    const nextOrder = currentIds.filter(id => !insertedIds.includes(id));
    let insertIndex = nextOrder.length;

    if (insertDraft.mode === 'beginning') {
      insertIndex = 0;
    } else if (insertDraft.mode === 'before' || insertDraft.mode === 'after') {
      const anchorIndex = nextOrder.indexOf(insertDraft.anchorItineraryId || -1);
      if (anchorIndex >= 0) {
        insertIndex = insertDraft.mode === 'before' ? anchorIndex : anchorIndex + 1;
      }
    }

    nextOrder.splice(insertIndex, 0, ...insertedIds);
    return nextOrder;
  }

  private routeStageOrderFor(itineraries: Itinerary[]): Itinerary[] {
    return [...itineraries].sort((left, right) => {
      const leftStage = left.stage_number ?? Number.MAX_SAFE_INTEGER;
      const rightStage = right.stage_number ?? Number.MAX_SAFE_INTEGER;
      return leftStage - rightStage || left.id - right.id;
    });
  }

  private confirmItineraryDraftChange(itineraries: Itinerary[], enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    const itemLabel = itineraries.length === 1 ? 'itinerary' : 'itineraries';
    let message = `Really ${action} ${itineraries.length} selected ${itemLabel}?`;
    if (!enabled) {
      message += '\n\nRoutes containing the selected itinerary/itineraries can also be turned to draft.';
    } else {
      message += '\n\nDraft POIs included in the selected itinerary/itineraries can also be made public.';
    }
    return window.confirm(message);
  }

  private confirmRouteStateChange(route: Route, enabled: boolean): boolean {
    const action = enabled ? 'make public' : 'turn to draft';
    let message = `Really ${action} route "${route.title || 'Untitled route'}"?`;
    if (enabled) {
      message += '\n\nDraft itineraries in this route, and draft POIs included in those itineraries, can also be made public.';
    } else {
      message += '\n\nOnly draft routes can have their media edited.';
    }
    return window.confirm(message);
  }

  private scheduleHighlight(itineraryId: number | null, itineraries: Itinerary[]): void {
    const itinerary = itineraries.find(candidate => candidate.id === itineraryId);
    if (!itineraryId || !itinerary) return;

    this.highlightedItineraryId = itineraryId;
    this.pendingHighlightItineraryId = null;
    if (!this.routeSlug) {
      this.selectedItineraryIds.clear();
      this.selectedPreviewFitLocked = false;
      this.previewItinerary = null;
      this.displayedItineraries = this.displayedItinerariesForCurrentMode(itineraries);
      this.renderVisibleItinerariesPreview(this.displayedItineraries, false);
    } else if (this.previewItinerary?.id !== itineraryId) {
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

  private scheduleScrollToItinerary(itineraryId: number | null, itineraries: Itinerary[]): void {
    if (!itineraryId || !itineraries.some(candidate => candidate.id === itineraryId)) return;

    this.pendingScrollItineraryId = null;
    window.setTimeout(() => {
      document.getElementById(`itinerary-row-${itineraryId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 80);
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

    const duplicatedTranslations = translations
      .filter(translation => translation.language_code)
      .map(translation => ({
        language_code: translation.language_code,
        title: this.translationTitle(translation, itinerary),
        description: translation.description || '',
        is_reference: Boolean(translation.is_reference)
      }));

    if (duplicatedTranslations.length === 0) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: itinerary.description || '',
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

  hasMissingPaths(itinerary: Itinerary): boolean {
    const itineraryJson = this.itineraryJson(itinerary);
    const points = Array.isArray(itineraryJson.points) ? itineraryJson.points : [];
    if (points.length < 2) return false;
    const segments = Array.isArray(itineraryJson.segments) ? itineraryJson.segments : [];
    for (let index = 0; index < points.length - 1; index += 1) {
      if (!segments[index]?.selectedWalkingRoute?.geometry) {
        return true;
      }
    }
    return false;
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
    const direction = this.itinerarySortDirection === 'asc' ? 1 : -1;
    return [...itineraries].sort((left, right) => {
      let comparison = 0;
      if (this.itinerarySortKey === 'title') {
        comparison = (left.title || '').localeCompare(right.title || '');
      } else if (this.itinerarySortKey === 'length') {
        comparison = this.itineraryLengthMeters(left) - this.itineraryLengthMeters(right);
      } else if (this.itinerarySortKey === 'missingPaths') {
        comparison = Number(this.hasMissingPaths(left)) - Number(this.hasMissingPaths(right));
      } else if (this.itinerarySortKey === 'draft') {
        comparison = Number(left.enabled) - Number(right.enabled);
      } else {
        const leftStage = left.stage_number ?? Number.MAX_SAFE_INTEGER;
        const rightStage = right.stage_number ?? Number.MAX_SAFE_INTEGER;
        comparison = leftStage - rightStage;
      }
      return comparison * direction || left.id - right.id;
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
