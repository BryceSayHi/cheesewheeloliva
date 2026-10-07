// Infinite Hyperdeath leaderboard (Firebase Auth anonymous + Firestore)
// 1 point per Frank kill. Daily/weekly count kills in that period (UTC); lifetime is your saved HIGH SCORE.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  getFirestore, doc, collection, query, orderBy, limit, getDocs, getDoc,
  writeBatch, updateDoc, increment, serverTimestamp, startAfter, where, getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZPKjpq2XdLXHJoJ53BEmWDaRS10_zcjk",
  authDomain: "oliva-leaderboard.firebaseapp.com",
  projectId: "oliva-leaderboard",
  storageBucket: "oliva-leaderboard.firebasestorage.app",
  messagingSenderId: "926111324483",
  appId: "1:926111324483:web:b34053da68a43665ee77f6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- identity: anonymous sign-in, uid is remembered by the browser ----
let uidP = null;
function getUid() {
  if (!uidP) {
    uidP = (async () => {
      await auth.authStateReady();
      return (auth.currentUser || (await signInAnonymously(auth)).user).uid;
    })().catch(e => { uidP = null; throw e; });
  }
  return uidP;
}

// ---- board ids (UTC so everyone's day/week rolls over at the same moment) ----
const pad = n => String(n).padStart(2, "0");
function dayKey(d = new Date()) {
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
function weekKey(d = new Date()) { // ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return y + "-W" + pad(w);
}
const boardIds = () => ({
  daily: "daily-" + dayKey(),
  weekly: "weekly-" + weekKey(),
  lifetime: "lifetime"
});

// ---- unique names: names/{lowercase name} -> your uid, players/{uid} -> your current name ----
const NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9 _.-]*[A-Za-z0-9])?$/;
const cleanName = raw => String(raw || "").trim().replace(/\s+/g, " ");
const nameOk = n => n.length >= 1 && n.length <= 16 && NAME_RE.test(n);
let regName = null; // the name already confirmed as registered to you this session

// Try to register `raw` as your name. -> { ok:true, name } | { ok:false, err:"taken"|"invalid"|"net" }
async function claim(raw) {
  const name = cleanName(raw);
  if (!nameOk(name)) return { ok: false, err: "invalid" };
  const key = name.toLowerCase();
  let uid, p, n;
  try {
    uid = await getUid();
    [p, n] = await Promise.all([getDoc(doc(db, "players", uid)), getDoc(doc(db, "names", key))]);
  } catch (e) {
    console.warn("name check failed", e);
    return { ok: false, err: "net", code: e.code };
  }
  if (n.exists() && n.data().uid !== uid) return { ok: false, err: "taken" };
  if (p.exists() && p.data().name === name) { regName = name; return { ok: true, name }; }
  const oldKey = p.exists() ? p.data().key : null;
  try {
    const batch = writeBatch(db);
    if (!n.exists()) batch.set(doc(db, "names", key), { uid, name, updatedAt: serverTimestamp() });
    if (oldKey && oldKey !== key) batch.delete(doc(db, "names", oldKey)); // frees your old name
    batch.set(doc(db, "players", uid), { name, key, updatedAt: serverTimestamp() });
    for (const id of Object.values(boardIds())) { // carry the new name onto boards you're already on
      const ref = doc(db, "boards", id, "entries", uid);
      if ((await getDoc(ref)).exists()) batch.update(ref, { name });
    }
    await batch.commit();
    regName = name;
    return { ok: true, name };
  } catch (e) {
    console.warn("name claim failed", e);
    return { ok: false, err: e.code === "permission-denied" ? "taken" : "net", code: e.code };
  }
}

// Make sure the name saved in the game is the one registered to you.
// If it's taken (or not allowed) the saved name is cleared so the game asks for a new one.
async function ensure() {
  const local = cleanName(window.getName && window.getName());
  if (!local) return { ok: false, err: "none" };
  if (regName === local) return { ok: true, name: local };
  const r = await claim(local);
  if (!r.ok && (r.err === "taken" || r.err === "invalid") && window.setName) window.setName("");
  return r;
}

