import { Routes } from '@angular/router';

import { ItineraryEditorComponent } from './itinerary-editor.component';
import { ItineraryListComponent } from './itinerary-list.component';
import { PoiListComponent } from './poi-list.component';
import { RouteListComponent } from './route-list.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'itineraries' },
  { path: 'itineraries', component: ItineraryListComponent },
  { path: 'itineraries/new', component: ItineraryEditorComponent },
  { path: 'itineraries/:id/edit', component: ItineraryEditorComponent },
  { path: 'itineraries/:id/pois', component: PoiListComponent },
  { path: 'routes', component: RouteListComponent },
  { path: 'route/:slug', component: ItineraryListComponent },
  { path: 'pois', component: PoiListComponent },
  { path: '**', redirectTo: 'itineraries' }
];
