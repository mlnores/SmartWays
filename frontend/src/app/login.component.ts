import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { AuthService } from './auth.service';
import { PageInstructionService } from './page-instruction.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="login-page">
      <form class="login-panel" (ngSubmit)="submit()">
        <h1>Log in</h1>
        <label>
          Username
          <input name="username" [(ngModel)]="username" autocomplete="username" required>
        </label>
        <label>
          Password
          <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required>
        </label>
        @if (errorMessage) {
          <p class="error">{{ errorMessage }}</p>
        }
        <button type="submit" [disabled]="isSubmitting || !username.trim() || !password">
          {{ isSubmitting ? 'Logging in...' : 'Log in' }}
        </button>
      </form>
    </section>
  `,
  styles: [`
    .login-page {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f5f7fb;
    }

    .login-panel {
      width: min(420px, 100%);
      display: grid;
      gap: 16px;
      padding: 24px;
      border: 1px solid #d8dee8;
      border-radius: 8px;
      background: #fff;
    }

    h1 {
      margin: 0;
      font-size: 1.5rem;
    }

    label {
      display: grid;
      gap: 6px;
      color: #475467;
      font-weight: 700;
    }

    input {
      min-height: 40px;
      padding: 8px 10px;
      border: 1px solid #cfd7e6;
      border-radius: 6px;
      font: inherit;
    }

    button {
      justify-self: start;
      min-height: 40px;
      padding: 0 16px;
      border: 1px solid #1f6feb;
      border-radius: 6px;
      background: #1f6feb;
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      border-color: #cfd7e6;
      background: #eef2f7;
      color: #98a2b3;
      cursor: not-allowed;
    }

    .error {
      margin: 0;
      color: #b42318;
      font-weight: 700;
    }
  `]
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly pageInstruction = inject(PageInstructionService);

  username = '';
  password = '';
  errorMessage = '';
  isSubmitting = false;

  ngOnInit(): void {
    this.title.setTitle('SW Login');
    this.pageInstruction.setInstruction('Log in to manage routes, itineraries, and POIs.');
  }

  ngOnDestroy(): void {
    this.pageInstruction.clearInstruction();
  }

  submit(): void {
    if (this.isSubmitting || !this.username.trim() || !this.password) return;
    this.isSubmitting = true;
    this.errorMessage = '';
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/itineraries';
        this.router.navigateByUrl(returnUrl);
      },
      error: () => {
        this.isSubmitting = false;
        this.errorMessage = 'Invalid username or password.';
      }
    });
  }
}
