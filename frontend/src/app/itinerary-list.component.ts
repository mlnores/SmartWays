import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary, Route, Translation } from './api.service';

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
  title: string;
  description: string;
  enabled: boolean;
  routeId: number | null;
  stageNumber: number | null;
}

interface PointExport {
  type?: string;
  id?: number;
  name?: string;
  title?: string;
  label?: string;
  coordinates?: {
    lat?: number;
    lng?: number;
  };
}

interface SegmentExport {
  selectedWalkingRoute?: {
    distanceMeters?: number;
  } | null;
}

interface ItineraryJsonExport {
  points?: PointExport[];
  segments?: SegmentExport[];
}

@Component({
  selector: 'app-itinerary-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, NgTemplateOutlet, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>{{ routeSlug ? routeTitle || 'Route itineraries' : 'Itineraries' }}</h1>
          <p>{{ routeSlug ? 'Browse the constituent itineraries of this route.' : 'Browse saved itinerary definitions and open the editor.' }}</p>
        </div>
        @if (!routeSlug) {
          <button type="button" class="primary icon-action" title="New itinerary" aria-label="New itinerary" (click)="openNewItineraryDialog()">+</button>
        } @else {
          <button type="button" class="primary icon-action" title="New itinerary for this route" aria-label="New itinerary for this route" (click)="openNewItineraryForCurrentRoute()">+</button>
        }
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title, description, or slug"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
        @if (!routeSlug) {
          <div class="view-toggle" aria-label="Itinerary display mode">
            <button type="button" [class.active]="viewMode === 'flat'" (click)="viewMode = 'flat'">Plain list</button>
            <button type="button" [class.active]="viewMode === 'grouped'" (click)="viewMode = 'grouped'">Grouped by route</button>
          </div>
        }
      </div>
      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          @if (routeSlug || viewMode === 'flat') {
            <ng-container *ngTemplateOutlet="itineraryTable; context: { items: state.items, routes: state.routes }"></ng-container>
          } @else {
            <div class="route-group-list">
              @for (group of groupsFor(state.items); track groupKey(group)) {
                <section class="route-group">
                  <header class="route-group-header">
                    <h2>{{ group.title }}</h2>
                  </header>
                  <div class="table-wrap">
                    <table class="resource-table">
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>Title</th>
                          <th>First point</th>
                          <th>Last point</th>
                          <th>Estimated distance</th>
                          <th class="enabled-column">Enabled</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (itinerary of group.items; track itinerary.id) {
                          <tr [attr.id]="itineraryRowId(itinerary)" [class.highlight-row]="highlightedItineraryId === itinerary.id">
                            <td>{{ itinerary.stage_number || '-' }}</td>
                            <td>
                              {{ itinerary.title || 'Untitled itinerary' }}
                              <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                            </td>
                            <td>{{ firstPointName(itinerary) }}</td>
                            <td>{{ lastPointName(itinerary) }}</td>
                            <td>{{ estimatedDistance(itinerary) }}</td>
                            <td class="enabled-column">
                              <input
                                class="enabled-checkbox"
                                type="checkbox"
                                title="Enable"
                                aria-label="Enable"
                                [checked]="itinerary.enabled"
                                (change)="setItineraryEnabled(itinerary, $any($event.target).checked)"
                              />
                            </td>
                            <td>
                              <div class="table-actions">
                                <button type="button" class="secondary icon-action double-icon-action" title="Edit metadata and translations" aria-label="Edit metadata and translations" (click)="openTranslationDialog(itinerary)">✎▤</button>
                                <a class="secondary icon-action double-icon-action" title="Open in editor" aria-label="Open in editor" [routerLink]="['/itineraries', itinerary.id, 'edit']">✎⌖</a>
                                <button type="button" class="secondary icon-action" [title]="duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate'" [attr.aria-label]="duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate'" [disabled]="duplicatingIds.has(itinerary.id)" (click)="duplicateItinerary(itinerary)">
                                  ⧉
                                </button>
                                @if (itinerary.route !== null) {
                                  <button type="button" class="secondary icon-action" [title]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Remove from route'" [attr.aria-label]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Remove from route'" [disabled]="assigningIds.has(itinerary.id)" (click)="unassignItinerary(itinerary)">⊘</button>
                                }
                                <button type="button" class="secondary icon-action danger-action" title="Delete" aria-label="Delete" (click)="deleteItinerary(itinerary)">⌫</button>
                              </div>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              } @empty {
                <p class="empty">No itineraries found.</p>
              }
            </div>
          }
        }
      }

      <ng-template #itineraryTable let-items="items" let-routes="routes">
        <div class="table-wrap">
          <table class="resource-table">
            <thead>
              <tr>
                @if (!routeSlug) {
                  <th>Route</th>
                } @else {
                  <th class="drag-handle-column" aria-label="Reorder"></th>
                  <th>Stage</th>
                }
                <th>Title</th>
                <th>First point</th>
                <th>Last point</th>
                <th>Estimated distance</th>
                <th class="enabled-column">Enabled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (itinerary of items; track itinerary.id) {
                <tr
                  [attr.id]="itineraryRowId(itinerary)"
                  [class.highlight-row]="highlightedItineraryId === itinerary.id"
                  [class.dragging-row]="draggedItineraryId === itinerary.id"
                  [attr.draggable]="routeSlug ? true : null"
                  (dragstart)="startStageDrag(itinerary)"
                  (dragover)="allowStageDrop($event)"
                  (drop)="dropStage(itinerary, items)"
                  (dragend)="endStageDrag()"
                >
                  @if (!routeSlug) {
                    <td>
                      <div class="route-assignment-cell">
                        <select [ngModel]="assignmentDraftFor(itinerary).routeId" (ngModelChange)="setAssignmentRoute(itinerary, $event)">
                          <option [ngValue]="null">No route</option>
                          @for (route of routes; track route.id) {
                            <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                          }
                        </select>
                        <button type="button" class="secondary icon-action" [title]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign'" [attr.aria-label]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign'" [disabled]="assigningIds.has(itinerary.id)" (click)="saveAssignment(itinerary)">
                          ✓
                        </button>
                      </div>
                    </td>
                  } @else {
                    <td class="drag-handle-cell" aria-label="Drag to reorder stage">
                      <span class="drag-handle" aria-hidden="true">☰</span>
                    </td>
                    <td>{{ itinerary.stage_number || '-' }}</td>
                  }
                  <td>
                    {{ itinerary.title || 'Untitled itinerary' }}
                    <p class="description-preview">{{ itinerary.description || 'No description' }}</p>
                  </td>
                  <td>{{ firstPointName(itinerary) }}</td>
                  <td>{{ lastPointName(itinerary) }}</td>
                  <td>{{ estimatedDistance(itinerary) }}</td>
                  <td class="enabled-column">
                    <input
                      class="enabled-checkbox"
                      type="checkbox"
                      title="Enable"
                      aria-label="Enable"
                      [checked]="itinerary.enabled"
                      (change)="setItineraryEnabled(itinerary, $any($event.target).checked)"
                    />
                  </td>
                  <td>
                    <div class="table-actions">
                      <button type="button" class="secondary icon-action double-icon-action" title="Edit metadata and translations" aria-label="Edit metadata and translations" (click)="openTranslationDialog(itinerary)">✎▤</button>
                      <a class="secondary icon-action double-icon-action" title="Open in editor" aria-label="Open in editor" [routerLink]="['/itineraries', itinerary.id, 'edit']">✎⌖</a>
                      <button type="button" class="secondary icon-action" [title]="duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate'" [attr.aria-label]="duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate'" [disabled]="duplicatingIds.has(itinerary.id)" (click)="duplicateItinerary(itinerary)">
                        ⧉
                      </button>
                      @if (routeSlug && itinerary.route !== null) {
                        <button type="button" class="secondary icon-action" [title]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Remove from route'" [attr.aria-label]="assigningIds.has(itinerary.id) ? 'Saving...' : 'Remove from route'" [disabled]="assigningIds.has(itinerary.id)" (click)="unassignItinerary(itinerary)">⊘</button>
                      }
                      <button type="button" class="secondary icon-action danger-action" title="Delete" aria-label="Delete" (click)="deleteItinerary(itinerary)">⌫</button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="routeSlug ? 8 : 7">No itineraries found.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template>

      <dialog class="metadata-dialog" #newItineraryDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); createItinerary()">
          <header class="metadata-dialog-header">
            <h2>New itinerary</h2>
            <button type="button" class="icon-button" aria-label="Close new itinerary dialog" (click)="closeNewItineraryDialog()">x</button>
          </header>
          <div class="form-stack">
            <label>
              <span>Title</span>
              <input type="text" [(ngModel)]="newItinerary.title" name="newItineraryTitle" placeholder="Itinerary title" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="newItinerary.description" name="newItineraryDescription" placeholder="Optional description"></textarea>
            </label>
            <label class="checkbox-inline">
              <input type="checkbox" [(ngModel)]="newItinerary.enabled" name="newItineraryEnabled" />
              <span>Enabled</span>
            </label>
            <label>
              <span>Route</span>
              <select [ngModel]="newItinerary.routeId" (ngModelChange)="setNewItineraryRoute($event)" name="newItineraryRoute">
                <option [ngValue]="null">No route</option>
                @for (route of availableRoutes; track route.id) {
                  <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
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
            <button type="button" class="icon-button" aria-label="Close duplicate confirmation dialog" (click)="closeDuplicateDialog()">x</button>
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

      <dialog class="metadata-dialog wide" #translationDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveTranslationDialog()">
          <header class="metadata-dialog-header">
            <h2>Edit itinerary translations</h2>
            <button type="button" class="icon-button" aria-label="Close translation dialog" (click)="closeTranslationDialog()">x</button>
          </header>
          <div class="translation-list">
            @for (translation of translationDrafts; track $index) {
              <div class="translation-row">
                <label class="reference-radio">
                  <span>Reference</span>
                  <input
                    type="radio"
                    name="itineraryReferenceTranslation"
                    [checked]="translation.is_reference"
                    (change)="setReferenceTranslation($index)"
                  />
                </label>
                <label>
                  <span>Language</span>
                  <input type="text" [(ngModel)]="translation.language_code" [name]="'itineraryLanguage' + $index" />
                </label>
                <label>
                  <span>Title</span>
                  <input type="text" [(ngModel)]="translation.title" [name]="'itineraryTitle' + $index" />
                </label>
                <label>
                  <span>Description</span>
                  <textarea rows="3" [(ngModel)]="translation.description" [name]="'itineraryDescription' + $index"></textarea>
                </label>
              </div>
            }
            <button type="button" class="secondary" (click)="addTranslationDraft()">Add translation</button>
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
export class ItineraryListComponent {
  @ViewChild('newItineraryDialog') private readonly newItineraryDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('duplicateDialog') private readonly duplicateDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  routeSlug: string | null = null;
  routeTitle: string | null = null;
  currentRouteId: number | null = null;
  viewMode: 'flat' | 'grouped' = 'flat';
  statusMessage = '';
  statusIsError = false;
  availableRoutes: Route[] = [];
  newItinerary: NewItineraryDraft = { title: '', description: '', enabled: true, routeId: null, stageNumber: null };
  duplicatedItinerary: Itinerary | null = null;
  highlightedItineraryId: number | null = null;
  pendingHighlightItineraryId: number | null = null;
  currentItineraries: Itinerary[] = [];
  editingItinerary: Itinerary | null = null;
  translationDrafts: TranslationDraft[] = [];
  readonly duplicatingIds = new Set<number>();
  readonly assigningIds = new Set<number>();
  readonly assignmentDrafts = new Map<number, AssignmentDraft>();
  draggedItineraryId: number | null = null;
  reorderingStages = false;

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('slug'))),
    this.activatedRoute.queryParamMap.pipe(map(params => Number(params.get('highlight')) || null))
  ]).pipe(
    switchMap(([query, , routeSlug, highlightedItineraryId]) => {
      this.routeSlug = routeSlug;
      return combineLatest([
        this.api.listAllRoutes(''),
        this.resolveRoute(routeSlug)
      ]).pipe(
        switchMap(([routes, selectedRoute]) => {
          this.availableRoutes = routes;
          this.currentRouteId = selectedRoute?.id || null;
          this.routeTitle = selectedRoute?.title || null;
          if (routeSlug && !selectedRoute) {
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
              const items = this.sortedItineraries(itineraries);
              this.currentItineraries = items;
              return {
                items,
                routes,
                groups: this.groupItineraries(itineraries),
                count: itineraries.length,
                error: ''
              };
            }),
            map(state => {
              this.scheduleHighlight(highlightedItineraryId || this.pendingHighlightItineraryId, state.items);
              return state;
            })
          );
        }),
        catchError(error => of({
          items: [] as Itinerary[],
          routes: [] as Route[],
          groups: [] as ItineraryGroup[],
          count: 0,
          error: `Could not load itineraries. ${error.message}`
        }))
      );
    }),
    startWith({ items: [] as Itinerary[], routes: [] as Route[], groups: [] as ItineraryGroup[], count: 0, error: '' })
  );

  openNewItineraryDialog(): void {
    this.newItineraryDialog?.nativeElement.showModal();
  }

  openNewItineraryForCurrentRoute(): void {
    if (this.currentRouteId === null) return;
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
    if (!title) {
      this.showStatus('Enter an itinerary title before creating it.', true);
      return;
    }

    try {
      const routeId = this.newItinerary.routeId;
      const stageNumber = routeId === null ? null : await this.nextStageNumberForRoute(routeId);
      const itinerary = await firstValueFrom(this.api.createItinerary({
        enabled: this.newItinerary.enabled,
        route: routeId,
        stage_number: stageNumber,
        itinerary_json: { points: [], segments: [] },
        translations: [{
          language_code: 'en',
          title,
          description: this.newItinerary.description.trim(),
          is_reference: true
        }]
      }));
      this.newItinerary = { title: '', description: '', enabled: true, routeId: null, stageNumber: null };
      this.closeNewItineraryDialog();
      this.showStatus(`Created itinerary "${itinerary.title || title}".`, false);
      this.pendingHighlightItineraryId = itinerary.id;
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not create itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
        enabled: itinerary.enabled,
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
    try {
      await firstValueFrom(this.api.updateItinerary(itinerary.id, { enabled }));
      this.clearStatus();
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async deleteItinerary(itinerary: Itinerary): Promise<void> {
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
    this.editingItinerary = itinerary;
    this.translationDrafts = this.translationDraftsFrom(itinerary.translations, itinerary.title, itinerary.description);
    this.translationDialog?.nativeElement.showModal();
  }

  closeTranslationDialog(): void {
    this.translationDialog?.nativeElement.close();
    this.editingItinerary = null;
    this.translationDrafts = [];
  }

  addTranslationDraft(): void {
    this.translationDrafts.push({
      language_code: '',
      title: '',
      description: '',
      is_reference: this.translationDrafts.length === 0
    });
  }

  setReferenceTranslation(index: number): void {
    this.translationDrafts = this.translationDrafts.map((translation, currentIndex) => ({
      ...translation,
      is_reference: currentIndex === index
    }));
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
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = routeId;
    draft.stageNumber = null;
  }

  async unassignItinerary(itinerary: Itinerary): Promise<void> {
    const draft = this.assignmentDraftFor(itinerary);
    draft.routeId = null;
    draft.stageNumber = null;
    await this.saveAssignment(itinerary);
  }

  async saveAssignment(itinerary: Itinerary): Promise<void> {
    const draft = this.assignmentDraftFor(itinerary);
    if (draft.routeId === itinerary.route) return;

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
    if (!this.routeSlug || this.currentRouteId === null) return;
    this.draggedItineraryId = itinerary.id;
  }

  allowStageDrop(event: DragEvent): void {
    if (this.draggedItineraryId === null || this.reorderingStages) return;
    event.preventDefault();
  }

  async dropStage(targetItinerary: Itinerary, visibleItineraries: Itinerary[]): Promise<void> {
    if (this.draggedItineraryId === null || this.currentRouteId === null || this.reorderingStages) return;
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

  firstPointName(itinerary: Itinerary): string {
    const points = this.itineraryJson(itinerary).points || [];
    return this.pointName(points[0]);
  }

  lastPointName(itinerary: Itinerary): string {
    const points = this.itineraryJson(itinerary).points || [];
    return this.pointName(points[points.length - 1]);
  }

  estimatedDistance(itinerary: Itinerary): string {
    const segments = this.itineraryJson(itinerary).segments || [];
    const totalMeters = segments.reduce((total, segment) => {
      const distance = segment.selectedWalkingRoute?.distanceMeters;
      return Number.isFinite(distance) ? total + Number(distance) : total;
    }, 0);

    if (totalMeters <= 0) return 'Not estimated';
    if (totalMeters >= 1000) return `${(totalMeters / 1000).toFixed(1)} km`;
    return `${Math.round(totalMeters)} m`;
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
    await this.router.navigate(['/itineraries'], {
      queryParams: { highlight: itineraryId }
    });
  }

  groupKey(group: ItineraryGroup): string {
    return group.routeId === null ? 'unassigned' : String(group.routeId);
  }

  groupsFor(itineraries: Itinerary[]): ItineraryGroup[] {
    return this.groupItineraries(itineraries);
  }

  private resolveRoute(routeSlug: string | null) {
    if (!routeSlug) return of(null);
    return this.api.listAllRoutes(routeSlug).pipe(
      map(routes => routes.find(route => route.slug === routeSlug || String(route.id) === routeSlug) || null)
    );
  }

  private routeNameForId(routeId: number | null): string {
    if (routeId === null) return 'No route';
    const route = this.availableRoutes.find(candidate => candidate.id === routeId);
    return route?.title || `Route ${routeId}`;
  }

  private scheduleHighlight(itineraryId: number | null, itineraries: Itinerary[]): void {
    if (!itineraryId || !itineraries.some(itinerary => itinerary.id === itineraryId)) return;

    this.highlightedItineraryId = itineraryId;
    this.pendingHighlightItineraryId = null;
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
    let hasEnglishTranslation = false;

    const duplicatedTranslations = translations
      .filter(translation => translation.language_code)
      .map(translation => {
        const languageCode = translation.language_code;
        const isEnglish = languageCode.toLowerCase() === 'en';
        hasEnglishTranslation = hasEnglishTranslation || isEnglish;
        return {
          language_code: languageCode,
          title: isEnglish ? title : this.translationTitle(translation, itinerary),
          description: translation.description || '',
          is_reference: Boolean(translation.is_reference)
        };
      });

    if (!hasEnglishTranslation) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: itinerary.description || '',
        is_reference: !duplicatedTranslations.some(translation => translation.is_reference)
      });
    }
    if (!duplicatedTranslations.some(translation => translation.is_reference) && duplicatedTranslations.length > 0) {
      duplicatedTranslations[0].is_reference = true;
    }

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

  private pointName(point: PointExport | undefined): string {
    if (!point) return '-';
    if (point.title?.trim()) return point.title.trim();
    if (point.name?.trim()) return point.name.trim();
    if (point.type === 'poi') return point.id ? `POI #${point.id}` : 'POI';
    if (point.label?.trim()) return point.label.trim();
    const lat = point.coordinates?.lat;
    const lng = point.coordinates?.lng;
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
    return [...itineraries].sort((left, right) => {
      const leftStage = left.stage_number ?? Number.MAX_SAFE_INTEGER;
      const rightStage = right.stage_number ?? Number.MAX_SAFE_INTEGER;
      return leftStage - rightStage || left.id - right.id;
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
