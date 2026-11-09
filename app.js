(() => {
  "use strict";

  /* ---------- Données ---------- */
  const LS_KEY = "piixelie-dashboard-v1";
  const STREAM_STEPS = [
    ["clips", "Clips réalisés"],
    ["downloaded", "Importé sur le PC"],
    ["thumb", "Miniature faite"],
    ["rediff", "Rediff YouTube programmée"],
  ];
  const CLIP_DRAFTS = [
    ["draftShorts", "Brouillon Short"],
    ["draftReels", "Brouillon Insta"],
    ["draftTiktok", "Brouillon TikTok"],
  ];
  const CLIP_PLATFORMS = [
    ["shorts", "Short YouTube"],
    ["reels", "Reel Instagram"],
    ["tiktok", "TikTok"],
  ];

  let data = { updatedAt: 0, streams: [], clips: [] };
  let fileHandle = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- IndexedDB (copie de secours + mémoire du fichier lié) ---------- */
  const idb = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("piixelie", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => { idb.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    get(k) {
      return new Promise((res) => {
        try {
          const q = idb.db.transaction("kv").objectStore("kv").get(k);
          q.onsuccess = () => res(q.result);
          q.onerror = () => res(undefined);
        } catch { res(undefined); }
      });
    },
    set(k, v) {
      return new Promise((res) => {
        try {
          const t = idb.db.transaction("kv", "readwrite");
          t.objectStore("kv").put(v, k);
          t.oncomplete = () => res(true);
          t.onerror = () => res(false);
        } catch { res(false); }
      });
    },
  };

  /* ---------- Sauvegarde ---------- */
  const normalize = (d) => ({
    updatedAt: Number(d?.updatedAt) || 0,
    streams: Array.isArray(d?.streams) ? d.streams : [],
    clips: Array.isArray(d?.clips) ? d.clips : [],
  });

  async function writeFile() {
    if (!fileHandle) return;
    try {
      const w = await fileHandle.createWritable();
      await w.write(JSON.stringify(data, null, 2));
      await w.close();
      setSync(true, "Fichier synchronisé");
    } catch {
      setSync(false, "Fichier à reconnecter");
    }
  }

  /* touch = false quand les données viennent d'ailleurs (fichier, cloud) : on garde leur date. */
  async function persist(touch = true) {
    if (touch) data.updatedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
    await idb.set("data", data);
    await writeFile();
    if (touch) cloudSchedule();
  }

  async function readFile() {
    const f = await fileHandle.getFile();
    const txt = await f.text();
    return txt.trim() ? normalize(JSON.parse(txt)) : null;
  }

  /* On garde toujours la version la plus récente entre navigateur et fichier. */
  async function loadAll() {
    await idb.open().catch(() => {});
    let local = null;
    try { local = normalize(JSON.parse(localStorage.getItem(LS_KEY))); } catch {}
    const fromIdb = idb.db ? await idb.get("data") : null;
    const candidates = [local, fromIdb ? normalize(fromIdb) : null].filter(Boolean);
    data = candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0] || data;

    fileHandle = idb.db ? await idb.get("handle") : null;
    if (fileHandle) {
      try {
        if ((await fileHandle.queryPermission({ mode: "readwrite" })) === "granted") {
          const fromFile = await readFile();
          if (fromFile && fromFile.updatedAt > data.updatedAt) data = fromFile;
          await persist(false);
        } else {
          setSync(false, "Fichier à reconnecter");
        }
      } catch { setSync(false, "Fichier à reconnecter"); }
    }
    if (navigator.storage?.persist) navigator.storage.persist();
  }

  const fileState = { ok: false, label: "Sauvegarde locale" };
  const cloudState = { ok: false, label: "" };
  let user = null;

  function updatePill() {
    const s = user && cloudState.label ? cloudState : fileState;
    $("#syncLabel").textContent = s.label;
    $("#syncDot").classList.toggle("ok", s.ok);
  }
  function setSync(linked, label) {
    fileState.ok = linked; fileState.label = label;
    updatePill();
  }

  /* ---------- Rendu ---------- */
  const fmtWhen = (date, time) => {
    const d = new Date(`${date}T${time || "00:00"}`);
    if (isNaN(d)) return "";
    const day = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `${day} à ${time.replace(":", "h")}`;
  };

  /* Les VOD Twitch des non-affiliés expirent 7 jours après le stream. */
  const VOD_DAYS = 7;
  function vodInfo(s) {
    if (s.clips && s.downloaded) return { cls: "safe", text: "VOD sauvegardée, plus de risque" };
    const start = new Date(`${s.date}T${s.time || "00:00"}`).getTime();
    if (isNaN(start)) return null;
    const left = start + VOD_DAYS * 864e5 - Date.now();
    if (left <= 0) return { cls: "expired", text: "VOD expirée" };
    const hours = Math.ceil(left / 36e5);
    const text = hours >= 24 ? `VOD expire dans ${Math.floor(hours / 24)} j ${hours % 24} h` : `VOD expire dans ${hours} h`;
    return { cls: hours <= 48 ? "urgent" : "", text };
  }

  function chip(kind, id, key, label, checked) {
    return `<label class="chip"><input type="checkbox" data-kind="${kind}" data-id="${id}" data-key="${key}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  }

  function renderStreams() {
    const todoOnly = $("#streamTodo").checked;
    const all = [...data.streams].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
    const done = (s) => STREAM_STEPS.every(([k]) => s[k]);
    const list = todoOnly ? all.filter((s) => !done(s)) : all;
    const urgent = all.filter((s) => vodInfo(s)?.cls === "urgent").length;
    $("#streamCount").textContent = `${all.filter(done).length} terminé(s) sur ${all.length}` + (urgent ? `, dont ${urgent} VOD à sauver vite` : "");
    $("#streamList").innerHTML = list.length
      ? list.map((s) => {
          const n = STREAM_STEPS.filter(([k]) => s[k]).length;
          const vod = vodInfo(s);
          return `<article class="card ${n === STREAM_STEPS.length ? "complete" : ""}">
            <div class="head">
              <div><h3>${esc(s.title)}</h3><p class="when">${esc(fmtWhen(s.date, s.time))}</p>${vod ? `<p class="vod ${vod.cls}">${vod.text}</p>` : ""}</div>
              <button class="del" data-del="streams" data-id="${s.id}" aria-label="Supprimer ${esc(s.title)}">Supprimer</button>
            </div>
            <div class="meter" aria-hidden="true"><i style="width:${(n / STREAM_STEPS.length) * 100}%"></i></div>
            <div class="chips">${STREAM_STEPS.map(([k, l]) => chip("streams", s.id, k, l, s[k])).join("")}</div>
          </article>`;
        }).join("")
      : `<p class="empty">${todoOnly ? "Rien à finir, tout est prêt." : "Aucun stream pour l'instant. Ajoute le dernier que tu as réalisé."}</p>`;
  }

  function renderClips() {
    const todoOnly = $("#clipTodo").checked;
    const done = (c) => CLIP_PLATFORMS.every(([k]) => c[k]);
    const all = [...data.clips].sort((a, b) => b.createdAt - a.createdAt);
    const list = todoOnly ? all.filter((c) => !done(c)) : all;
    $("#clipCount").textContent = `${all.filter(done).length} publié(s) partout sur ${all.length}`;
    const streamName = (id) => data.streams.find((s) => s.id === id)?.title;
    $("#clipList").innerHTML = list.length
      ? list.map((c) => {
          const n = CLIP_PLATFORMS.filter(([k]) => c[k]).length;
          const origin = streamName(c.streamId);
          return `<article class="card ${n === CLIP_PLATFORMS.length ? "complete" : ""}">
            <div class="head">
              <div><h3>${esc(c.name)}</h3>${origin ? `<p class="origin">Stream : ${esc(origin)}</p>` : ""}</div>
              <button class="del" data-del="clips" data-id="${c.id}" aria-label="Supprimer ${esc(c.name)}">Supprimer</button>
            </div>
            <p class="group-label">Brouillons créés</p>
            <div class="chips">${CLIP_DRAFTS.map(([k, l]) => chip("clips", c.id, k, l, c[k])).join("")}</div>
            <p class="group-label">Publiés</p>
            <div class="chips">${CLIP_PLATFORMS.map(([k, l]) => chip("clips", c.id, k, l, c[k])).join("")}</div>
          </article>`;
        }).join("")
      : `<p class="empty">${todoOnly ? "Tous tes clips sont publiés." : "Aucun clip pour l'instant. Ajoute ton premier extrait."}</p>`;
  }

  function renderSelect() {
    const sel = $("#cStream");
    const cur = sel.value;
    const streams = [...data.streams].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
    sel.innerHTML = `<option value="">Aucun</option>` + streams.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("");
    sel.value = streams.some((s) => s.id === cur) ? cur : "";
  }

  function render() { renderStreams(); renderClips(); renderSelect(); }

  /* ---------- Actions ---------- */
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function setNowDefaults() {
    const n = new Date();
    const p = (x) => String(x).padStart(2, "0");
    $("#sDate").value = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
    $("#sTime").value = `${p(n.getHours())}:${p(n.getMinutes())}`;
  }

  $("#streamForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    data.streams.push({ id: uid(), title: $("#sTitle").value.trim(), date: $("#sDate").value, time: $("#sTime").value, clips: false, downloaded: false, thumb: false, rediff: false });
    $("#sTitle").value = "";
    await persist(); render(); toast("Stream ajouté");
  });

  $("#clipForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    data.clips.push({ id: uid(), name: $("#cName").value.trim(), streamId: $("#cStream").value, createdAt: Date.now(), draftShorts: false, draftReels: false, draftTiktok: false, shorts: false, reels: false, tiktok: false });
    $("#cName").value = "";
    await persist(); render(); toast("Clip ajouté");
  });

  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (!el.dataset?.kind) return;
    const item = data[el.dataset.kind].find((x) => x.id === el.dataset.id);
    if (!item) return;
    item[el.dataset.key] = el.checked;
    await persist(); render();
    const focus = document.querySelector(`[data-kind="${el.dataset.kind}"][data-id="${el.dataset.id}"][data-key="${el.dataset.key}"]`);
    focus?.focus();
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    if (!confirm("Supprimer définitivement cet élément ?")) return;
    data[b.dataset.del] = data[b.dataset.del].filter((x) => x.id !== b.dataset.id);
    await persist(); render(); toast("Supprimé");
  });

  $("#streamTodo").addEventListener("change", renderStreams);
  $("#clipTodo").addEventListener("change", renderClips);

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => { const on = x === t; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
    $("#tab-streams").hidden = t.dataset.tab !== "streams";
    $("#tab-clips").hidden = t.dataset.tab !== "clips";
  }));

  /* ---------- Fenêtre de sauvegarde ---------- */
  const canLink = "showSaveFilePicker" in window;
  const dlg = $("#syncDialog");
  function refreshDialog() {
    $("#fileStatus").textContent = fileHandle ? `Fichier lié : ${fileHandle.name}` : canLink ? "Aucun fichier lié pour l'instant." : "Ton navigateur ne peut pas lier de fichier. Utilise l'export manuel régulièrement.";
    $("#linkCreate").hidden = $("#linkOpen").hidden = !canLink;
    $("#relink").hidden = !fileHandle;
  }
  $("#syncBtn").addEventListener("click", () => { refreshDialog(); refreshAuth(); dlg.showModal(); });
  $("#closeDialog").addEventListener("click", () => dlg.close());

  async function adopt(handle, merge) {
    fileHandle = handle;
    await idb.set("handle", handle);
    if (merge) {
      const f = await readFile().catch(() => null);
      if (f) data = f;
    }
    await persist(false); render(); refreshDialog();
    toast("Fichier lié");
  }

  $("#linkCreate").addEventListener("click", async () => {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: "piixelie-dashboard.json", types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
      await adopt(h, false);
    } catch {}
  });

  $("#linkOpen").addEventListener("click", async () => {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
      if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") return;
      await adopt(h, true);
    } catch {}
  });

  $("#relink").addEventListener("click", async () => {
    try {
      if ((await fileHandle.requestPermission({ mode: "readwrite" })) !== "granted") return;
      const f = await readFile().catch(() => null);
      if (f && f.updatedAt > data.updatedAt) data = f;
      await persist(false); render(); refreshDialog();
      toast("Fichier reconnecté");
    } catch {}
  });

  $("#exportBtn").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "piixelie-dashboard.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      data = normalize(JSON.parse(await file.text()));
      await persist(); render(); toast("Données importées");
    } catch { toast("Fichier invalide"); }
    e.target.value = "";
  });

  /* ---------- Supabase : connexion par mail + données en ligne ---------- */
  const cfg = window.PIIXELIE_CONFIG || {};
  let sbUrl = (cfg.SUPABASE_URL || "").trim();
  try { sbUrl = new URL(sbUrl).origin; } catch {} /* garde seulement https://xxx.supabase.co */
  const sb = window.supabase && sbUrl && !sbUrl.includes("VOTRE")
    ? window.supabase.createClient(sbUrl, (cfg.SUPABASE_ANON_KEY || "").trim())
    : null;
  let pushTimer = null;

  function setCloud(ok, label) {
    cloudState.ok = ok; cloudState.label = label;
    updatePill();
  }

  function refreshAuth() {
    $("#authOff").hidden = !!sb;
    $("#authIn").hidden = !sb || !!user;
    $("#authOut").hidden = !sb || !user;
    if (user) $("#authMail").textContent = user.email;
  }

  async function cloudPush() {
    if (!sb || !user) return;
    const { error } = await sb.from("dashboards").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
    setCloud(!error, error ? "En ligne : erreur d'envoi" : "Synchronisé en ligne");
  }
  function cloudSchedule() {
    if (!sb || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(cloudPush, 800);
  }

  /* La version la plus récente gagne, entre ce navigateur et le cloud. */
  async function cloudPull() {
    if (!sb || !user) return;
    const { data: row, error } = await sb.from("dashboards").select("data").eq("user_id", user.id).maybeSingle();
    if (error) { setCloud(false, "En ligne : erreur de lecture"); return; }
    const remote = row ? normalize(row.data) : null;
    if (remote && remote.updatedAt > data.updatedAt) {
      data = remote;
      await persist(false);
      render();
      setCloud(true, "Synchronisé en ligne");
      toast("Données récupérées");
    } else if (!remote || remote.updatedAt < data.updatedAt) {
      await cloudPush();
    } else {
      setCloud(true, "Synchronisé en ligne");
    }
  }

  function cloudInit() {
    refreshAuth();
    if (!sb) return;
    sb.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      if (!user) setCloud(false, "");
      refreshAuth();
      setTimeout(cloudPull, 0);
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) cloudPull(); });
  }

  const authMsg = (t) => { $("#authMsg").textContent = t; };
  const redirectTo = () => location.origin + location.pathname;

  $("#authIn").addEventListener("submit", async (e) => {
    e.preventDefault();
    authMsg("Connexion…");
    const { error } = await sb.auth.signInWithPassword({ email: $("#authEmail").value.trim(), password: $("#authPass").value });
    if (error) authMsg("Connexion impossible : " + error.message);
    else { authMsg(""); $("#authPass").value = ""; }
  });

  $("#signupBtn").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim(), password = $("#authPass").value;
    if (!email || password.length < 6) return authMsg("Entre un mail et un mot de passe d'au moins 6 caractères.");
    authMsg("Création du compte…");
    const { data: res, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
    if (error) authMsg("Création impossible : " + error.message);
    else if (res.session) { authMsg(""); $("#authPass").value = ""; }
    else authMsg("Compte créé. Clique sur le lien de confirmation reçu par mail, puis connecte-toi.");
  });

  $("#magicBtn").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) return authMsg("Entre ton mail d'abord.");
    authMsg("Envoi du lien…");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    authMsg(error ? "Impossible d'envoyer le lien : " + error.message : "Lien envoyé. Clique dessus depuis cet appareil.");
  });

  $("#passForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#newPass").value });
    $("#passMsg").textContent = error ? "Échec : " + error.message : "Mot de passe enregistré.";
    if (!error) $("#newPass").value = "";
  });
  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); toast("Déconnectée"); });

  /* ---------- Démarrage ---------- */
  setNowDefaults();
  setInterval(() => { if (!$("#streamList").contains(document.activeElement)) renderStreams(); }, 5 * 60 * 1000);
  loadAll().then(() => {
    if (!fileHandle) setSync(false, "Sauvegarde locale");
    else if (!$("#syncDot").classList.contains("ok") && $("#syncLabel").textContent === "Sauvegarde locale") setSync(true, "Fichier synchronisé");
    render();
    cloudInit();
  });
})();
