// A tiny page-level signal from the payment card (MockCheckout) to the
// checkout page's bundle state (CheckoutBundle): "the server says some
// add-ons sold out before this buyer could pay." The two components are
// siblings several layers apart (the payment buttons live deep inside
// MockCheckout), so an event keeps that wiring out of every component in
// between.
const EVENT = "checkout:addons-unavailable";

export function emitAddonsUnavailable(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function onAddonsUnavailable(handler: (message: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