// ---- submit: daily/weekly +1 per kill, lifetime follows your saved score; one write at a time ----
let chain = Promise.resolve();
let lastErr = ""; // not shown on screen; failures go to the console
function win(total) {
  chain = chain.then(async () => {
    try {
      const reg = await ensure();
      if (!reg.ok) { lastErr = "name: " + reg.err; return; }
      const name = reg.name;
      const uid = await getUid();
      const ids = boardIds();
      const ref = id => doc(db, "boards", id, "entries", uid);
      const batch = writeBatch(db);
      // daily + weekly: +1 per kill
      for (const id of [ids.daily, ids.weekly]) {
        batch.set(ref(id), { name, score: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      }
      // lifetime: follows the game's own saved HIGH SCORE (so kills from before the leaderboard count),
      // but always goes up by at least 1
      const cur = await getDoc(ref(ids.lifetime));
      const have = cur.exists() ? (cur.data().score | 0) : 0;
      const life = Math.min(10000, Math.max(have + 1, total | 0));
      if (life > have) batch.set(ref(ids.lifetime), { name, score: life, updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
      lastErr = "";
    } catch (e) {
      lastErr = e.code || e.message || String(e);
      console.warn("leaderboard submit failed", e);
    }
  });
}

// short tag from your unique id so same-named players can be told apart
const tagOf = uid => uid.slice(0, 4).toUpperCase();

// ---- read + render (10 per page; page controls only appear once there's more than one page) ----
const PAGE = 10;
const $ = id => document.getElementById(id);
let tab = "daily", reqN = 0, page = 0, curs = [null]; // curs[p] = last entry of page p-1 (where page p starts)

const entriesOf = id => collection(db, "boards", id, "entries");

// how many entries have a higher score than this (ties share a place)
async function countHigher(boardId, score) {
  const q = query(entriesOf(boardId), where("score", ">", score), limit(10000));
  return (await getCountFromServer(q)).data().count;
}

function rowEl(rank, name, uid, score, me) {
  const row = document.createElement("div");
  row.className = "lbr" + (me ? " me" : "");
  const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = rank + ".";
  const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = name; // textContent: names are user input
  const tg = document.createElement("span"); tg.className = "lbtag"; tg.textContent = "#" + tagOf(uid);
  nm.append(tg);
  const sc = document.createElement("span"); sc.textContent = score;
  row.append(rk, nm, sc);
  return row;
}

function msg(text) {
  const d = document.createElement("div");
  d.className = "lbmsg";
  d.textContent = text;
  $("lbRows").replaceChildren(d);
}

async function render() {
  const n = ++reqN;
  [["daily", "lbD"], ["weekly", "lbW"], ["lifetime", "lbL"]].forEach(([k, id]) =>
    $(id).classList.toggle("on", k === tab));
  $("lbPin").style.display = "none";
  msg("loading...");
  const boardId = boardIds()[tab];
  try {
    const start = curs[page] || null;
    const q = query(entriesOf(boardId), orderBy("score", "desc"), ...(start ? [startAfter(start)] : []), limit(PAGE + 1));
    const [snap, me] = await Promise.all([getDocs(q), getUid().catch(() => null)]);
    if (n !== reqN) return; // a newer click won
    const hasNext = snap.docs.length > PAGE;
    const pageDocs = snap.docs.slice(0, PAGE);
    if (hasNext) curs[page + 1] = pageDocs[pageDocs.length - 1];
    const rows = pageDocs.map(d => ({ uid: d.id, ...d.data() }));

    const myName = window.getName && window.getName();
    $("lbYou").textContent = "you: " + (myName || "(no name yet)");

    // page controls: only once there's more than one page
    $("lbPager").style.display = (page > 0 || hasNext) ? "flex" : "none";
    $("lbPg").textContent = "page " + (page + 1);
    $("lbPrev").disabled = page === 0;
    $("lbNext").disabled = !hasNext;

    if (!rows.length) return msg(page ? "no more entries." : "nobody yet. be the first.");

    // places (ties share a place)
    const ranks = [];
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) ranks[i] = rows[i].score === rows[i - 1].score ? ranks[i - 1] : page * PAGE + i + 1;
      else if (page > 0 && curs[page] && curs[page].data().score === rows[0].score) {
        try { ranks[0] = (await countHigher(boardId, rows[0].score)) + 1; }
        catch (e) { ranks[0] = page * PAGE + 1; }
      } else ranks[0] = page * PAGE + 1;
    }
    if (n !== reqN) return;
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => frag.append(rowEl(ranks[i], r.name, r.uid, r.score, r.uid === me)));
    $("lbRows").replaceChildren(frag);

    // your own place, pinned under the list whenever you're not on the page being shown
    if (me && !rows.some(r => r.uid === me)) {
      try {
        const mine = await getDoc(doc(db, "boards", boardId, "entries", me));
        if (mine.exists() && n === reqN) {
          const sc = mine.data().score;
          const place = (await countHigher(boardId, sc)) + 1;
          if (n === reqN) {
            $("lbPin").replaceChildren(rowEl(place, mine.data().name, me, sc, true));
            $("lbPin").style.display = "block";
          }
        }
      } catch (e) {
        console.warn("place lookup failed", e);
      }
    }
  } catch (e) {
    console.warn("leaderboard load failed", e);
    if (n === reqN) msg("couldn't load: " + (e.code || e.message || e));
  }
}

const goTab = t => { tab = t; page = 0; curs = [null]; render(); };
$("lbD").onclick = () => goTab("daily");
$("lbW").onclick = () => goTab("weekly");
$("lbL").onclick = () => goTab("lifetime");
$("lbPrev").onclick = () => { if (page > 0) { page--; render(); } };
$("lbNext").onclick = () => { page++; render(); };

window.LB = { win, claim, ensure, open: () => { page = 0; curs = [null]; render(); } };
