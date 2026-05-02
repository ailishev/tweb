import AccountController from '@lib/accounts/accountController';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import type {TrueDcId} from '@types';
import backendApi from '@lib/backendApi';
import {backendUuidToUserPeerId} from '@lib/backendPeerIds';
import bytesToHex from '@helpers/bytes/bytesToHex';
import randomize from '@helpers/array/randomize';
import Modes from '@config/modes';

/**
 * When using backend auth, align Telegram account session userId with deterministic backend peer id
 * before worker/state load (sessionStorage has no access from worker — token is synced separately).
 */
export async function syncBackendAccountBeforeLoadStates(): Promise<boolean> {
  if(!Modes.backend) {
    return false;
  }

  let token = '';
  try {
    token = localStorage.getItem('db_token') || '';
  } catch(err) {}

  if(!token) {
    return false;
  }

  const me = await backendApi.me();
  if(!me.ok || !me.data?.id) {
    return false;
  }

  const userId = backendUuidToUserPeerId(me.data.id);
  const rndKey = bytesToHex(randomize(new Uint8Array(256)));

  await AccountController.update(getCurrentAccount(), {
    userId,
    dcId: 2 as TrueDcId,
    date: Math.floor(Date.now() / 1000),
    dc2_auth_key: rndKey,
    dc2_server_salt: 'AAAAAAAAAAAAAAAA'
  });

  return true;
}
