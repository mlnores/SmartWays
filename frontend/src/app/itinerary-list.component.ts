import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
          <button type="button" class="primary" (click)="openNewItineraryDialog()">New itinerary</button>
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
          <p class="status">{{ state.count }} itineraries</p>
          @if (routeSlug || viewMode === 'flat') {
            <ng-container *ngTemplateOutlet="itineraryTable; context: { items: state.items, routes: state.routes, showAssignment: !routeSlug }"></ng-container>
          } @else {
            <div class="route-group-list">
              @for (group of groupsFor(state.items); track groupKey(group)) {
                <section class="route-group">
                  <header class="route-group-header">
                    <h2>{{ group.title }}</h2>
                    @if (group.slug) {
                      <p class="muted">{{ group.slug }}</p>
                    }
                  </header>
                  <div class="table-wrap">
                    <table class="resource-table">
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th>Title</th>
                          <th>Description</th>
                          <th>First point</th>
                          <th>Last point</th>
                          <th>Estimated distance</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (itinerary of group.items; track itinerary.id) {
                          <tr>
                            <td>{{ itinerary.stage_number || '-' }}</td>
                            <td>
                              {{ itinerary.title || 'Untitled itinerary' }}
                              <p class="muted">{{ itinerary.slug || 'no slug' }}</p>
                            </td>
                            <td>{{ itinerary.description || 'No description' }}</td>
                            <td>{{ firstPointName(itinerary) }}</td>
                            <td>{{ lastPointName(itinerary) }}</td>
                            <td>{{ estimatedDistance(itinerary) }}</td>
                            <td>
                              <div class="table-actions">
                                <button type="button" class="secondary" (click)="toggleItinerary(itinerary)">
                                  {{ itinerary.enabled ? 'Disable' : 'Enable' }}
                                </button>
                                <button type="button" class="secondary" (click)="openTranslationDialog(itinerary)">Edit translations</button>
                                <button type="button" class="secondary" [disabled]="duplicatingIds.has(itinerary.id)" (click)="duplicateItinerary(itinerary)">
                                  {{ duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate' }}
                                </button>
                                <a class="secondary" [routerLink]="['/itineraries', itinerary.id, 'edit']">Open editor</a>
                              </div>
                              <div class="assignment-row compact">
                                <label>
                                  <span>Route</span>
                                  <select [ngModel]="assignmentDraftFor(itinerary).routeId" (ngModelChange)="setAssignmentRoute(itinerary, $event)">
                                    <option [ngValue]="null">No route</option>
                                    @for (route of state.routes; track route.id) {
                                      <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                                    }
                                  </select>
                                </label>
                                <label>
                                  <span>Stage</span>
                                  <input type="number" min="1" step="1" [disabled]="assignmentDraftFor(itinerary).routeId === null" [ngModel]="assignmentDraftFor(itinerary).stageNumber" (ngModelChange)="setAssignmentStage(itinerary, $event)" />
                                </label>
                                <button type="button" class="secondary" [disabled]="assigningIds.has(itinerary.id)" (click)="saveAssignment(itinerary)">
                                  {{ assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign' }}
                                </button>
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

      <ng-template #itineraryTable let-items="items" let-routes="routes" let-showAssignment="showAssignment">
        <div class="table-wrap">
          <table class="resource-table">
            <thead>
              <tr>
                @if (!routeSlug) {
                  <th>Route</th>
                } @else {
                  <th>Stage</th>
                }
                <th>Title</th>
                <th>Description</th>
                <th>First point</th>
                <th>Last point</th>
                <th>Estimated distance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (itinerary of items; track itinerary.id) {
                <tr>
                  @if (!routeSlug) {
                    <td>
                      {{ itinerary.route_title || 'No route' }}
                      @if (itinerary.stage_number) {
                        <p class="muted">Stage {{ itinerary.stage_number }}</p>
                      }
                    </td>
                  } @else {
                    <td>{{ itinerary.stage_number || '-' }}</td>
                  }
                  <td>
                    {{ itinerary.title || 'Untitled itinerary' }}
                    <p class="muted">{{ itinerary.slug || 'no slug' }}</p>
                  </td>
                  <td>{{ itinerary.description || 'No description' }}</td>
                  <td>{{ firstPointName(itinerary) }}</td>
                  <td>{{ lastPointName(itinerary) }}</td>
                  <td>{{ estimatedDistance(itinerary) }}</td>
                  <td>
                    <div class="table-actions">
                      <button type="button" class="secondary" (click)="toggleItinerary(itinerary)">
                        {{ itinerary.enabled ? 'Disable' : 'Enable' }}
                      </button>
                      <button type="button" class="secondary" (click)="openTranslationDialog(itinerary)">Edit translations</button>
                      <button type="button" class="secondary" [disabled]="duplicatingIds.has(itinerary.id)" (click)="duplicateItinerary(itinerary)">
                        {{ duplicatingIds.has(itinerary.id) ? 'Duplicating...' : 'Duplicate' }}
                      </button>
                      <a class="secondary" [routerLink]="['/itineraries', itinerary.id, 'edit']">Open editor</a>
                    </div>
                    @if (showAssignment) {
                      <div class="assignment-row compact">
                        <label>
                          <span>Route</span>
                          <select [ngModel]="assignmentDraftFor(itinerary).routeId" (ngModelChange)="setAssignmentRoute(itinerary, $event)">
                            <option [ngValue]="null">No route</option>
                            @for (route of routes; track route.id) {
                              <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                            }
                          </select>
                        </label>
                        <label>
                          <span>Stage</span>
                          <input type="number" min="1" step="1" [disabled]="assignmentDraftFor(itinerary).routeId === null" [ngModel]="assignmentDraftFor(itinerary).stageNumber" (ngModelChange)="setAssignmentStage(itinerary, $event)" />
                        </label>
                        <button type="button" class="secondary" [disabled]="assigningIds.has(itinerary.id)" (click)="saveAssignment(itinerary)">
                          {{ assigningIds.has(itinerary.id) ? 'Saving...' : 'Assign' }}
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="routeSlug ? 7 : 7">No itineraries found.</td>
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
            <div class="form-grid two-column">
              <label>
                <span>Route</span>
                <select [ngModel]="newItinerary.routeId" (ngModelChange)="setNewItineraryRoute($event)" name="newItineraryRoute">
                  <option [ngValue]="null">No route</option>
                  @for (route of availableRoutes; track route.id) {
                    <option [ngValue]="route.id">{{ route.title || 'Route ' + route.id }}</option>
                  }
                </select>
              </label>
              <label>
                <span>Stage</span>
                <input type="number" min="1" step="1" [disabled]="newItinerary.routeId === null" [ngModel]="newItinerary.stageNumber" (ngModelChange)="setNewItineraryStage($event)" name="newItineraryStage" />
              </label>
            </div>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeNewItineraryDialog()">Cancel</button>
            <button type="submit" class="primary">Create itinerary</button>
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
            @for (translation of translationDrafts; track translation.language_code) {
              <div class="translation-row">
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
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;

  private readonly api = inject(ApiService);
  private readonly activatedRoute = inject(ActivatedRoute);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  routeSlug: string | null = null;
  routeTitle: string | null = null;
  viewMode: 'flat' | 'grouped' = 'flat';
  statusMessage = '';
  statusIsError = false;
  availableRoutes: Route[] = [];
  newItinerary: NewItineraryDraft = { title: '', description: '', enabled: true, routeId: null, stageNumber: null };
  editingItinerary: Itinerary | null = null;
  translationDrafts: TranslationDraft[] = [];
  readonly duplicatingIds = new Set<number>();
  readonly assigningIds = new Set<number>();
  readonly assignmentDrafts = new Map<number, AssignmentDraft>();

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$,
    this.activatedRoute.paramMap.pipe(map(params => params.get('slug')))
  ]).pipe(
    switchMap(([query, , routeSlug]) => {
      this.routeSlug = routeSlug;
      return combineLatest([
        this.api.listAllRoutes(''),
        this.resolveRoute(routeSlug)
      ]).pipe(
        switchMap(([routes, selectedRoute]) => {
          this.availableRoutes = routes;
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
          return this.api.listAllItineraries(query, 'en', selectedRoute?.id).pipe(
            map(itineraries => ({
              items: this.sortedItineraries(itineraries),
              routes,
              groups: this.groupItineraries(itineraries),
              count: itineraries.length,
              error: ''
            }))
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

  closeNewItineraryDialog(): void {
    this.newItineraryDialog?.nativeElement.close();
  }

  setNewItineraryRoute(routeId: number | null): void {
    this.newItinerary.routeId = routeId;
    if (routeId === null) {
      this.newItinerary.stageNumber = null;
    } else if (!this.newItinerary.stageNumber) {
      this.newItinerary.stageNumber = 1;
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
    if (this.newItinerary.routeId !== null && !this.newItinerary.stageNumber) {
      this.showStatus('Enter a stage number before assigning this itinerary to a route.', true);
      return;
    }

    try {
      const itinerary = await firstValueFrom(this.api.createItinerary({
        enabled: this.newItinerary.enabled,
        route: this.newItinerary.routeId,
        stage_number: this.newItinerary.routeId === null ? null : this.newItinerary.stageNumber,
        itinerary_json: { points: [], segments: [] },
        translations: [{
          language_code: 'en',
          title,
          description: this.newItinerary.description.trim()
        }]
      }));
      this.newItinerary = { title: '', description: '', enabled: true, routeId: null, stageNumber: null };
      this.closeNewItineraryDialog();
      this.showStatus(`Created itinerary "${itinerary.title || title}".`, false);
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
      this.showStatus(`Duplicated itinerary as "${duplicate.title || title}".`, false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not duplicate itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.duplicatingIds.delete(itinerary.id);
    }
  }

  async toggleItinerary(itinerary: Itinerary): Promise<void> {
    try {
      await firstValueFrom(this.api.updateItinerary(itinerary.id, { enabled: !itinerary.enabled }));
      this.showStatus(`Itinerary ${itinerary.enabled ? 'disabled' : 'enabled'}.`, false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
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
    this.translationDrafts.push({ language_code: '', title: '', description: '' });
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
    if (routeId === null) {
      draft.stageNumber = null;
    } else if (!draft.stageNumber) {
      draft.stageNumber = itinerary.stage_number || 1;
    }
  }

  setAssignmentStage(itinerary: Itinerary, stageNumber: string | number | null): void {
    const parsed = Number(stageNumber);
    this.assignmentDraftFor(itinerary).stageNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async saveAssignment(itinerary: Itinerary): Promise<void> {
    const draft = this.assignmentDraftFor(itinerary);
    if (draft.routeId !== null && !draft.stageNumber) {
      this.showStatus('Enter a stage number before assigning this itinerary to a route.', true);
      return;
    }

    this.assigningIds.add(itinerary.id);
    this.clearStatus();

    try {
      await firstValueFrom(this.api.updateItinerary(itinerary.id, {
        route: draft.routeId,
        stage_number: draft.routeId === null ? null : draft.stageNumber
      }));
      this.showStatus('Itinerary route assignment saved.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not assign itinerary. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.assigningIds.delete(itinerary.id);
    }
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

  private duplicateTranslations(itinerary: Itinerary, title: string): Array<{ language_code: string; title: string; description?: string }> {
    const translations = itinerary.translations.length > 0
      ? itinerary.translations
      : [{ language_code: 'en', title: itinerary.title || '', description: itinerary.description || '' }];
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
          description: translation.description || ''
        };
      });

    if (!hasEnglishTranslation) {
      duplicatedTranslations.unshift({
        language_code: 'en',
        title,
        description: itinerary.description || ''
      });
    }

    return duplicatedTranslations;
  }

  private translationTitle(translation: Translation, itinerary: Itinerary): string {
    return translation.title || itinerary.title || 'Untitled itinerary';
  }

  private translationDraftsFrom(translations: Translation[], title: string | null, description: string | null): TranslationDraft[] {
    if (translations.length === 0) {
      return [{ language_code: 'en', title: title || '', description: description || '' }];
    }
    return translations.map(translation => ({
      language_code: translation.language_code,
      title: translation.title || '',
      description: translation.description || ''
    }));
  }

  private normalizedTranslations(): TranslationDraft[] {
    return this.translationDrafts
      .map(translation => ({
        language_code: translation.language_code.trim(),
        title: translation.title.trim(),
        description: translation.description.trim()
      }))
      .filter(translation => translation.language_code || translation.title || translation.description);
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
