// LINE Messaging API の Webhook を受け取る Cloudflare Worker
import { handleText, HELP, QUICK_REPLIES } from './bot.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('kintore LINE bot is running');
    }
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }

    const body = await request.text();
    const ok = await verifySignature(body, request.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET);
    if (!ok) return new Response('Invalid signature', { status: 401 });

    let events;
    try {
      events = JSON.parse(body).events || [];
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    // LINEには先に200を返し、返信は裏で行う
    ctx.waitUntil(Promise.all(events.map((ev) => handleEvent(ev, env).catch((err) => {
      console.error('event failed', err && err.stack || err);
    }))));
    return new Response('OK');
  },
};

async function handleEvent(ev, env) {
  if (!ev.replyToken) return;
  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  let text;
  if (ev.type === 'follow') {
    text = '友だち追加ありがとうございます！\n\n' + HELP;
  } else if (ev.type === 'message' && ev.message.type === 'text') {
    text = await handleText(env.DB, userId, ev.message.text);
  } else if (ev.type === 'message') {
    text = 'テキストで送ってください。\n例: ベンチ60kg×8回';
  } else {
    return;
  }
  await reply(env, ev.replyToken, text);
}

async function reply(env, replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: 'text',
        text: text.slice(0, 5000),
        quickReply: {
          items: QUICK_REPLIES.map((label) => ({ type: 'action', action: { type: 'message', label, text: label } })),
        },
      }],
    }),
  });
  if (!res.ok) console.error('LINE reply failed', res.status, await res.text());
}

// x-line-signature = base64(HMAC-SHA256(チャネルシークレット, 本文))
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  let expected;
  try {
    expected = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (expected.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ expected[i];
  return diff === 0;
}
