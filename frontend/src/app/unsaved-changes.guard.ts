import { CanDeactivateFn } from '@angular/router';

export interface UnsavedChangesAware {
  hasUnsavedChanges: () => boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = component => {
  if (!component.hasUnsavedChanges()) return true;
  return window.confirm('You have unsaved changes. Leave this page and discard them?');
};
