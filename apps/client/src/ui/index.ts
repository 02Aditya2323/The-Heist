/**
 * UI manager managing screen states (Auth modal, system banners, and alerts).
 * Interacts only with DOM and delegates actions to the game orchestrator.
 */

export type ScreenMode =
  | "AUTH"
  | "GAME"
  | "SESSION_REPLACED"
  | "SERVER_FULL"
  | "DISCONNECTED";

export class UIManager {
  private authModal: HTMLElement | null = null;
  private authUsernameInput: HTMLInputElement | null = null;
  private authPasswordInput: HTMLInputElement | null = null;
  private authBtnLogin: HTMLButtonElement | null = null;
  private authBtnRegister: HTMLButtonElement | null = null;
  private authStatus: HTMLElement | null = null;
  private banner: HTMLElement | null = null;

  init(): void {
    this.authModal = document.getElementById("auth-modal");
    this.authUsernameInput = document.getElementById(
      "auth-username",
    ) as HTMLInputElement;
    this.authPasswordInput = document.getElementById(
      "auth-password",
    ) as HTMLInputElement;
    this.authBtnLogin = document.getElementById(
      "auth-btn-login",
    ) as HTMLButtonElement;
    this.authBtnRegister = document.getElementById(
      "auth-btn-register",
    ) as HTMLButtonElement;
    this.authStatus = document.getElementById("auth-status");
    this.banner = document.getElementById("system-banner");
    this.authUsernameInput?.focus();
    this.authModal?.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || this.authModal?.style.display === "none")
        return;
      const fields = Array.from(
        this.authModal!.querySelectorAll<HTMLElement>(
          "input:not(:disabled), button:not(:disabled)",
        ),
      ).filter((field) => field.getClientRects().length);
      const first = fields[0],
        last = fields.at(-1);
      if (!first || !last) return;
      if (!this.authModal!.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  showAuth(): void {
    const terminal = document.getElementById(
      "terminal-dialog",
    ) as HTMLDialogElement | null;
    if (terminal?.open) terminal.close();
    if (this.authModal) {
      this.authModal.style.display = "flex";
      this.authModal.removeAttribute("aria-hidden");
    }
    this.authUsernameInput?.focus();
  }

  hideAuth(): void {
    if (this.authModal) {
      this.authModal.style.display = "none";
      this.authModal.setAttribute("aria-hidden", "true");
    }
  }

  setAuthStatus(message: string, isError = false): void {
    if (!this.authStatus) return;
    this.authStatus.textContent = message;
    this.authStatus.style.color = isError ? "#ff4d6d" : "#00d2ff";
  }

  getCredentials(): { username: string; password: string } {
    return {
      username: this.authUsernameInput?.value.trim() ?? "",
      password: this.authPasswordInput?.value ?? "",
    };
  }

  setFormDisabled(disabled: boolean): void {
    if (this.authUsernameInput) this.authUsernameInput.disabled = disabled;
    if (this.authPasswordInput) this.authPasswordInput.disabled = disabled;
    if (this.authBtnLogin) this.authBtnLogin.disabled = disabled;
    if (this.authBtnRegister) this.authBtnRegister.disabled = disabled;
  }

  showBanner(
    message: string,
    type: "info" | "warning" | "error" = "info",
  ): void {
    if (!this.banner) return;
    this.banner.textContent = message;
    this.banner.style.display = "block";
    if (type === "error") {
      this.banner.style.backgroundColor = "rgba(239, 68, 68, 0.9)";
      this.banner.style.color = "#ffffff";
    } else if (type === "warning") {
      this.banner.style.backgroundColor = "rgba(245, 158, 11, 0.9)";
      this.banner.style.color = "#ffffff";
    } else {
      this.banner.style.backgroundColor = "rgba(15, 23, 42, 0.85)";
      this.banner.style.color = "#00d2ff";
    }
  }

  hideBanner(): void {
    if (this.banner) this.banner.style.display = "none";
  }

  bindAuthButtons(
    onLogin: (user: string, pass: string) => Promise<void>,
    onRegister: (user: string, pass: string) => Promise<void>,
  ): void {
    for (const field of [this.authUsernameInput, this.authPasswordInput])
      field?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !this.authBtnLogin?.disabled) {
          event.preventDefault();
          this.authBtnLogin?.click();
        }
      });
    this.authBtnLogin?.addEventListener("click", () => {
      const creds = this.getCredentials();
      onLogin(creds.username, creds.password);
    });

    this.authBtnRegister?.addEventListener("click", () => {
      const creds = this.getCredentials();
      onRegister(creds.username, creds.password);
    });
  }
}
