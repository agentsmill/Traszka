import type { ApiErrorCode } from '@/server/errors';
import type { NICK_ERRORS } from '@/game/nick';
import type { RECOVERY_ERRORS } from '@/game/playerKey';

/*
 * Komunikaty API rankingu po angielsku, po kodzie błędu (`API_ERRORS` w `src/server/errors.ts`). Serwer zostaje po polsku (to
 * kontrakt API i to, co widzą logi); gra pokazuje komunikat w języku gracza: polski tekst z odpowiedzi rozpoznaje po kodzie
 * (`apiErrorText`) albo po samym tekście (`tr`), bo modele rankingu trzymają tylko tekst. Do tego reguły nicka i kodu odzyskiwania,
 * które serwer też odsyła w `message`.
 */

export const EN_API_ERRORS: Record<ApiErrorCode, string> = {
  'bad-request': 'Head Office can’t make sense of this submission. Please fill in the form again, legibly.',
  'too-large': 'This submission is thicker than the binder with the franchise agreement.',
  'bad-key': 'The player key is unreadable. Check your recovery code.',
  'bad-nick': 'That name won’t do.',
  'nick-taken': 'That name is taken',
  'bad-seed': 'This seed can’t be shown on the leaderboard.',
  'bad-log': 'The command log doesn’t add up. Head Office doesn’t accept reports written in pencil.',
  'not-ranked': 'Only ranked mode counts for the leaderboard: September to November, no network bonuses.',
  'old-version': 'This version of the game is out of date. Refresh the page: Head Office has issued a new rulebook.',
  'replay-failed': 'Replaying the run failed, so there’s no score. Head Office apologises (formally).',
  'season-bankrupt': 'A season that ended in bankruptcy doesn’t go on the leaderboard.',
  'replay-unavailable': 'Head Office’s referee is still in training. Ranked results will be accepted soon.',
  'rate-limited': 'Too many submissions at once. Head Office asks for patience (and coffee).',
  'bad-save': 'That doesn’t look like a saved game.',
  'save-too-large': 'The save is larger than 64 KB, and Head Office only has one drawer per player.',
  'save-budget': 'All of Head Office’s drawers are full for today. Send your save tomorrow.',
  'save-conflict': 'There’s a newer copy of the save on the server that this device hasn’t seen yet.',
  'no-save': 'There’s no save under this code in Head Office’s drawer.',
  'bad-board': 'No such leaderboard. Head Office runs global, seed and weekly ones.',
  'method': 'That method doesn’t work here.',
  'ranking-off': 'Head Office’s leaderboard hasn’t opened yet.',
  'not-configured': 'The leaderboard isn’t working yet: Head Office hasn’t plugged in the database.',
  'server': 'Something went wrong on Head Office’s end. Try again in a moment.',
};

export const EN_NICK_ERRORS: Record<keyof typeof NICK_ERRORS, string> = {
  length: 'A name can be 1 to 20 characters long',
  chars: 'Allowed: letters, digits, spaces and _ - .',
  reserved: 'That name is reserved',
};

export const EN_KEY_ERRORS: Record<keyof typeof RECOVERY_ERRORS, string> = {
  invalid: 'That isn’t a recovery code: 20 letters and digits, e.g. K7QX-9MBD-2HFA-P3WN-8RTE',
  noPlayer: 'Open a shop first: the code belongs to your cashier',
  readOnly: 'This tab has player data from a newer version of the game, so the code can’t be saved here. Refresh the page.',
};
