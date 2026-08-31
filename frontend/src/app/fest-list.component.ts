import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiPage, ApiService, Fest } from './api.service';
import { PageInstructionService } from './page-instruction.service';

@Component({
  selector: 'app-fest-list',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>Fests</h1>
        </div>
        <div class="list-actions">
          <a class="primary" routerLink="/fests/new">New fest</a>
        </div>
      </header>

      <section class="filters-panel">
        <label>
          <span>Search</span>
          <input type="search" [(ngModel)]="query" name="festSearch" (keyup.enter)="loadFests()" />
        </label>
        <label>
          <span>Status</span>
          <select [(ngModel)]="enabledFilter" name="festEnabledFilter">
            <option value="">All</option>
            <option value="false">Draft</option>
            <option value="true">Public</option>
          </select>
        </label>
        <label>
          <span>Year</span>
          <input type="number" min="1" max="9999" [(ngModel)]="yearFilter" name="festYearFilter" />
        </label>
        <label>
          <span>From</span>
          <input type="date" [(ngModel)]="dateFromFilter" name="festDateFromFilter" />
        </label>
        <label>
          <span>To</span>
          <input type="date" [(ngModel)]="dateToFilter" name="festDateToFilter" />
        </label>
        <button type="button" class="secondary" (click)="loadFests()" [disabled]="loading">Apply</button>
      </section>

      @if (statusMessage) {
        <p class="status" [class.error]="statusIsError">{{ statusMessage }}</p>
      }

      @if (loading) {
        <p class="status">Loading fests...</p>
      } @else {
        <div class="resource-table-wrapper">
          <table class="resource-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Country</th>
                <th>Dates</th>
                <th>Area</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (fest of fests; track fest.id) {
                <tr>
                  <td>
                    <strong>{{ fest.title || 'Untitled fest' }}</strong>
                    @if (fest.description) {
                      <span class="description-preview">{{ fest.description }}</span>
                    }
                  </td>
                  <td>{{ fest.enabled ? 'Public' : 'Draft' }}</td>
                  <td>{{ fest.country_code || 'Pending' }}</td>
                  <td>{{ festDatesLabel(fest) }}</td>
                  <td>{{ fest.footprint ? 'Defined' : 'No area' }}</td>
                  <td class="actions-cell">
                    <a class="secondary" [routerLink]="['/fests', fest.id, 'edit']">Edit</a>
                    <button type="button" class="secondary danger-action" [disabled]="fest.enabled" (click)="deleteFest(fest)">Delete</button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6">No fests found.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styleUrls: ['./resource-list.css']
})
export class FestListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly pageInstruction = inject(PageInstructionService);

  fests: Fest[] = [];
  loading = true;
  query = '';
  enabledFilter = '';
  yearFilter: number | null = null;
  dateFromFilter = '';
  dateToFilter = '';
  statusMessage = '';
  statusIsError = false;

  ngOnInit(): void {
    this.pageInstruction.setInstruction('Manage festival locations, areas, media, and celebration dates.');
    void this.loadFests();
  }

  async loadFests(): Promise<void> {
    this.loading = true;
    this.clearStatus();
    try {
      const enabled = this.enabledFilter === '' ? undefined : this.enabledFilter === 'true';
      const page = await firstValueFrom(this.api.listFests(
        this.query,
        '',
        enabled,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        this.yearFilter || undefined,
        this.dateFromFilter,
        this.dateToFilter
      ));
      this.applyPage(page);
    } catch (error) {
      this.showStatus(`Could not load fests. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.loading = false;
    }
  }

  async deleteFest(fest: Fest): Promise<void> {
    if (fest.enabled) return;
    if (!window.confirm(`Really delete "${fest.title || 'Untitled fest'}"?`)) return;
    try {
      await firstValueFrom(this.api.deleteFest(fest.id));
      this.fests = this.fests.filter(item => item.id !== fest.id);
      this.showStatus('Fest deleted.', false);
    } catch (error) {
      this.showStatus(`Could not delete fest. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    }
  }

  festDatesLabel(fest: Fest): string {
    const dates = (fest.editions || []).flatMap(edition => edition.dates || []).sort();
    if (dates.length === 0) return 'No dates';
    if (dates.length <= 3) return dates.join(', ');
    return `${dates.slice(0, 3).join(', ')} and ${dates.length - 3} more`;
  }

  private applyPage(page: ApiPage<Fest>): void {
    this.fests = page.results;
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
