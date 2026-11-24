/**
 * Folhas de baixo do celular (<dialog class="more-sheet">: menu "Mais" e filtros).
 * Fecha com a animação de saída: põe a classe "closing" (o CSS anima 180 ms) e só então chama close() do <dialog>,
 * que sozinho some na hora. Com movimento reduzido o CSS zera a animação; a espera é a mesma.
 */
export const SHEET_CLOSE_MS = 180;

export function closeSheet(d: HTMLDialogElement | null) {
  if (!d || !d.open || d.classList.contains("closing")) return;
  d.classList.add("closing");
  window.setTimeout(() => {
    d.classList.remove("closing");
    if (d.open) d.close();
  }, SHEET_CLOSE_MS);
}
