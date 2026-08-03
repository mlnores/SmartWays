import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { PageInstructionService } from './page-instruction.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly pageInstruction = inject(PageInstructionService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly instruction$ = this.pageInstruction.instruction$;
  readonly currentUser$ = this.auth.currentUser$;

  constructor() {
    this.auth.loadCurrentUser().subscribe();
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => alert('Could not log out. Please reload the page and try again.')
    });
  }
}
