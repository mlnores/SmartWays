import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, debounceTime, map, of, startWith, switchMap } from 'rxjs';

import { ApiService, Itinerary } from './api.service';

@Component({
  selector: 'app-itinerary-list',
  standalone: true,
  imports: [AsyncPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Itineraries</h1>
          <p>Browse saved itinerary definitions and open the editor.</p>
        </div>
        <a class="primary" routerLink="/itineraries/new">New itinerary</a>
      </header>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title, description, or slug"
          [ngModel]="query"
          (ngModelChange)="query = $event; query$.next($event)"
        />
      </div>

      @if (state$ | async; as state) {
        @if (state.error) {
          <p class="status error">{{ state.error }}</p>
        } @else {
          <p class="status">{{ state.count }} itineraries</p>
          <div class="list">
            @for (itinerary of state.items; track itinerary.id) {
              <article class="list-item">
                <div>
                  <h2>{{ itinerary.title || 'Untitled itinerary' }}</h2>
                  <p class="muted">#{{ itinerary.id }} · {{ itinerary.slug || 'no slug' }} · updated {{ itinerary.updated_at | date:'medium' }}</p>
                  @if (itinerary.description) {
                    <p class="description">{{ itinerary.description }}</p>
                  }
                </div>
                <a [routerLink]="['/itineraries', itinerary.id, 'edit']">Edit</a>
              </article>
            } @empty {
              <p class="empty">No itineraries found.</p>
            }
          </div>
        }
      }
    </section>
  `,
  styleUrl: './resource-list.css'
})
export class ItineraryListComponent {
  private readonly api = inject(ApiService);
  readonly query$ = new BehaviorSubject('');
  query = '';

  readonly state$ = this.query$.pipe(
    debounceTime(250),
    switchMap(query => this.api.listItineraries(query).pipe(
      map(page => ({ items: page.results, count: page.count, error: '' })),
      catchError(error => of({ items: [] as Itinerary[], count: 0, error: `Could not load itineraries. ${error.message}` }))
    )),
    startWith({ items: [] as Itinerary[], count: 0, error: '' })
  );

}
