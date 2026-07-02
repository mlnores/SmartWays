import { Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-itinerary-editor-frame',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="editor-page">
      <header class="editor-header">
        <div>
          <h1>{{ itineraryId ? 'Edit itinerary #' + itineraryId : 'New itinerary' }}</h1>
          <p>The current editor is embedded during the Angular migration.</p>
        </div>
        <a routerLink="/itineraries">Back to itineraries</a>
      </header>
      <iframe [src]="editorUrl" title="Itinerary editor"></iframe>
    </section>
  `,
  styles: [`
    .editor-page {
      height: 100%;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      background: #f5f7fb;
    }

    .editor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid #d8dee8;
      background: #ffffff;
    }

    h1 {
      margin: 0;
      font-size: 1.15rem;
    }

    p {
      margin: 2px 0 0;
      color: #667085;
      font-size: 0.9rem;
    }

    a {
      color: #1f6feb;
      text-decoration: none;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #ffffff;
    }
  `]
})
export class ItineraryEditorFrameComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  readonly itineraryId = this.route.snapshot.paramMap.get('id');
  readonly editorUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    `/editor/interactive_itinerary_map.html${this.itineraryId ? `?itinerary=${this.itineraryId}` : ''}`
  );
}
