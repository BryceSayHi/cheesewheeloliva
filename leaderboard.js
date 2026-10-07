// Infinite Hyperdeath leaderboard (Firebase Auth anonymous + Firestore)
// 1 point per Frank kill. Daily/weekly count kills in that period (UTC); lifetime is your saved HIGH SCORE.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  getFirestore, doc, collection, query, orderBy, limit, getDocs, getDoc,
  writeBatch, updateDoc, increment, serverTimestamp
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

// ---- submit: daily/weekly +1 per kill, lifetime follows your saved score; one write at a time ----
let chain = Promise.resolve();
let lastErr = "", renameErr = ""; // shown on the leaderboard screen so failures aren't silent
function win(total) {
  chain = chain.then(async () => {
    try {
      const uid = await getUid();
      const name = String((window.getName && window.getName()) || "???").trim().slice(0, 16) || "???";
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

// ---- rename: updates your name on the current daily/weekly/lifetime boards ----
// (older daily/weekly boards keep the name you had back then)
async function rename(raw) {
  const name = String(raw || "").trim().slice(0, 16);
  if (!name) return;
  try {
    const uid = await getUid();
    const errs = [];
    await Promise.all(Object.values(boardIds()).map(async id => {
      const ref = doc(db, "boards", id, "entries", uid);
      try {
        if ((await getDoc(ref)).exists()) await updateDoc(ref, { name }); // skip boards you aren't on yet
      } catch (e) { errs.push(e.code || e.message || String(e)); }
    }));
    if (errs.length) { lastErr = "rename: " + errs[0]; console.warn("leaderboard rename failed", errs); }
    else lastErr = "";
  } catch (e) {
    lastErr = "rename: " + (e.code || e.message || String(e));
    console.warn("leaderboard rename failed", e);
  }
  if ($("lb").style.display !== "none") render();
}

// short tag from your unique id so same-named players can be told apart
const tagOf = uid => uid.slice(0, 4).toUpperCase();

// ---- read + render ----
async function top(boardId) {
  const q = query(collection(db, "boards", boardId, "entries"), orderBy("score", "desc"), limit(10));
  return (await getDocs(q)).docs.map(d => ({ uid: d.id, ...d.data() }));
}

const $ = id => document.getElementById(id);
let tab = "daily", reqN = 0;

function msg(text) {
  const d = document.createElement("div");
  d.className = "lbmsg";
  d.textContent = text;
  const l = $("lbList");
  l.replaceChildren(d);
}

async function render() {
  const n = ++reqN;
  [["daily", "lbD"], ["weekly", "lbW"], ["lifetime", "lbL"]].forEach(([k, id]) =>
    $(id).classList.toggle("on", k === tab));
  msg("loading...");
  try {
    const [rows, me] = await Promise.all([top(boardIds()[tab]), getUid().catch(() => null)]);
    if (n !== reqN) return; // a newer tab click won
    const myName = window.getName && window.getName();
    $("lbYou").textContent = "you: " + (myName || "(no name yet)") + (me ? " #" + tagOf(me) : "") + (lastErr ? "  |  last save failed: " + lastErr : "") + (renameErr ? "  |  rename failed: " + renameErr : "") + "  |  lb.js name16";
    if (!rows.length) return msg("nobody yet. be the first.");
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "lbr" + (r.uid === me ? " me" : "");
      const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = i + 1 + ".";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name; // textContent: names are user input
      const tg = document.createElement("span"); tg.className = "lbtag"; tg.textContent = "#" + tagOf(r.uid);
      nm.append(tg);
      const sc = document.createElement("span"); sc.textContent = r.score;
      row.append(rk, nm, sc);
      frag.append(row);
    });
    $("lbList").replaceChildren(frag);
  } catch (e) {
    console.warn("leaderboard load failed", e);
    if (n === reqN) msg("couldn't load: " + (e.code || e.message || e));
  }
}

$("lbD").onclick = () => { tab = "daily"; render(); };
$("lbW").onclick = () => { tab = "weekly"; render(); };
$("lbL").onclick = () => { tab = "lifetime"; render(); };

window.LB = { win, rename, open: render };
