import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';

const API_BASE_URL = 'http://127.0.0.1:8000/api';
const PHOTON_BASE_URL = 'https://photon.komoot.io';
const WALKING_ROUTE_BASE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export interface EditorPoiSearchRequest {
  query: string;
  language?: string;
  enabled?: boolean;
  bbox?: string | null;
}

export interface EditorItineraryPayload {
  enabled: boolean;
  itinerary_json: unknown;
  translations: Array<{
    language_code: string;
    title: string;
    description: string;
    is_reference?: boolean;
  }>;
}

@Injectable({ providedIn: 'root' })
export class EditorApiService {
  constructor(private readonly http: HttpClient) {}

  async searchPlaces(query: string, lat: number, lon: number): Promise<{ features?: unknown[] }> {
    const params = new HttpParams()
      .set('q', query)
      .set('limit', '5')
      .set('lat', lat.toFixed(6))
      .set('lon', lon.toFixed(6));

    return this.request(() => this.http.get<{ features?: unknown[] }>(`${PHOTON_BASE_URL}/api/`, { params }));
  }

  async reverseGeocode(lat: number, lon: number): Promise<{ features?: unknown[] }> {
    const params = new HttpParams()
      .set('lat', lat.toFixed(6))
      .set('lon', lon.toFixed(6));

    return this.request(() => this.http.get<{ features?: unknown[] }>(`${PHOTON_BASE_URL}/reverse`, { params }));
  }

  async searchPois(request: EditorPoiSearchRequest): Promise<{ results?: unknown[] }> {
    let params = new HttpParams()
      .set('q', request.query)
      .set('enabled', String(request.enabled ?? true))
      .set('language', request.language || 'en');

    if (request.bbox) {
      params = params.set('bbox', request.bbox);
    }

    return this.request(() => this.http.get<{ results?: unknown[] }>(`${API_BASE_URL}/pois/`, { params }));
  }

  async getPoi(poiId: string, language = 'en'): Promise<Record<string, unknown>> {
    const params = new HttpParams().set('language', language);
    return this.request(() => this.http.get<Record<string, unknown>>(`${API_BASE_URL}/pois/${encodeURIComponent(poiId)}/`, { params }));
  }

  async getItinerary(itineraryId: string, language = 'en'): Promise<Record<string, unknown>> {
    const params = new HttpParams().set('language', language);
    return this.request(() => this.http.get<Record<string, unknown>>(`${API_BASE_URL}/itineraries/${encodeURIComponent(itineraryId)}/`, { params }));
  }

  async saveItinerary(itineraryId: string | null, payload: EditorItineraryPayload): Promise<Record<string, unknown>> {
    const url = `${API_BASE_URL}/itineraries/${itineraryId ? `${encodeURIComponent(itineraryId)}/` : ''}`;
    if (itineraryId) {
      return this.request(() => this.http.patch<Record<string, unknown>>(url, payload));
    }
    return this.request(() => this.http.post<Record<string, unknown>>(url, payload));
  }

  async getWalkingRoutes(coordinates: string, queryString: string): Promise<Record<string, unknown>> {
    const suffix = queryString ? `?${queryString}` : '';
    return this.request(() => this.http.get<Record<string, unknown>>(`${WALKING_ROUTE_BASE_URL}/${coordinates}${suffix}`));
  }

  async findBufferPois(buffer: unknown, segmentIndex: number, limit: number): Promise<{ results?: unknown[] }> {
    return this.request(() => this.http.post<{ results?: unknown[] }>(`${API_BASE_URL}/buffer-pois/`, {
      buffer,
      segmentIndex,
      limit
    }));
  }

  private async request<T>(factory: () => Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(factory());
    } catch (error) {
      throw new Error(this.errorMessage(error));
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const detail = this.detailMessage(error.error);
      return detail || `Service returned ${error.status}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Service request failed';
  }

  private detailMessage(errorBody: unknown): string {
    if (!errorBody) return '';
    if (typeof errorBody === 'string') return errorBody;
    if (typeof errorBody === 'object' && 'detail' in errorBody) {
      const detail = (errorBody as { detail?: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
    return JSON.stringify(errorBody);
  }
}
