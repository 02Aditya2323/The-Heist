/** One bounded, accessible presentation channel for server results and notices. */
export function notify(message: string, title = 'EVENT UPDATE', error = false) {
  let stack = document.getElementById('field-notifications');
  if (!stack) {
    stack = document.createElement('aside'); stack.id = 'field-notifications';
    stack.setAttribute('aria-live', 'polite'); stack.setAttribute('aria-label', 'Notifications'); document.body.append(stack);
  }
  const item = document.createElement('article'); item.dataset.error = String(error);
  const heading = document.createElement('strong'); heading.textContent = title;
  const text = document.createElement('p'); text.textContent = message;
  const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss notification'); dismiss.addEventListener('click', () => item.remove());
  item.append(heading, text, dismiss); stack.append(item);
  while (stack.children.length > 3) stack.firstElementChild?.remove();
  setTimeout(() => item.remove(), 6000);
}
