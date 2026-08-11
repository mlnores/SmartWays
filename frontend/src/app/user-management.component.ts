import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';

import { AuthService, CurrentUser, UserPayload, UserRole } from './auth.service';
import { PageInstructionService } from './page-instruction.service';

interface EditableUser extends CurrentUser {
  password?: string;
  isSaving?: boolean;
}

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="users-page">
      <div class="page-title">
        <h1>Users</h1>
        <button type="button" (click)="openCreateDialog()">Create user</button>
      </div>

      @if (errorMessage) {
        <p class="error">{{ errorMessage }}</p>
      }

      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Password</th>
              <th class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (user of users; track user.id) {
              <tr [class.inactive]="!user.is_active">
                <td><input [(ngModel)]="user.username" name="username-{{ user.id }}"></td>
                <td><input type="email" [(ngModel)]="user.email" name="email-{{ user.id }}"></td>
                <td>
                  <select [(ngModel)]="user.role" name="role-{{ user.id }}">
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" [(ngModel)]="user.is_active" name="active-{{ user.id }}">
                </td>
                <td><input type="password" placeholder="Leave unchanged" [(ngModel)]="user.password" name="password-{{ user.id }}"></td>
                <td class="actions">
                  <button type="button" (click)="saveUser(user)" [disabled]="user.isSaving">Save</button>
                  <button type="button" class="secondary danger" (click)="deleteUser(user)" [disabled]="user.isSaving">Delete</button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6">No users found.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (isCreateDialogOpen) {
        <div class="dialog-backdrop" role="presentation">
          <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-user-title" (ngSubmit)="createUser()">
            <div class="dialog-header">
              <h2 id="create-user-title">Create user</h2>
              <button type="button" class="secondary icon-button" aria-label="Close" (click)="closeCreateDialog()">x</button>
            </div>
            <label>
              Username
              <input name="newUsername" placeholder="Username" [(ngModel)]="newUser.username" required autofocus>
            </label>
            <label>
              Email
              <input name="newEmail" type="email" placeholder="Email" [(ngModel)]="newUser.email">
            </label>
            <label>
              Role
              <select name="newRole" [(ngModel)]="newUser.role">
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Initial password
              <span class="password-generator-row">
                <input name="newPassword" type="text" autocomplete="new-password" placeholder="Initial password" [(ngModel)]="newUser.password">
                <button type="button" class="secondary" (click)="generatePassword()">Generate and copy</button>
              </span>
            </label>
            @if (createDialogMessage) {
              <p class="dialog-status" [class.error]="createDialogMessageIsError">{{ createDialogMessage }}</p>
            }
            <div class="dialog-actions">
              <button type="button" class="secondary" (click)="closeCreateDialog()">Cancel</button>
              <button type="submit" [disabled]="isCreating || !newUser.username.trim()">Create user</button>
            </div>
          </form>
        </div>
      }
    </section>
  `,
  styles: [`
    .users-page {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 12px;
      padding: 24px;
      background: #f5f7fb;
      height: 100%;
      min-height: 0;
    }

    .page-title h1 {
      margin: 0;
      font-size: 2rem;
    }

    .page-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    input,
    select,
    button {
      min-height: 38px;
      padding: 7px 10px;
      border: 1px solid #cfd7e6;
      border-radius: 6px;
      background: #fff;
      font: inherit;
    }

    button {
      border-color: #1f6feb;
      background: #1f6feb;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }

    button.secondary {
      border-color: #cfd7e6;
      background: #fff;
      color: #344054;
    }

    button.danger {
      border-color: #f3b8b2;
      color: #b42318;
    }

    button.danger:hover {
      background: #fff1f0;
    }

    button:disabled {
      border-color: #d8dee8;
      background: #eef2f7;
      color: #98a2b3;
      cursor: not-allowed;
    }

    .table-shell {
      overflow: auto;
      border: 1px solid #d8dee8;
      border-radius: 8px;
      background: #fff;
      min-height: 0;
    }

    table {
      width: 100%;
      min-width: 900px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 10px;
      border-bottom: 1px solid #e7ecf4;
      text-align: left;
      vertical-align: middle;
    }

    th {
      background: #f8fafc;
      color: #344054;
      font-weight: 800;
    }

    td.actions {
      display: flex;
      gap: 8px;
    }

    tr.inactive {
      color: #667085;
      background: #fafafa;
    }

    .error {
      margin: 0;
      color: #b42318;
      font-weight: 700;
    }

    .dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgb(15 23 42 / 0.38);
    }

    .dialog {
      width: min(520px, 100%);
      display: grid;
      gap: 18px;
      padding: 18px;
      border: 1px solid #d8dee8;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 18px 48px rgb(15 23 42 / 0.22);
    }

    .dialog-header,
    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .dialog-header h2 {
      margin: 0;
      font-size: 1.25rem;
    }

    .dialog label {
      display: grid;
      gap: 5px;
      color: #475467;
      font-weight: 700;
    }

    .dialog input,
    .dialog select {
      border-radius: 8px;
    }

    .dialog button {
      font-weight: 400;
    }

    .dialog button[type="submit"] {
      font-weight: 400;
    }

    .password-generator-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }

    .password-generator-row input {
      min-width: 0;
      width: 100%;
    }

    .dialog-status {
      margin: 0;
      color: #067647;
      font-weight: 700;
    }

    .dialog-status.error {
      color: #b42318;
    }

    .dialog-actions {
      justify-content: flex-end;
    }

    .icon-button {
      width: 34px;
      height: 34px;
      min-height: 34px;
      padding: 0;
      font-size: 1rem;
      font-weight: 400;
      line-height: 1;
    }
  `]
})
export class UserManagementComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly title = inject(Title);
  private readonly pageInstruction = inject(PageInstructionService);

  users: EditableUser[] = [];
  errorMessage = '';
  createDialogMessage = '';
  createDialogMessageIsError = false;
  isCreating = false;
  isCreateDialogOpen = false;
  newUser: UserPayload = {
    username: '',
    email: '',
    role: 'editor',
    is_active: true,
    password: ''
  };

  ngOnInit(): void {
    this.title.setTitle('SW Users');
    this.pageInstruction.setInstruction('Manage editor and administrator accounts.');
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
  }

  loadUsers(): void {
    this.errorMessage = '';
    this.auth.listUsers().subscribe({
      next: users => this.users = users.map(user => ({ ...user, password: '' })),
      error: () => this.errorMessage = 'Could not load users.'
    });
  }

  @HostListener('document:keydown.escape')
  closeDialogOnEscape(): void {
    if (this.isCreateDialogOpen) {
      this.closeCreateDialog();
    }
  }

  openCreateDialog(): void {
    this.errorMessage = '';
    this.createDialogMessage = '';
    this.createDialogMessageIsError = false;
    this.newUser = { username: '', email: '', role: 'editor', is_active: true, password: '' };
    this.isCreateDialogOpen = true;
  }

  async generatePassword(): Promise<void> {
    const lowercase = 'abcdefghijkmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!#$%&*+-=?@';
    const allCharacters = lowercase + uppercase + digits + symbols;
    const requiredCharacters = [
      this.randomCharacter(lowercase),
      this.randomCharacter(uppercase),
      this.randomCharacter(digits),
      this.randomCharacter(symbols)
    ];
    const remainingCharacters = Array.from({ length: 12 }, () => this.randomCharacter(allCharacters));
    const password = this.shuffleCharacters([...requiredCharacters, ...remainingCharacters]).join('');
    this.newUser.password = password;
    try {
      await this.copyTextToClipboard(password);
      this.createDialogMessage = 'Generated password copied to the clipboard.';
      this.createDialogMessageIsError = false;
    } catch {
      this.createDialogMessage = 'Generated password, but could not copy it to the clipboard.';
      this.createDialogMessageIsError = true;
    }
  }

  closeCreateDialog(): void {
    if (this.isCreating) return;
    this.isCreateDialogOpen = false;
  }

  createUser(): void {
    if (this.isCreating || !this.newUser.username.trim()) return;
    this.isCreating = true;
    this.errorMessage = '';
    this.auth.createUser({
      ...this.newUser,
      username: this.newUser.username.trim(),
      role: this.newUser.role as UserRole,
      password: this.newUser.password || undefined
    }).subscribe({
      next: user => {
        this.users = [...this.users, { ...user, password: '' }];
        this.newUser = { username: '', email: '', role: 'editor', is_active: true, password: '' };
        this.createDialogMessage = '';
        this.createDialogMessageIsError = false;
        this.isCreating = false;
        this.isCreateDialogOpen = false;
      },
      error: () => {
        this.isCreating = false;
        this.errorMessage = 'Could not create user.';
      }
    });
  }

  saveUser(user: EditableUser): void {
    user.isSaving = true;
    this.errorMessage = '';
    const payload: Partial<UserPayload> = {
      username: user.username.trim(),
      email: user.email,
      role: user.role,
      is_active: user.is_active
    };
    if (user.password) {
      payload.password = user.password;
    }
    this.auth.updateUser(user.id, payload).subscribe({
      next: saved => Object.assign(user, saved, { password: '', isSaving: false }),
      error: () => {
        user.isSaving = false;
        this.errorMessage = 'Could not save user.';
      }
    });
  }

  deleteUser(user: EditableUser): void {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    user.isSaving = true;
    this.errorMessage = '';
    this.auth.deleteUser(user.id).subscribe({
      next: () => this.users = this.users.filter(existingUser => existingUser.id !== user.id),
      error: () => {
        user.isSaving = false;
        this.errorMessage = 'Could not delete user.';
      }
    });
  }

  private randomCharacter(characters: string): string {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.getRandomValues) {
      const value = new Uint32Array(1);
      cryptoObject.getRandomValues(value);
      return characters[value[0] % characters.length];
    }
    return characters[Math.floor(Math.random() * characters.length)];
  }

  private shuffleCharacters(characters: string[]): string[] {
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const swapIndex = this.randomIndex(index + 1);
      [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
    }
    return characters;
  }

  private randomIndex(limit: number): number {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.getRandomValues) {
      const value = new Uint32Array(1);
      cryptoObject.getRandomValues(value);
      return value[0] % limit;
    }
    return Math.floor(Math.random() * limit);
  }

  private async copyTextToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error('Clipboard copy failed.');
    }
  }
}
