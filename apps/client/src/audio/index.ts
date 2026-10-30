/**
 * Audio manager interface and stub.
 */

export class AudioManager {
  private muted = false;

  playBgm(_trackId: string): void {
    // Stub
  }

  playSfx(_sfxId: string): void {
    // Stub
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
