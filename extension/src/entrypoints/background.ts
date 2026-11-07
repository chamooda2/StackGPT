import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Msg } from '../lib/api';
import { createClient } from '../lib/client';

const API = import.meta.env.WXT_API_BASE ?? 'http://localhost:8080';
const ROUTED = new Set<Msg['type']>(['verify', 'attempt', 'vote', 'flag', 'submit']);

export default defineBackground(() => {
  const call = createClient(API, {
    get: async () => (await browser.storage.local.get('token')).token as string | undefined,
    set: async token => browser.storage.local.set({ token }),
  });

  browser.runtime.onMessage.addListener((msg: Msg, _sender, send) => {
    if (!msg || !ROUTED.has(msg.type)) return;
    call(msg).then(send);
    return true;
  });
});
