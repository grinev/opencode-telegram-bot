interface DashboardMessage {
  chatId: number;
  messageId: number;
}

export class DashboardCardManager {
  private active: DashboardMessage | null = null;
  private generation = 0;

  beginOpen(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  replace(message: DashboardMessage): DashboardMessage | null {
    const previous = this.active;
    this.active = message;
    return previous;
  }

  reset(): DashboardMessage | null {
    this.generation++;
    const previous = this.active;
    this.active = null;
    return previous;
  }

  close(chatId: number, messageId: number): boolean {
    if (this.active?.chatId !== chatId || this.active.messageId !== messageId) {
      return false;
    }
    this.active = null;
    return true;
  }
}
