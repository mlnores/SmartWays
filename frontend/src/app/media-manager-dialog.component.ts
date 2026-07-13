import { Component, ElementRef, EventEmitter, ViewChild, inject, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ApiService, Itinerary, MediaAsset, PoiMediaTranslation, Route, Translation } from './api.service';

type MediaOwner = 'route' | 'itinerary';
type MediaTab = 'media' | 'translations';

interface MediaDraft {
  id?: number;
  media_type: MediaAsset['media_type'];
  source: 'local' | 'remote';
  url: string;
  file_url?: string;
  original_filename?: string;
  content_type?: string;
  size?: number | null;
  selectedFile?: File;
  selectedPreviewUrl?: string;
  uploading?: boolean;
  captions: Record<string, string>;
  position: number;
  is_primary: boolean;
}

@Component({
  selector: 'app-media-manager-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog #dialog class="metadata-dialog wide media-manager-dialog" (close)="reset()">
      <form method="dialog" class="metadata-dialog-content" (submit)="$event.preventDefault()">
        <header class="metadata-dialog-header">
          <div>
            <h2>Manage media</h2>
            <p>{{ ownerLabel }}: {{ resourceTitle }}</p>
          </div>
          <button type="button" class="icon-button" aria-label="Close media dialog" (click)="close()">✖</button>
        </header>

        @if (statusMessage) {
          <p [class.status-error]="statusIsError" [class.status-success]="!statusIsError">{{ statusMessage }}</p>
        }

        <div class="tabs">
          <button type="button" [class.active]="activeTab === 'media'" (click)="activeTab = 'media'">Media</button>
          <button type="button" [class.active]="activeTab === 'translations'" (click)="activeTab = 'translations'">Translations</button>
        </div>

        @if (activeTab === 'media') {
          <section class="editor-panel">
            <div class="section-heading">
              <h3>Linked media</h3>
              @if (canEdit) {
                <button type="button" class="secondary" (click)="addMedia()">Add media</button>
              }
            </div>
            <div class="media-list">
              @for (item of media; track $index) {
                <article class="media-row">
                  <div class="media-preview">
                    @if (item.media_type === 'image' && mediaDisplayUrl(item)) {
                      <img [src]="mediaDisplayUrl(item)" alt="" />
                    } @else {
                      <span>{{ mediaTypeLabel(item.media_type) }}</span>
                    }
                  </div>
                  <div class="media-fields">
                    <label>
                      <span>Type</span>
                      <select [(ngModel)]="item.media_type" [name]="'managedMediaType' + $index" [disabled]="!canEdit">
                        @for (type of mediaTypes; track type) {
                          <option [value]="type">{{ mediaTypeLabel(type) }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>Position</span>
                      <input type="number" min="0" [(ngModel)]="item.position" [name]="'managedMediaPosition' + $index" [disabled]="!canEdit" />
                    </label>
                    <label class="checkbox-label">
                      <input type="checkbox" [checked]="item.is_primary" [disabled]="!canEdit" (change)="setPrimaryMedia($index, $any($event.target).checked)" />
                      <span>Primary media</span>
                    </label>
                    <fieldset class="metadata-full-row media-source-fieldset">
                      <legend>Media source</legend>
                      <div class="view-toggle media-source-toggle" aria-label="Media source">
                        <button type="button" [class.active]="item.source === 'local'" [disabled]="!canEdit" (click)="setMediaSource($index, 'local')">Local file</button>
                        <button type="button" [class.active]="item.source === 'remote'" [disabled]="!canEdit" (click)="setMediaSource($index, 'remote')">Remote URL</button>
                      </div>
                      @if (item.source === 'remote') {
                        <label>
                          <span>URL</span>
                          <input type="url" [(ngModel)]="item.url" [name]="'managedMediaUrl' + $index" [disabled]="!canEdit" placeholder="https://..." />
                        </label>
                      } @else {
                        <div class="media-drop-zone" [class.disabled]="!canEdit" (dragover)="handleMediaDragOver($event)" (drop)="handleMediaDrop($index, $event)">
                          <p>Drag a file here, or choose one from your computer.</p>
                          <input type="file" [name]="'managedMediaFile' + $index" [disabled]="!canEdit" (change)="selectMediaFile($index, $event)" />
                        </div>
                        @if (item.uploading) {
                          <p class="media-file-note">Uploading...</p>
                        }
                      }
                    </fieldset>
                    <label class="metadata-full-row media-reference-caption">
                      <span>Caption in {{ referenceLanguageLabel() }}</span>
                      <textarea rows="2" [ngModel]="referenceMediaCaption(item)" (ngModelChange)="setReferenceMediaCaption(item, $event)" [name]="'managedMediaReferenceCaption' + $index" [disabled]="!canEdit" placeholder="Optional caption"></textarea>
                    </label>
                  </div>
                  @if (canEdit) {
                    <button type="button" class="secondary danger-action" (click)="removeMedia($index)">Remove</button>
                  }
                </article>
              } @empty {
                <p class="muted">No media linked yet.</p>
              }
            </div>
          </section>
        } @else {
          <section class="editor-panel">
            <div class="translation-comparison">
              <section class="reference-column">
                <h3>Reference captions</h3>
                @for (item of media; track $index) {
                  <label>
                    <div class="media-caption-header">
                      <span class="media-caption-title">{{ mediaCaptionLabel(item, $index) }}</span>
                      @if (mediaDisplayUrl(item)) {
                        <a [href]="mediaDisplayUrl(item)" target="_blank" rel="noopener noreferrer">Show in new tab</a>
                      }
                    </div>
                    <textarea rows="2" [value]="referenceMediaCaption(item)" readonly></textarea>
                  </label>
                } @empty {
                  <p class="muted">Add media before editing captions.</p>
                }
              </section>
              <section>
                <h3>Translated captions</h3>
                <label>
                  <span>Language</span>
                  <select [(ngModel)]="activeLanguage" name="mediaCaptionLanguage">
                    @for (language of captionLanguages(); track language) {
                      <option [value]="language">{{ language }}</option>
                    }
                  </select>
                </label>
                @for (item of media; track $index) {
                  <label>
                    <div class="media-caption-header">
                      <span class="media-caption-title">{{ mediaCaptionLabel(item, $index) }}</span>
                      @if (mediaDisplayUrl(item)) {
                        <a [href]="mediaDisplayUrl(item)" target="_blank" rel="noopener noreferrer">Show in new tab</a>
                      }
                    </div>
                    <textarea rows="2" [ngModel]="mediaCaption(item, activeLanguage)" (ngModelChange)="setMediaCaption(item, activeLanguage, $event)" [name]="'managedMediaCaption' + activeLanguage + '-' + $index" [disabled]="!canEdit" placeholder="Optional translated caption"></textarea>
                  </label>
                }
              </section>
            </div>
          </section>
        }

        <footer class="metadata-dialog-footer">
          <button type="button" class="secondary" (click)="close()">Close</button>
          @if (canEdit) {
            <button type="button" class="primary" [disabled]="saving" (click)="save()">{{ saving ? 'Saving...' : 'Save media' }}</button>
          }
        </footer>
      </form>
    </dialog>
  `,
  styleUrls: ['./resource-list.css'],
  styles: [`
    :host {
      display: contents;
    }

    .media-manager-dialog {
      width: min(980px, calc(100vw - 32px));
    }

    .metadata-dialog-header p {
      margin: 4px 0 0;
      color: #475467;
      font-size: 0.92rem;
    }

    .status-error,
    .status-success {
      margin: 12px 16px 0;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.92rem;
    }

    .status-error {
      color: #b00020;
      background: #fff5f5;
      border: 1px solid #fecaca;
    }

    .status-success {
      color: #166534;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
    }

    .tabs {
      display: flex;
      gap: 4px;
      padding: 10px 16px 0;
      border-bottom: 1px solid #e4e9f2;
      background: #f8fafc;
    }

    .tabs button {
      min-height: 36px;
      padding: 8px 12px;
      border: 1px solid transparent;
      border-bottom: 0;
      border-radius: 8px 8px 0 0;
      background: transparent;
      color: #475467;
      font: inherit;
      cursor: pointer;
    }

    .tabs button.active {
      color: #111827;
      border-color: #d7deea;
      background: #ffffff;
      font-weight: 700;
    }

    .editor-panel {
      max-height: min(68vh, 720px);
      overflow: auto;
      padding: 16px;
    }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 14px;
    }

    .section-heading h3,
    .translation-comparison h3 {
      margin: 0;
      color: #111827;
      font-size: 1rem;
      font-weight: 700;
    }

    .media-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(430px, 1fr));
      gap: 12px;
      align-items: start;
    }

    .media-row {
      display: grid;
      grid-template-columns: 148px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      padding: 12px;
      border: 1px solid #d7deea;
      border-radius: 10px;
      background: #ffffff;
    }

    .media-row > .danger-action {
      grid-column: 1 / -1;
      justify-self: end;
    }

    .media-preview {
      display: grid;
      place-items: center;
      min-height: 112px;
      overflow: hidden;
      border: 1px solid #d7deea;
      border-radius: 8px;
      color: #667085;
      background: #f8fafc;
    }

    .media-preview img {
      width: 100%;
      height: 140px;
      object-fit: cover;
    }

    .media-fields {
      display: grid;
      grid-template-columns: minmax(130px, 1fr) minmax(90px, 120px);
      gap: 12px;
      min-width: 0;
    }

    label {
      display: grid;
      gap: 5px;
      color: #475467;
      font-size: 0.86rem;
      font-weight: 600;
    }

    input,
    select,
    textarea {
      width: 100%;
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid #cfd6e3;
      border-radius: 7px;
      color: #111827;
      background: #ffffff;
      font: inherit;
      font-weight: 400;
    }

    textarea {
      resize: vertical;
    }

    input:disabled,
    select:disabled,
    textarea:disabled,
    button:disabled {
      cursor: not-allowed;
      opacity: 0.62;
    }

    .checkbox-label {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .checkbox-label input {
      width: auto;
      min-width: 0;
    }

    .metadata-full-row {
      grid-column: 1 / -1;
    }

    .media-source-fieldset {
      display: grid;
      gap: 12px;
      min-width: 0;
      margin: 0;
      padding: 10px;
      border: 1px solid #d7deea;
      border-radius: 8px;
    }

    .media-source-fieldset legend {
      padding: 0 4px;
      color: #475467;
      font-size: 0.85rem;
      font-weight: 700;
    }

    .view-toggle {
      display: inline-flex;
      width: max-content;
      padding: 3px;
      border: 1px solid #cfd6e3;
      border-radius: 9px;
      background: #ffffff;
    }

    .view-toggle button {
      min-height: 30px;
      padding: 5px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #475467;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .view-toggle button.active {
      color: #ffffff;
      background: #1f6feb;
    }

    .media-reference-caption textarea {
      min-height: 68px;
    }

    .media-drop-zone {
      display: grid;
      gap: 8px;
      min-height: 120px;
      padding: 14px;
      border: 2px dashed #b8c4d6;
      border-radius: 8px;
      background: #f8fafc;
      color: #4a5568;
    }

    .media-drop-zone.disabled {
      opacity: 0.6;
    }

    .media-drop-zone p {
      margin: 0;
      font-weight: 600;
    }

    .media-drop-zone input[type="file"] {
      max-width: 100%;
      padding: 7px;
      background: #ffffff;
    }

    .media-file-note,
    .muted {
      margin: 0;
      color: #667085;
    }

    .translation-comparison {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
    }

    .translation-comparison > section {
      display: grid;
      align-content: start;
      gap: 12px;
      min-width: 0;
      padding: 12px;
      border: 1px solid #d7deea;
      border-radius: 10px;
      background: #ffffff;
    }

    .reference-column {
      background: #f8fafc !important;
    }

    .media-caption-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .media-caption-title,
    .media-caption-header a {
      color: #475467;
      font-size: 0.86rem;
      font-weight: 700;
    }

    .media-caption-header a {
      color: #0b63ce;
      text-decoration: none;
      white-space: nowrap;
    }

    .media-caption-header a:hover {
      text-decoration: underline;
    }

    @media (max-width: 760px) {
      .media-list,
      .translation-comparison {
        grid-template-columns: 1fr;
      }

      .media-row {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class MediaManagerDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLDialogElement>;
  @Output() saved = new EventEmitter<void>();

  private readonly api = inject(ApiService);
  owner: MediaOwner = 'route';
  resource: Route | Itinerary | null = null;
  media: MediaDraft[] = [];
  activeTab: MediaTab = 'media';
  activeLanguage = 'en';
  statusMessage = '';
  statusIsError = false;
  saving = false;
  readonly mediaTypes: MediaAsset['media_type'][] = ['image', 'video', 'audio', 'document', 'link', 'other'];

  get ownerLabel(): string {
    return this.owner === 'route' ? 'Route' : 'Itinerary';
  }

  get resourceTitle(): string {
    return this.resource?.title || `Untitled ${this.owner}`;
  }

  get canEdit(): boolean {
    return Boolean(this.resource && !this.resource.enabled);
  }

  open(owner: MediaOwner, resource: Route | Itinerary): void {
    this.owner = owner;
    this.resource = resource;
    this.media = this.mediaDraftsFrom(resource.media || []);
    this.activeLanguage = this.referenceLanguageLabel();
    this.activeTab = 'media';
    this.statusMessage = this.canEdit ? '' : `This public ${owner} is read-only. Turn it to draft before editing media.`;
    this.statusIsError = !this.canEdit;
    this.dialog?.nativeElement.showModal();
  }

  close(): void {
    this.dialog?.nativeElement.close();
  }

  reset(): void {
    this.revokeMediaPreviewUrls();
    this.resource = null;
    this.media = [];
    this.saving = false;
  }

  addMedia(): void {
    if (!this.canEdit) return;
    this.media.push({
      media_type: 'image',
      source: 'local',
      url: '',
      captions: {},
      position: this.media.length,
      is_primary: this.media.length === 0
    });
  }

  setMediaSource(index: number, source: 'local' | 'remote'): void {
    if (!this.canEdit || !this.media[index]) return;
    this.media[index].source = source;
    if (source === 'local') {
      this.media[index].url = '';
    } else {
      this.revokeMediaPreviewUrl(this.media[index]);
      this.media[index].selectedFile = undefined;
      this.media[index].selectedPreviewUrl = undefined;
    }
  }

  selectMediaFile(index: number, event: Event): void {
    if (!this.canEdit) return;
    const input = event.target as HTMLInputElement;
    this.applyMediaFile(index, input.files?.[0]);
  }

  handleMediaDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  handleMediaDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    if (!this.canEdit) return;
    const files = event.dataTransfer?.files;
    this.applyMediaFile(index, files?.[0]);
    const input = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[type="file"]');
    if (input && files && files.length > 0) {
      input.files = files;
    }
  }

  removeMedia(index: number): void {
    if (!this.canEdit) return;
    const wasPrimary = this.media[index]?.is_primary;
    this.revokeMediaPreviewUrl(this.media[index]);
    this.media.splice(index, 1);
    if (wasPrimary && this.media.length > 0) {
      this.media[0].is_primary = true;
    }
  }

  setPrimaryMedia(index: number, checked: boolean): void {
    if (!this.canEdit) return;
    if (!checked) {
      this.media[index].is_primary = false;
      return;
    }
    this.media = this.media.map((item, currentIndex) => ({
      ...item,
      is_primary: currentIndex === index
    }));
  }

  mediaTypeLabel(type: MediaAsset['media_type']): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  mediaDisplayUrl(item: MediaDraft): string {
    return item.selectedPreviewUrl || item.url || item.file_url || '';
  }

  mediaCaption(item: MediaDraft, languageCode: string): string {
    const language = languageCode.trim();
    return language ? item.captions[language] || '' : '';
  }

  setMediaCaption(item: MediaDraft, languageCode: string, caption: string): void {
    if (!this.canEdit) return;
    const language = languageCode.trim();
    if (!language) return;
    item.captions[language] = caption;
  }

  referenceMediaCaption(item: MediaDraft): string {
    const referenceLanguage = this.referenceLanguageLabel();
    return this.mediaCaption(item, referenceLanguage);
  }

  setReferenceMediaCaption(item: MediaDraft, caption: string): void {
    this.setMediaCaption(item, this.referenceLanguageLabel(), caption);
  }

  referenceLanguageLabel(): string {
    return this.referenceTranslation()?.language_code.trim() || 'en';
  }

  mediaCaptionLabel(item: MediaDraft, index: number): string {
    return item.original_filename || `${this.mediaTypeLabel(item.media_type)} ${index + 1}`;
  }

  captionLanguages(): string[] {
    const languages = (this.resource?.translations || [])
      .map(translation => translation.language_code)
      .filter(Boolean);
    return languages.length ? languages : ['en'];
  }

  async save(): Promise<void> {
    if (!this.resource || !this.canEdit) return;
    if (this.media.some(item => item.source === 'remote' && !item.url.trim())) {
      this.showStatus('Every remote media item needs a URL.', true);
      return;
    }
    if (this.media.some(item => item.source === 'local' && !item.selectedFile)) {
      this.showStatus('Every local media item needs a selected file.', true);
      return;
    }

    this.saving = true;
    try {
      const payload = { media: this.normalizedMedia() };
      const updated = this.owner === 'route'
        ? await firstValueFrom(this.api.updateRoute(this.resource.id, payload))
        : await firstValueFrom(this.api.updateItinerary(this.resource.id, payload));
      await this.uploadPendingMedia(updated);
      this.showStatus('Media saved.', false);
      this.saved.emit();
      this.close();
    } catch (error) {
      this.showStatus(`Could not save media. ${error instanceof Error ? error.message : 'Request failed.'}`, true);
    } finally {
      this.saving = false;
    }
  }

  private applyMediaFile(index: number, file?: File): void {
    if (!file || !this.media[index]) return;
    this.revokeMediaPreviewUrl(this.media[index]);
    this.media[index].source = 'local';
    this.media[index].selectedFile = file;
    this.media[index].original_filename = file.name;
    this.media[index].content_type = file.type;
    this.media[index].size = file.size;
    this.media[index].media_type = this.mediaTypeFromFile(file);
    this.media[index].selectedPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    this.media[index].url = '';
  }

  private async uploadPendingMedia(resource: Route | Itinerary): Promise<void> {
    const pending = this.media
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.selectedFile);
    for (const { item, index } of pending) {
      if (!item.selectedFile) continue;
      item.uploading = true;
      if (this.owner === 'route') {
        if (item.id) {
          await firstValueFrom(this.api.updateRouteMedia(item.id, item.selectedFile, item.media_type, Number(item.position) || index, item.is_primary, this.mediaTranslationsForPayload(item)));
        } else {
          await firstValueFrom(this.api.uploadRouteMedia(resource.id, item.selectedFile, item.media_type, Number(item.position) || index, item.is_primary, this.mediaTranslationsForPayload(item)));
        }
      } else {
        if (item.id) {
          await firstValueFrom(this.api.updateItineraryMedia(item.id, item.selectedFile, item.media_type, Number(item.position) || index, item.is_primary, this.mediaTranslationsForPayload(item)));
        } else {
          await firstValueFrom(this.api.uploadItineraryMedia(resource.id, item.selectedFile, item.media_type, Number(item.position) || index, item.is_primary, this.mediaTranslationsForPayload(item)));
        }
      }
      item.uploading = false;
    }
  }

  private mediaDraftsFrom(media: MediaAsset[]): MediaDraft[] {
    return media.map(item => ({
      id: item.id,
      media_type: item.media_type || 'image',
      source: 'remote',
      url: item.url || item.file_url || item.image_url || '',
      file_url: item.file_url || item.image_url || '',
      original_filename: item.original_filename || '',
      content_type: item.content_type || '',
      size: item.size ?? null,
      captions: this.mediaCaptionsFrom(item.translations || []),
      position: item.position || 0,
      is_primary: Boolean(item.is_primary)
    }));
  }

  private mediaCaptionsFrom(translations: PoiMediaTranslation[]): Record<string, string> {
    return Object.fromEntries(
      translations
        .filter(translation => translation.language_code)
        .map(translation => [translation.language_code, translation.caption || ''])
    );
  }

  private normalizedMedia(): MediaAsset[] {
    const media = this.media
      .map((item, index) => ({
        id: item.id,
        media_type: item.media_type,
        url: item.source === 'remote' ? item.url.trim() : '',
        file_url: item.source === 'remote' ? item.file_url : undefined,
        original_filename: item.original_filename,
        content_type: item.content_type,
        size: item.size,
        position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
        is_primary: item.is_primary,
        translations: this.mediaTranslationsForPayload(item)
      }))
      .filter((item, index) => Boolean(item.url || (item.id && this.media[index].selectedFile)));
    if (!media.some(item => item.is_primary) && media.length > 0) {
      media[0].is_primary = true;
    }
    return media;
  }

  private mediaTranslationsForPayload(item: MediaDraft): PoiMediaTranslation[] {
    return Object.entries(item.captions)
      .map(([language_code, caption]) => ({
        language_code: language_code.trim(),
        caption: caption.trim()
      }))
      .filter(translation => translation.language_code && translation.caption);
  }

  private mediaTypeFromFile(file: File): MediaAsset['media_type'] {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type === 'application/pdf' || file.type.startsWith('text/')) return 'document';
    return 'other';
  }

  private referenceTranslation(): Translation | null {
    return this.resource?.translations.find(translation => translation.is_reference) || this.resource?.translations[0] || null;
  }

  private revokeMediaPreviewUrl(item?: MediaDraft): void {
    if (item?.selectedPreviewUrl) {
      URL.revokeObjectURL(item.selectedPreviewUrl);
      item.selectedPreviewUrl = undefined;
    }
  }

  private revokeMediaPreviewUrls(): void {
    for (const item of this.media) {
      this.revokeMediaPreviewUrl(item);
    }
  }

  private showStatus(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.statusIsError = isError;
  }
}
