import { Component, EventEmitter, Output } from '@angular/core';
import { SearchType } from './itinerary-editor.types';

@Component({
  selector: 'app-itinerary-editor-sidebar',
  standalone: true,
  styles: [':host { display: contents; }'],
  templateUrl: './itinerary-editor-sidebar.component.html'
})
export class ItineraryEditorSidebarComponent {
  @Output() readonly tabSelected = new EventEmitter<SearchType>();
  @Output() readonly searchInput = new EventEmitter<SearchType>();
  @Output() readonly searchKeydown = new EventEmitter<{ type: SearchType; event: KeyboardEvent }>();
  @Output() readonly poiSearchRefresh = new EventEmitter<void>();
  @Output() readonly searchResultsClick = new EventEmitter<{ type: SearchType; event: MouseEvent }>();
  @Output() readonly pointListKeydown = new EventEmitter<KeyboardEvent>();
  @Output() readonly pointListClick = new EventEmitter<MouseEvent>();
  @Output() readonly pointListInput = new EventEmitter<Event>();
  @Output() readonly pointListChange = new EventEmitter<Event>();
  @Output() readonly pointListFocusout = new EventEmitter<FocusEvent>();
  @Output() readonly pointListPointerdown = new EventEmitter<PointerEvent>();
  @Output() readonly pointListPointerup = new EventEmitter<void>();
  @Output() readonly pointListDragstart = new EventEmitter<DragEvent>();
  @Output() readonly pointListDragover = new EventEmitter<DragEvent>();
  @Output() readonly pointListDragleave = new EventEmitter<DragEvent>();
  @Output() readonly pointListDrop = new EventEmitter<DragEvent>();
  @Output() readonly pointListDragend = new EventEmitter<void>();
  @Output() readonly clearAll = new EventEmitter<void>();
  @Output() readonly fitRoute = new EventEmitter<void>();
  @Output() readonly showRouteSummary = new EventEmitter<void>();

  confirmClearAll(): void {
    if (window.confirm('Clear all points from this itinerary?')) {
      this.clearAll.emit();
    }
  }
}
