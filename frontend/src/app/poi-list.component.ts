import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, catchError, debounceTime, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Poi } from './api.service';

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [AsyncPipe, FormsModule],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>POIs</h1>
          <p>Browse enabled points of interest from the backend API.</p>
        </div>
        <a class="primary" href="http://127.0.0.1:8000/admin/pois/poi/add/">Add POI</a>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title or category"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
      </div>

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <p class="status">{{ state.count }} POIs</p>
          <div class="list">
            @for (poi of state.items; track poi.id) {
              <article class="list-item">
                <div>
                  <h2>{{ poi.title || 'Untitled POI' }}</h2>
                  <p class="muted">#{{ poi.id }} · {{ poi.gps_latitude }}, {{ poi.gps_longitude }}</p>
                  @if (poi.categories.length) {
                    <p class="description">{{ categoryNames(poi) }}</p>
                  }
                </div>
                <a href="http://127.0.0.1:8000/admin/pois/poi/{{ poi.id }}/change/">Edit</a>
              </article>
            } @empty {
              <p class="empty">No POIs found.</p>
            }
          </div>
        }
      }
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class PoiListComponent {
  private readonly api = inject(ApiService);
  readonly query$ = new BehaviorSubject('');
  query = '';

  readonly state$ = this.query$.pipe(
    debounceTime(250),
    switchMap(query => this.api.listPois(query).pipe(
      map(page => ({ items: page.results, count: page.count, error: '' })),
      catchError(error => of({ items: [] as Poi[], count: 0, error: `Could not load POIs. ${error.message}` }))
    )),
    startWith({ items: [] as Poi[], count: 0, error: '' })
  );

  categoryNames(poi: Poi): string {
    return poi.categories
      .map(category => category.name || category.slug)
      .filter(Boolean)
      .join(', ');
  }
}
