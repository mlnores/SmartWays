import { AsyncPipe } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { PageInstructionService } from './page-instruction.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly instruction$ = this.pageInstruction.instruction$;
  readonly currentUser$ = this.auth.currentUser$;
  isAccountDialogOpen = false;
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  accountMessage = '';
  accountMessageIsError = false;
  isChangingPassword = false;

  constructor() {
    this.auth.loadCurrentUser().subscribe();
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => alert('Could not log out. Please reload the page and try again.')
    });
  }

  openAccountDialog(): void {
    this.resetAccountForm();
    this.isAccountDialogOpen = true;
  }

  closeAccountDialog(): void {
    if (this.isChangingPassword) return;
    this.isAccountDialogOpen = false;
    this.resetAccountForm();
  }

  changePassword(): void {
    if (this.isChangingPassword) return;
    this.accountMessage = '';
    this.accountMessageIsError = false;
    if (!this.currentPassword || !this.newPassword) {
      this.accountMessage = 'Enter your current password and a new password.';
      this.accountMessageIsError = true;
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.accountMessage = 'The new password confirmation does not match.';
      this.accountMessageIsError = true;
      return;
    }
    this.isChangingPassword = true;
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.isChangingPassword = false;
        this.resetAccountForm();
        this.accountMessage = 'Password changed.';
      },
      error: error => {
        this.isChangingPassword = false;
        this.accountMessage = this.passwordErrorMessage(error);
        this.accountMessageIsError = true;
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isAccountDialogOpen) {
      this.closeAccountDialog();
    }
  }

  private resetAccountForm(): void {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.accountMessage = '';
    this.accountMessageIsError = false;
  }

  private passwordErrorMessage(error: unknown): string {
    const response = error as { error?: Record<string, string[] | string> };
    const details = response.error || {};
    const firstValue = Object.values(details)[0];
    if (Array.isArray(firstValue) && firstValue.length) {
      return firstValue[0];
    }
    if (typeof firstValue === 'string') {
      return firstValue;
    }
    return 'Could not change password.';
  }
}
