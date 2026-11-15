// FÁBRICA WEBER AL LÍMITE - © 2026 Creado y diseñado por FerLudu
const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app);
const io = new Server(srv, { pingInterval: 10000, pingTimeout: 8000, perMessageDeflate: false });
app.use(express.static(__dirname + '/public'));

const T = {}; // mesas
const G = { run: false, end: 0, sab: false, round: 0 };
const newBuf = () => ({ mix: 0, qc: 0, pal: 0, on: 0 });
const tb = k => T[k] || (T[k] = { n: k, P: {}, c: 0, buf: newBuf(), score: 0, pals: 0, st: 0, sab: 0, fx: null, fxEnd: 0, bot: [0, 0, 0, 0] });
const active = t => Object.keys(t.P).length > 0;
const seatOf = p => (p.i + G.round) % 4;

function act(t, a, good) {
  const b = t.buf;
  if ((a === 'dose' || a === 'mix') && t.fx === 'jam' && Math.random() < 0.5) return;
  if (a === 'dose') { if (b.mix < 3) b.mix++; }
  else if (a === 'mix') { if (b.mix > 0) { b.mix--; b.qc += 5; } }
  else if (a === 'qc') { if (b.qc > 0) { b.qc--; if (good) b.pal++; } }
  else if (a === 'place') { if (b.pal > 0 && b.on < 4) { b.pal--; b.on++; } }
  else if (a === 'truck') { if (b.on >= 4) { b.on -= 4; t.score += 100; t.pals++; t.st++; if (t.st % 2 === 0) t.sab++; } }
}

io.on('connection', s => {
  s.on('screen', () => s.join('screen'));
  s.on('join', ({ name, mesa } = {}) => {
    name = String(name || '').trim().slice(0, 18); mesa = String(mesa || '').trim().slice(0, 20);
    if (!name || !mesa) return s.emit('err', 'Falta nombre o mesa');
    if (!T[mesa] && Object.keys(T).length >= 40) return s.emit('err', 'Demasiadas mesas');
    const t = tb(mesa);
    if (Object.keys(t.P).length >= 10) return s.emit('err', 'Mesa completa (máx. 10)');
    t.P[s.id] = { name, i: t.c++ }; s.mesa = mesa; s.join('m' + mesa);
    s.emit('joined', { mesa, id: s.id });
  });
  s.on('act', ({ a, good } = {}) => { const t = T[s.mesa]; if (t && G.run && t.P[s.id]) act(t, a, !!good); });
  s.on('sab', ({ type } = {}) => {
    const t = T[s.mesa];
    if (!t || !G.run || !G.sab || t.sab < 1 || !['prl', 'jam', 'vip'].includes(type)) return;
    const others = Object.values(T).filter(x => x !== t && active(x));
    if (!others.length) return;
    const lead = others.slice().sort((a, b) => b.score - a.score)[0];
    const top = Object.values(T).filter(active).sort((a, b) => b.score - a.score)[0];
    const tg = (top !== t && top.score > 0) ? top : others[Math.floor(Math.random() * others.length)];
    t.sab--; tg.fx = type; tg.fxEnd = Date.now() + 4000;
    io.to('screen').emit('alert', { from: t.n, to: tg.n, type });
  });
  s.on('host', cmd => {
    if (!s.rooms.has('screen')) return;
    if (cmd === 'start') {
      G.run = true; G.end = Date.now() + 120000; G.round++;
      Object.values(T).forEach(t => { t.buf = newBuf(); t.st = 0; t.sab = 0; t.fx = null; });
    } else if (cmd === 'sabotage') G.sab = !G.sab;
    else if (cmd === 'reset') { G.run = false; G.round = 0; Object.values(T).forEach(t => { t.score = 0; t.pals = 0; t.st = 0; t.sab = 0; t.buf = newBuf(); t.fx = null; }); }
  });
  s.on('disconnect', () => {
    const t = T[s.mesa]; if (!t) return;
    delete t.P[s.id];
    if (!active(t) && t.score === 0) delete T[s.mesa];
  });
});

setInterval(() => {
  const now = Date.now();
  if (G.run && now >= G.end) { G.run = false; io.emit('over'); }
  const left = G.run ? Math.max(0, G.end - now) : 0;
  const tables = Object.values(T), act_ = tables.filter(active);
  for (const t of act_) {
    if (t.fx && now > t.fxEnd) t.fx = null;
    const seats = {}, cov = [0, 0, 0, 0];
    for (const id in t.P) { const sd = seatOf(t.P[id]); seats[id] = sd; cov[sd] = 1; }
    if (G.run) for (let k = 0; k < 4; k++) if (!cov[k] && now > t.bot[k]) {
      t.bot[k] = now + (1300 + Math.random() * 900) * (t.fx === 'jam' ? 1.8 : 1);
      if (k === 0) act(t, 'dose'); else if (k === 1) act(t, 'mix');
      else if (k === 2) act(t, 'qc', Math.random() > 0.2);
      else act(t, t.buf.on >= 4 ? 'truck' : 'place');
    }
    io.to('m' + t.n).volatile.emit('t', { run: G.run, left, sab: G.sab, round: G.round, buf: t.buf, score: t.score, pals: t.pals, sabN: t.sab, fx: t.fx, seats, n: t.n });
  }
  const rank = tables.filter(t => active(t) || t.score).sort((a, b) => b.score - a.score).slice(0, 10).map(t => ({ n: t.n, s: t.score, p: t.pals, fx: t.fx }));
  io.to('screen').volatile.emit('state', { run: G.run, left, sab: G.sab, round: G.round, rank, tables: act_.length, players: io.engine.clientsCount });
}, 150);

srv.listen(process.env.PORT || 3000, () => console.log('FÁBRICA WEBER AL LÍMITE en puerto ' + (process.env.PORT || 3000)));
