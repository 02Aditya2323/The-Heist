/** Feedback decorates committed server state; it never changes balances or actions. */
export function rewardFeedback(delta: number) {
  const wallet = document.querySelector<HTMLElement>('.wallet-total');
  if (!wallet || delta <= 0) return;
  const token = String(performance.now());
  wallet.dataset.rewardToken = token;
  wallet.dataset.reward = `+₹${(delta / 100).toFixed(2)}`;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    wallet.animate([{color:'#a4ecd6',transform:'translateY(0)'},{color:'#e5f4ed',transform:'translateY(-2px)'},{transform:'translateY(0)'}],{duration:380,easing:'ease-out'});
  setTimeout(() => { if (wallet.dataset.rewardToken === token) delete wallet.dataset.reward; }, 1400);
}
