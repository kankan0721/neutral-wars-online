// 中和ウォーズ オンライン対戦の中継サーバー(Cloudflare Workers + Durable Objects)
// 部屋コードごとに Room(Durable Object)が1つでき、ホストとゲストのWebSocketをつないでメッセージを中継するだけ。
// ゲームの計算はホストのブラウザが行う。

export class Room {
  constructor(ctx, env) { this.ctx = ctx; }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const role = new URL(req.url).searchParams.get('role') === 'host' ? 'host' : 'guest';
    const socks = this.ctx.getWebSockets();
    const has = r => socks.some(ws => (ws.deserializeAttachment() || {}).role === r);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // 入れない時は、つないでから理由を送って閉じる(ブラウザはHTTPエラーの中身を読めないため)
    let err = '';
    if (role === 'host' && has('host')) err = 'この部屋コードは使われています。別のコードで作ってね';
    if (role === 'guest' && !has('host')) err = '部屋が見つかりません。コードを確認してね';
    if (role === 'guest' && has('guest')) err = 'この部屋はもう満員です';
    if (err) {
      server.send(JSON.stringify({ t: 'err', msg: err }));
      server.close(4000, 'rejected');
      return new Response(null, { status: 101, webSocket: client });
    }
    server.serializeAttachment({ role });
    for (const ws of socks) { try { ws.send(JSON.stringify({ t: 'peer', role })); } catch (e) {} }
    return new Response(null, { status: 101, webSocket: client });
  }

  // 片方から来たメッセージを、もう片方へそのまま送る
  webSocketMessage(ws, msg) {
    for (const o of this.ctx.getWebSockets()) if (o !== ws) { try { o.send(msg); } catch (e) {} }
  }

  webSocketClose(ws, code, reason) {
    const role = (ws.deserializeAttachment() || {}).role;
    for (const o of this.ctx.getWebSockets()) if (o !== ws) { try { o.send(JSON.stringify({ t: 'left', role })); } catch (e) {} }
    try { ws.close(1000, 'bye'); } catch (e) {}
  }

  webSocketError(ws) { this.webSocketClose(ws, 1011, 'error'); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,8})$/);
    if (!m) return new Response('neutral-wars online relay: ok', { headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' } });
    const id = env.ROOM.idFromName(m[1].toUpperCase());
    return env.ROOM.get(id).fetch(req);
  },
};
