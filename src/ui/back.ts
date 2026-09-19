// Back and Escape do what people expect: close what is open — they do not throw you out of the game.
//
// An open sheet owns one history entry, so the phone's Back button (or a swipe back) closes it. While playing there is
// one more entry underneath: the first Back on the bare game asks "again to leave", the second one leaves.
import { effect } from '@preact/signals';
import { modal, phase, toast } from '../state';

let sheetEntry = false, playEntry = false, ours = false, askedAt = 0;
const back = () => { ours = true; history.back(); };

export function installBack() {
  effect(() => {
    const open = modal.value != null;
    if (open && !sheetEntry) { sheetEntry = true; history.pushState({ mx: 'sheet' }, ''); }
    else if (!open && sheetEntry) { sheetEntry = false; back(); } // closed with its own button: drop the entry we added
  });
  effect(() => { if (phase.value === 'play' && !playEntry) { playEntry = true; history.pushState({ mx: 'play' }, ''); } });

  window.addEventListener('popstate', () => {
    if (ours) { ours = false; return; }
    if (sheetEntry) { sheetEntry = false; modal.value = null; return; }
    if (!playEntry) return;
    if (Date.now() - askedAt < 2500) { playEntry = false; back(); return; }
    askedAt = Date.now(); history.pushState({ mx: 'play' }, ''); toast('Press back again to leave', undefined, 'info', 2400);
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.value) { e.preventDefault(); modal.value = null; } });
}
