(() => {
  "use strict";

  /* ---------- Données ---------- */
  const STREAM_STEPS = [
    ["clips", "Clips réalisés"],
    ["downloaded", "Importé sur le PC"],
    ["thumb", "Miniature faite"],
    ["rediff", "Rediff YouTube programmée"],
  ];
  const CLIP_STEPS = [
    ["draft", "Brouillon"],
    ["published", "Publié"],
  ];

  const emptyData = () => ({ updatedAt: 0, streams: [], clips: [] });
  let data = emptyData();
  let user = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Anciens clips (3 brouillons + 3 publications) : repris en "brouillon" / "publié". */
  const migrateClip = (c) => ("draft" in c || "published" in c) ? c : {
    id: c.id, name: c.name, streamId: c.streamId, createdAt: c.createdAt, archived: !!c.archived,
    draft: !!(c.draftShorts || c.draftReels || c.draftTiktok),
    published: !!(c.shorts && c.reels && c.tiktok),
  };
  const normalize = (d) => ({
    updatedAt: Number(d?.updatedAt) || 0,
    streams: Array.isArray(d?.streams) ? d.streams : [],
    clips: Array.isArray(d?.clips) ? d.clips.map(migrateClip) : [],
  });

  const cloudState = { ok: false, label: "" };
  function updatePill() {
    $("#syncLabel").textContent = user ? (cloudState.label || "En ligne") : "Connexion";
    $("#syncDot").classList.toggle("ok", !!user && cloudState.ok);
  }

  /* touch = false quand les données viennent du cloud : on garde leur date. */
  async function persist(touch = true) {
    if (touch) { data.updatedAt = Date.now(); cloudSchedule(); }
  }

  /* Toute action sur les données demande d'être connecté. */
  function requireUser() {
    if (user) return true;
    toast("Connecte-toi d'abord");
    refreshAuth();
    if (!dlg.open) dlg.showModal();
    return false;
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
    const showArch = $("#streamArchived").checked;
    const all = data.streams.filter((s) => !!s.archived === showArch).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
    const done = (s) => STREAM_STEPS.every(([k]) => s[k]);
    const list = todoOnly ? all.filter((s) => !done(s)) : all;
    const urgent = all.filter((s) => vodInfo(s)?.cls === "urgent").length;
    $("#streamCount").textContent = `${all.filter(done).length} terminé(s) sur ${all.length}` + (showArch ? " (archivés)" : "") + (urgent ? `, dont ${urgent} VOD à sauver vite` : "");
    $("#streamList").innerHTML = list.length
      ? list.map((s) => {
          const n = STREAM_STEPS.filter(([k]) => s[k]).length;
          const vod = vodInfo(s);
          return `<article class="card ${n === STREAM_STEPS.length ? "complete" : ""} ${s.archived ? "archived" : ""}">
            <div class="head">
              <div><h3>${esc(s.title)}</h3><p class="when">${esc(fmtWhen(s.date, s.time))}</p>${vod ? `<p class="vod ${vod.cls}">${vod.text}</p>` : ""}</div>
              <div class="tools">
                <button class="del" data-archive="streams" data-id="${s.id}" aria-label="${s.archived ? "Désarchiver" : "Archiver"} ${esc(s.title)}">${s.archived ? "Désarchiver" : "Archiver"}</button>
                <button class="del" data-del="streams" data-id="${s.id}" aria-label="Supprimer ${esc(s.title)}">Supprimer</button>
              </div>
            </div>
            <div class="meter" aria-hidden="true"><i style="width:${(n / STREAM_STEPS.length) * 100}%"></i></div>
            <div class="chips">${STREAM_STEPS.map(([k, l]) => chip("streams", s.id, k, l, s[k])).join("")}</div>
          </article>`;
        }).join("")
      : `<p class="empty">${showArch ? "Aucun stream archivé." : todoOnly ? "Rien à finir, tout est prêt." : "Aucun stream pour l'instant. Ajoute le dernier que tu as réalisé."}</p>`;
  }

  function renderClips() {
    const todoOnly = $("#clipTodo").checked;
    const showArch = $("#clipArchived").checked;
    const pool = data.clips.filter((c) => !!c.archived === showArch).sort((a, b) => b.createdAt - a.createdAt);
    const list = todoOnly ? pool.filter((c) => !c.published) : pool;
    $("#clipCount").textContent = `${pool.filter((c) => c.published).length} publié(s) sur ${pool.length}` + (showArch ? " (archivés)" : "");
    const streamName = (id) => data.streams.find((s) => s.id === id)?.title;
    $("#clipList").innerHTML = list.length
      ? list.map((c) => {
          const origin = streamName(c.streamId);
          return `<article class="card ${c.published ? "complete" : ""} ${c.archived ? "archived" : ""}">
            <div class="head">
              <div><h3>${esc(c.name)}</h3>${origin ? `<p class="origin">Stream : ${esc(origin)}</p>` : ""}</div>
              <div class="tools">
                <button class="del" data-archive="clips" data-id="${c.id}" aria-label="${c.archived ? "Désarchiver" : "Archiver"} ${esc(c.name)}">${c.archived ? "Désarchiver" : "Archiver"}</button>
                <button class="del" data-del="clips" data-id="${c.id}" aria-label="Supprimer ${esc(c.name)}">Supprimer</button>
              </div>
            </div>
            <div class="chips">${CLIP_STEPS.map(([k, l]) => chip("clips", c.id, k, l, c[k])).join("")}</div>
          </article>`;
        }).join("")
      : `<p class="empty">${showArch ? "Aucun clip archivé." : todoOnly ? "Tous tes clips sont publiés." : "Aucun clip pour l'instant. Ajoute ton premier extrait."}</p>`;
  }

  function renderSelect() {
    const sel = $("#cStream");
    const cur = sel.value;
    const streams = data.streams.filter((s) => !s.archived).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
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
    if (!requireUser()) return;
    data.streams.push({ id: uid(), title: $("#sTitle").value.trim(), date: $("#sDate").value, time: $("#sTime").value, clips: false, downloaded: false, thumb: false, rediff: false });
    $("#sTitle").value = "";
    await persist(); render(); toast("Stream ajouté");
  });

  $("#clipForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireUser()) return;
    data.clips.push({ id: uid(), name: $("#cName").value.trim(), streamId: $("#cStream").value, createdAt: Date.now(), draft: false, published: false, archived: false });
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
    const a = e.target.closest("[data-archive]");
    if (a) {
      const item = data[a.dataset.archive]?.find((x) => x.id === a.dataset.id);
      if (!item || !requireUser()) return;
      item.archived = !item.archived;
      await persist(); render();
      const what = a.dataset.archive === "streams" ? "Stream" : "Clip";
      toast(item.archived ? `${what} archivé` : `${what} désarchivé`);
      return;
    }
    const b = e.target.closest("[data-del]");
    if (!b || !requireUser()) return;
    if (!confirm("Supprimer définitivement cet élément ?")) return;
    data[b.dataset.del] = data[b.dataset.del].filter((x) => x.id !== b.dataset.id);
    await persist(); render(); toast("Supprimé");
  });

  $("#streamTodo").addEventListener("change", renderStreams);
  $("#streamArchived").addEventListener("change", renderStreams);
  $("#clipTodo").addEventListener("change", renderClips);
  $("#clipArchived").addEventListener("change", renderClips);

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => { const on = x === t; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on); });
    $("#tab-streams").hidden = t.dataset.tab !== "streams";
    $("#tab-clips").hidden = t.dataset.tab !== "clips";
  }));

  /* ---------- Fenêtre de connexion ---------- */
  const dlg = $("#syncDialog");
  $("#syncBtn").addEventListener("click", () => { refreshAuth(); dlg.showModal(); });
  $("#closeDialog").addEventListener("click", () => dlg.close());

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
    if (!sb) { dlg.showModal(); return; }
    sb.auth.onAuthStateChange((_event, session) => {
      const was = user;
      user = session?.user || null;
      refreshAuth();
      if (!user) {
        clearTimeout(pushTimer);
        data = emptyData();
        setCloud(false, "");
        render();
        if (!dlg.open) dlg.showModal();
        return;
      }
      if (!was && dlg.open) dlg.close();
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
  render();
  cloudInit();
})();
