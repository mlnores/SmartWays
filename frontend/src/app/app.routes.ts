import { Routes } from '@angular/router';

import { ItineraryEditorFrameComponent } from './itinerary-editor-frame.component';
import { ItineraryListComponent } from './itinerary-list.component';
import { PoiListComponent } from './poi-list.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'itineraries' },
  { path: 'itineraries', component: ItineraryListComponent },
  { path: 'itineraries/new', component: ItineraryEditorFrameComponent },
  { path: 'itineraries/:id/edit', component: ItineraryEditorFrameComponent },
  { path: 'pois', component: PoiListComponent },
  { path: '**', redirectTo: 'itineraries' }
];
