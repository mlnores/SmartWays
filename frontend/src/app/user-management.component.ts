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
                  <button type="button" class="secondary" (click)="deactivateUser(user)" [disabled]="user.isSaving || !user.is_active">Deactivate</button>
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
              <input name="newPassword" type="password" placeholder="Initial password" [(ngModel)]="newUser.password">
            </label>
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
      width: min(460px, 100%);
      display: grid;
      gap: 14px;
      padding: 20px;
      border: 1px solid #d8dee8;
      border-radius: 8px;
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
      gap: 6px;
      color: #475467;
      font-weight: 700;
    }

    .dialog-actions {
      justify-content: flex-end;
    }

    .icon-button {
      width: 34px;
      min-height: 34px;
      padding: 0;
      font-size: 1.25rem;
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
    this.newUser = { username: '', email: '', role: 'editor', is_active: true, password: '' };
    this.isCreateDialogOpen = true;
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

  deactivateUser(user: EditableUser): void {
    user.isSaving = true;
    this.errorMessage = '';
    this.auth.deactivateUser(user.id).subscribe({
      next: () => Object.assign(user, { is_active: false, isSaving: false }),
      error: () => {
        user.isSaving = false;
        this.errorMessage = 'Could not deactivate user.';
      }
    });
  }
}
