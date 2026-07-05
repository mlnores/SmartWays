import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EditorApiService } from './editor-api.service';
import { ItineraryEditorDialogsComponent } from './itinerary-editor-dialogs.component';
import { ItineraryEditorMapComponent } from './itinerary-editor-map.component';
import { ItineraryEditorSidebarComponent } from './itinerary-editor-sidebar.component';
import { ItineraryEditorApi, ItineraryEditorRuntime, SearchType } from './itinerary-editor.types';

declare global {
  interface Window {
    initInteractiveItineraryEditor?: (options: {
      root: HTMLElement;
      itineraryId: string | null;
      api: ItineraryEditorApi;
    }) => ItineraryEditorRuntime;
  }
}

@Component({
  selector: 'app-itinerary-editor',
  standalone: true,
  imports: [
    ItineraryEditorDialogsComponent,
    ItineraryEditorMapComponent,
    ItineraryEditorSidebarComponent,
    RouterLink
  ],
  templateUrl: './itinerary-editor.component.html',
  styleUrl: './itinerary-editor.component.css',
  encapsulation: ViewEncapsulation.None
})
export class ItineraryEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorRoot', { static: true }) private readonly editorRoot!: ElementRef<HTMLElement>;
  @ViewChild(ItineraryEditorMapComponent, { static: true }) private readonly mapComponent!: ItineraryEditorMapComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly editorApi = inject(EditorApiService);
  private readonly requestedBackLink = this.route.snapshot.queryParamMap.get('returnTo');
  readonly backLink = this.router.parseUrl(this.requestedBackLink?.startsWith('/') ? this.requestedBackLink : '/itineraries');
  readonly backLabel = this.route.snapshot.queryParamMap.get('returnLabel') || 'Back to itineraries';
  private editor: ItineraryEditorRuntime | null = null;

  ngAfterViewInit(): void {
    if (!window.initInteractiveItineraryEditor) {
      throw new Error('Itinerary editor runtime did not load.');
    }

    this.editor = window.initInteractiveItineraryEditor({
      root: this.editorRoot.nativeElement,
      itineraryId: this.route.snapshot.paramMap.get('id'),
      api: {
        searchPlaces: (query, lat, lon) => this.editorApi.searchPlaces(query, lat, lon),
        reverseGeocode: (lat, lon) => this.editorApi.reverseGeocode(lat, lon),
        searchPois: request => this.editorApi.searchPois(request),
        getPoi: (poiId, language) => this.editorApi.getPoi(poiId, language),
        getItinerary: (itineraryId, language) => this.editorApi.getItinerary(itineraryId, language),
        saveItinerary: (itineraryId, payload) => this.editorApi.saveItinerary(itineraryId, payload),
        getWalkingRoutes: (coordinates, queryString) => this.editorApi.getWalkingRoutes(coordinates, queryString),
        findBufferPois: (buffer, segmentIndex, limit) => this.editorApi.findBufferPois(buffer, segmentIndex, limit)
      }
    });

    requestAnimationFrame(() => {
      this.mapComponent.mapCanvas.nativeElement.dispatchEvent(new Event('resize'));
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  clearAll(): void { this.editor?.clearAll(); }
  fitRoute(): void { this.editor?.fitRoute(); }
  showRouteSummary(): void { this.editor?.showRouteSummary(); }
  saveItinerary(): void { this.editor?.saveItinerary(); }
  saveItineraryToServer(): void { this.editor?.saveItineraryToServer(); }
  revertItinerary(): void { this.editor?.revertItinerary(); }
  undoItinerary(): void { this.editor?.undoItinerary(); }
  redoItinerary(): void { this.editor?.redoItinerary(); }
  closeRouteDialog(): void { this.editor?.closeRouteDialog(); }
  closeItineraryJsonDialog(): void { this.editor?.closeItineraryJsonDialog(); }
  closePoiDetailDialog(): void { this.editor?.closePoiDetailDialog(); }
  addPoiFromDetail(): void { this.editor?.addPoiFromDetail(); }
  activateTab(tabName: SearchType): void { this.editor?.activateTab(tabName); }
  handleSearchInput(type: SearchType): void { this.editor?.handleSearchInput(type); }
  handleSearchKeydown(type: SearchType, event: KeyboardEvent): void { this.editor?.handleSearchKeydown(type, event); }
  handleSearchResultsClick(type: SearchType, event: MouseEvent): void { this.editor?.handleSearchResultsClick(type, event); }
  refreshPoiSearchResults(): void { this.editor?.refreshPoiSearchResults(); }
  togglePoiBrowser(): void { this.editor?.togglePoiBrowser(); }
  handlePoiBrowserFiltersChange(event: Event): void { this.editor?.handlePoiBrowserFiltersChange(event); }
  handlePoiBrowserListClick(event: MouseEvent): void { this.editor?.handlePoiBrowserListClick(event); }
  handlePoiBrowserListMouseover(event: MouseEvent): void { this.editor?.handlePoiBrowserListMouseover(event); }
  handlePoiBrowserListMouseout(event: MouseEvent): void { this.editor?.handlePoiBrowserListMouseout(event); }
  handlePoiBrowserListFocusin(event: FocusEvent): void { this.editor?.handlePoiBrowserListFocusin(event); }
  handlePoiBrowserListFocusout(event: FocusEvent): void { this.editor?.handlePoiBrowserListFocusout(event); }
  handlePoiDetailBodyClick(event: MouseEvent): void { this.editor?.handlePoiDetailBodyClick(event); }
  handlePointListKeydown(event: KeyboardEvent): void { this.editor?.handlePointListKeydown(event); }
  handlePointListClick(event: MouseEvent): void { this.editor?.handlePointListClick(event); }
  handlePointListInput(event: Event): void { this.editor?.handlePointListInput(event); }
  handlePointListChange(event: Event): void { this.editor?.handlePointListChange(event); }
  handlePointListFocusout(event: FocusEvent): void { this.editor?.handlePointListFocusout(event); }
  handlePointListPointerdown(event: PointerEvent): void { this.editor?.handlePointListPointerdown(event); }
  handlePointListPointerup(): void { this.editor?.handlePointListPointerup(); }
  handlePointListDragstart(event: DragEvent): void { this.editor?.handlePointListDragstart(event); }
  handlePointListDragover(event: DragEvent): void { this.editor?.handlePointListDragover(event); }
  handlePointListDragleave(event: DragEvent): void { this.editor?.handlePointListDragleave(event); }
  handlePointListDrop(event: DragEvent): void { this.editor?.handlePointListDrop(event); }
  handlePointListDragend(): void { this.editor?.handlePointListDragend(); }
  handleMapCanvasClick(event: MouseEvent): void { this.editor?.handleMapCanvasClick(event); }
}
