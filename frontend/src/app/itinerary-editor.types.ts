import { EditorItineraryPayload, EditorPoiSearchRequest } from './editor-api.service';

export type SearchType = 'poi' | 'waypoint';

export interface ItineraryEditorRuntime {
  destroy: () => void;
  clearAll: () => void;
  fitRoute: () => void;
  showRouteSummary: () => void;
  saveItinerary: () => void;
  revertItinerary: () => void;
  undoItinerary: () => void;
  redoItinerary: () => void;
  closeRouteDialog: () => void;
  closePoiDetailDialog: () => void;
  addPoiFromDetail: () => void;
  activateTab: (tabName: SearchType) => void;
  handleSearchInput: (type: SearchType) => void;
  handleSearchKeydown: (type: SearchType, event: KeyboardEvent) => void;
  handleSearchResultsClick: (type: SearchType, event: MouseEvent) => void;
  refreshPoiSearchResults: () => void;
  togglePoiBrowser: () => void;
  handlePoiBrowserFiltersChange: (event: Event) => void;
  handlePoiBrowserListClick: (event: MouseEvent) => void;
  handlePoiBrowserListMouseover: (event: MouseEvent) => void;
  handlePoiBrowserListMouseout: (event: MouseEvent) => void;
  handlePoiBrowserListFocusin: (event: FocusEvent) => void;
  handlePoiBrowserListFocusout: (event: FocusEvent) => void;
  handlePoiDetailBodyClick: (event: MouseEvent) => void;
  handlePointListKeydown: (event: KeyboardEvent) => void;
  handlePointListClick: (event: MouseEvent) => void;
  handlePointListInput: (event: Event) => void;
  handlePointListChange: (event: Event) => void;
  handlePointListFocusout: (event: FocusEvent) => void;
  handlePointListPointerdown: (event: PointerEvent) => void;
  handlePointListPointerup: () => void;
  handlePointListDragstart: (event: DragEvent) => void;
  handlePointListDragover: (event: DragEvent) => void;
  handlePointListDragleave: (event: DragEvent) => void;
  handlePointListDrop: (event: DragEvent) => void;
  handlePointListDragend: () => void;
  handleMapCanvasClick: (event: MouseEvent) => void;
}

export interface ItineraryEditorApi {
  searchPlaces: (query: string, lat: number, lon: number) => Promise<{ features?: unknown[] }>;
  reverseGeocode: (lat: number, lon: number) => Promise<{ features?: unknown[] }>;
  searchPois: (request: EditorPoiSearchRequest) => Promise<{ results?: unknown[] }>;
  getPoi: (poiId: string, language?: string) => Promise<Record<string, unknown>>;
  getItinerary: (itineraryId: string, language?: string) => Promise<Record<string, unknown>>;
  saveItinerary: (itineraryId: string | null, payload: EditorItineraryPayload) => Promise<Record<string, unknown>>;
  getWalkingRoutes: (coordinates: string, queryString: string) => Promise<Record<string, unknown>>;
  findBufferPois: (buffer: unknown, segmentIndex: number, limit: number) => Promise<{ results?: unknown[] }>;
}
