import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-itinerary-editor-dialogs',
  standalone: true,
  styles: [':host { display: contents; }'],
  templateUrl: './itinerary-editor-dialogs.component.html'
})
export class ItineraryEditorDialogsComponent {
  @Output() readonly closeRouteDialog = new EventEmitter<void>();
  @Output() readonly closePoiDetailDialog = new EventEmitter<void>();
  @Output() readonly poiDetailBodyClick = new EventEmitter<MouseEvent>();
  @Output() readonly addPoiFromDetail = new EventEmitter<void>();
}
