import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

const API_BASE_URL = 'http://127.0.0.1:8000/api';

export interface ApiPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Translation {
  id?: number;
  language_code: string;
  title?: string;
  name?: string;
  description?: string;
  slug?: string;
}

export interface Itinerary {
  id: number;
  enabled: boolean;
  itinerary_json: unknown;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  translations: Translation[];
}

export interface Poi {
  id: number;
  enabled: boolean;
  gps_latitude: number;
  gps_longitude: number;
  title: string | null;
  description: string | null;
  slug: string | null;
  categories: Array<{ id: number; slug: string; name: string | null }>;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  listItineraries(query = '', language = 'en'): Observable<ApiPage<Itinerary>> {
    let params = new HttpParams().set('language', language);
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Itinerary>>(`${API_BASE_URL}/itineraries/`, { params });
  }

  listPois(query = '', language = 'en'): Observable<ApiPage<Poi>> {
    let params = new HttpParams()
      .set('language', language)
      .set('enabled', 'true');
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Poi>>(`${API_BASE_URL}/pois/`, { params });
  }
}
