/** The demo sign-in plays once per browser session, not on every page load. */
export function signedInThisSession(): boolean {
  try {
    return window.sessionStorage.getItem('gd-demo-seen') === '1';
  } catch {
    return false;
  }
}

export function markSignedIn(): void {
  try {
    window.sessionStorage.setItem('gd-demo-seen', '1');
  } catch {
    /* storage disabled: ask again next load */
  }
}
