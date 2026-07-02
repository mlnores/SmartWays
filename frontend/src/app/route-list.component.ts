import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, debounceTime, firstValueFrom, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Route, Translation } from './api.service';

interface RouteDraft {
  title: string;
  description: string;
  enabled: boolean;
}

interface TranslationDraft {
  language_code: string;
  title: string;
  description: string;
}

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Routes</h1>
          <p>Browse multi-stage routes.</p>
        </div>
        <button type="button" class="primary" (click)="openNewRouteDialog()">New route</button>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search route title, description, or slug"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
      </div>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <p class="status">{{ state.routes.length }} routes</p>
          <div class="table-wrap">
            <table class="resource-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Last updated</th>
                  <th>Segments</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (route of state.routes; track route.id) {
                  <tr>
                    <td>
                      <a [routerLink]="['/route', route.slug || route.id]">{{ route.title || 'Untitled route' }}</a>
                      <p class="muted">{{ route.slug || 'no slug' }}</p>
                    </td>
                    <td>{{ route.description || 'No description' }}</td>
                    <td>{{ route.updated_at | date:'medium' }}</td>
                    <td>{{ route.itinerary_count }}</td>
                    <td>
                      <div class="table-actions">
                        <button type="button" class="secondary" (click)="toggleRoute(route)">
                          {{ route.enabled ? 'Disable' : 'Enable' }}
                        </button>
                        <button type="button" class="secondary" (click)="openTranslationDialog(route)">Edit translations</button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5">No routes found.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      <dialog class="metadata-dialog" #newRouteDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); createRoute()">
          <header class="metadata-dialog-header">
            <h2>New route</h2>
            <button type="button" class="icon-button" aria-label="Close new route dialog" (click)="closeNewRouteDialog()">x</button>
          </header>
          <div class="form-stack">
            <label>
              <span>Title</span>
              <input type="text" [(ngModel)]="newRoute.title" name="newRouteTitle" placeholder="Route title" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="newRoute.description" name="newRouteDescription" placeholder="Optional description"></textarea>
            </label>
            <label class="checkbox-inline">
              <input type="checkbox" [(ngModel)]="newRoute.enabled" name="newRouteEnabled" />
              <span>Enabled</span>
            </label>
          </div>
          <footer class="metadata-dialog-footer">
            <button type="button" class="secondary" (click)="closeNewRouteDialog()">Cancel</button>
            <button type="submit" class="primary">Create route</button>
          </footer>
        </form>
      </dialog>

      <dialog class="metadata-dialog wide" #translationDialog>
        <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault(); saveTranslationDialog()">
          <header class="metadata-dialog-header">
            <h2>Edit route translations</h2>
            <button type="button" class="icon-button" aria-label="Close translation dialog" (click)="closeTranslationDialog()">x</button>
          </header>
          <div class="translation-list">
            @for (translation of translationDrafts; track translation.language_code) {
              <div class="translation-row">
                <label>
                  <span>Language</span>
                  <input type="text" [(ngModel)]="translation.language_code" [name]="'routeLanguage' + $index" />
                </label>
                <label>
                  <span>Title</span>
                  <input type="text" [(ngModel)]="translation.title" [name]="'routeTitle' + $index" />
                </label>
                <label>
                  <span>Description</span>
                  <textarea rows="3" [(ngModel)]="translation.description" [name]="'routeDescription' + $index"></textarea>
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
export class RouteListComponent {
  @ViewChild('newRouteDialog') private readonly newRouteDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('translationDialog') private readonly translationDialog?: ElementRef<HTMLDialogElement>;

  private readonly api = inject(ApiService);
  readonly query$ = new BehaviorSubject('');
  readonly refresh$ = new BehaviorSubject(0);
  query = '';
  newRoute: RouteDraft = { title: '', description: '', enabled: true };
  statusMessage = '';
  statusIsError = false;
  editingRoute: Route | null = null;
  translationDrafts: TranslationDraft[] = [];

  readonly state$ = combineLatest([
    this.query$.pipe(debounceTime(250)),
    this.refresh$
  ]).pipe(
    switchMap(([query]) => this.api.listRoutes(query).pipe(
      map(routePage => ({
        routes: routePage.results,
        error: ''
      })),
      catchError(error => of({
        routes: [] as Route[],
        error: `Could not load routes. ${error.message}`
      }))
    )),
    startWith({ routes: [] as Route[], error: '' })
  );

  async createRoute(): Promise<void> {
    const title = this.newRoute.title.trim();
    if (!title) {
      this.showStatus('Enter a route title before creating it.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.createRoute({
        enabled: this.newRoute.enabled,
        translations: [{
          language_code: 'en',
          title,
          description: this.newRoute.description.trim()
        }]
      }));
      this.newRoute = { title: '', description: '', enabled: true };
      this.closeNewRouteDialog();
      this.showStatus('Route created.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not create route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  async toggleRoute(route: Route): Promise<void> {
    try {
      await firstValueFrom(this.api.updateRoute(route.id, { enabled: !route.enabled }));
      this.showStatus(`Route ${route.enabled ? 'disabled' : 'enabled'}.`, false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not update route. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  openNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.showModal();
  }

  closeNewRouteDialog(): void {
    this.newRouteDialog?.nativeElement.close();
  }

  openTranslationDialog(route: Route): void {
    this.editingRoute = route;
    this.translationDrafts = this.translationDraftsFrom(route.translations, route.title, route.description);
    this.translationDialog?.nativeElement.showModal();
  }

  closeTranslationDialog(): void {
    this.translationDialog?.nativeElement.close();
    this.editingRoute = null;
    this.translationDrafts = [];
  }

  addTranslationDraft(): void {
    this.translationDrafts.push({ language_code: '', title: '', description: '' });
  }

  async saveTranslationDialog(): Promise<void> {
    if (!this.editingRoute) return;

    const translations = this.normalizedTranslations();
    if (translations.length === 0 || translations.some(translation => !translation.language_code || !translation.title)) {
      this.showStatus('Every route translation needs a language and title.', true);
      return;
    }

    try {
      await firstValueFrom(this.api.updateRoute(this.editingRoute.id, {
        translations
      }));
      this.closeTranslationDialog();
      this.showStatus('Route translations saved.', false);
      this.refresh$.next(this.refresh$.value + 1);
    } catch (error) {
      this.showStatus(`Could not save translations. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
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

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }
}
