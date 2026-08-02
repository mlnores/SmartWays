import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PageInstructionService {
  private readonly instructionSubject = new BehaviorSubject('');
  readonly instruction$ = this.instructionSubject.asObservable();

  setInstruction(instruction: string): void {
    this.instructionSubject.next(instruction);
  }

  clearInstruction(): void {
    this.instructionSubject.next('');
  }
}
