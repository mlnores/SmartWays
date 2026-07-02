import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-itinerary-editor-map',
  standalone: true,
  styles: [':host { display: contents; }'],
  templateUrl: './itinerary-editor-map.component.html'
})
export class ItineraryEditorMapComponent {
  @ViewChild('mapCanvas', { static: true }) readonly mapCanvas!: ElementRef<HTMLElement>;

  @Output() readonly mapCanvasClick = new EventEmitter<MouseEvent>();
  @Output() readonly togglePoiBrowser = new EventEmitter<void>();
  @Output() readonly poiBrowserFiltersChange = new EventEmitter<Event>();
  @Output() readonly poiBrowserListClick = new EventEmitter<MouseEvent>();
  @Output() readonly poiBrowserListMouseover = new EventEmitter<MouseEvent>();
  @Output() readonly poiBrowserListMouseout = new EventEmitter<MouseEvent>();
  @Output() readonly poiBrowserListFocusin = new EventEmitter<FocusEvent>();
  @Output() readonly poiBrowserListFocusout = new EventEmitter<FocusEvent>();
}
