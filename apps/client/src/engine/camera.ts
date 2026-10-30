/**
 * 2D Camera locked to the player's smoothly interpolated position.
 */

export class Camera {
  public x = 0;
  public y = 0;
  public viewportWidth = window.innerWidth;
  public viewportHeight = window.innerHeight;

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  follow(targetPixelX: number, targetPixelY: number): void {
    this.x = Math.round(targetPixelX - this.viewportWidth / 2);
    this.y = Math.round(targetPixelY - this.viewportHeight / 2);
  }
}
