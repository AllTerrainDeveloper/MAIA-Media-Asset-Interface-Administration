(function() {
  "use strict";
  const CHANGE_TOPIC = "os.attachment.changed";
  const BROADCAST_SOURCE = `allterrain-media-explorer/${Math.random().toString(36).slice(2, 10)}`;
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  }
  function getConfig() {
    const config = window.allTerrainMediaExplorer;
    if (!config || !config.restUrl) {
      throw new Error(
        "[allterrain-media-explorer] window.allTerrainMediaExplorer is missing. The `allterrain-media-explorer-config` script handle was not enqueued on this page."
      );
    }
    return config;
  }
  function getShell() {
    const wp = window.wp;
    return wp?.os ?? null;
  }
  async function requestUrl(url, init = {}, silent = false) {
    const config = getConfig();
    const shell = getShell();
    const headers = {
      Accept: "application/json",
      ...init.headers ?? {}
    };
    if (init.body && typeof init.body === "string") {
      headers["Content-Type"] = "application/json";
    }
    if (!shell?.fetch) {
      headers["X-WP-Nonce"] = config.nonce;
    }
    const options = { credentials: "same-origin", ...init, headers };
    const response = shell?.fetch ? await shell.fetch(url, options, { source: "allterrain-media-explorer", silent }) : await fetch(url, options);
    if (!response.ok) {
      let message = response.statusText || "Request failed";
      let code = "atme_request_failed";
      try {
        const body = await response.json();
        message = body.message ?? message;
        code = body.code ?? code;
      } catch {
      }
      throw new ApiError(message, code, response.status);
    }
    if (response.status === 204) {
      return { body: void 0, response };
    }
    return { body: await response.json(), response };
  }
  function restEndpoint(base, path) {
    const url = new URL(base, window.location.href);
    const split = path.indexOf("?");
    const route = split < 0 ? path : path.slice(0, split);
    const query = split < 0 ? "" : path.slice(split + 1);
    if (url.searchParams.has("rest_route")) {
      url.searchParams.set("rest_route", url.searchParams.get("rest_route").replace(/\/$/, "") + route);
    } else {
      url.pathname = url.pathname.replace(/\/$/, "") + route;
    }
    new URLSearchParams(query).forEach((value, key) => url.searchParams.append(key, value));
    return url.href;
  }
  async function request(path, init = {}, silent = false) {
    const config = getConfig();
    return (await requestUrl(restEndpoint(config.restUrl, path), init, silent)).body;
  }
  async function wpRequest(path, init = {}, silent = false) {
    const config = getConfig();
    return requestUrl(restEndpoint(config.wpRestUrl, path), init, silent);
  }
  const MEDIA_FIELDS = [
    "id",
    "title.rendered",
    "date_gmt",
    "mime_type",
    "media_type",
    "source_url",
    "alt_text",
    "caption.rendered",
    "description.rendered",
    "media_details.width",
    "media_details.height",
    "media_details.filesize",
    "media_details.sizes.medium.source_url",
    "media_details.sizes.thumbnail.source_url",
    "author",
    "post",
    "atme-folders"
  ].join(",");
  function textOf(rendered) {
    if (!rendered) {
      return "";
    }
    const template = document.createElement("template");
    template.innerHTML = rendered;
    return (template.content.textContent ?? "").trim();
  }
  function toMediaItem(raw) {
    const sizes = raw.media_details?.sizes ?? {};
    const mime = raw.mime_type ?? "";
    return {
      id: raw.id,
      title: textOf(raw.title?.rendered),
      date: raw.date_gmt ?? "",
      mime,
      kind: raw.media_type === "image" ? "image" : mime.split("/")[0] || "file",
      url: raw.source_url ?? "",
      thumbnail: sizes.medium?.source_url ?? sizes.thumbnail?.source_url ?? (raw.media_type === "image" ? raw.source_url ?? "" : ""),
      alt: raw.alt_text ?? "",
      caption: textOf(raw.caption?.rendered),
      description: textOf(raw.description?.rendered),
      width: raw.media_details?.width ?? 0,
      height: raw.media_details?.height ?? 0,
      bytes: raw.media_details?.filesize ?? 0,
      authorId: raw.author ?? 0,
      parent: raw.post ?? 0,
      folders: raw["atme-folders"] ?? []
    };
  }
  async function fetchMedia(query, page = 1, perPage = 60) {
    const params = new URLSearchParams();
    params.set("_fields", MEDIA_FIELDS);
    params.set("per_page", String(perPage));
    params.set("page", String(page));
    params.set("orderby", query.orderby);
    params.set("order", query.order);
    if (query.search) {
      params.set("search", query.search);
    }
    if (query.kind) {
      params.set("media_type", query.kind === "application" ? "application" : query.kind);
    }
    if (query.folder > 0) {
      params.set(getConfig().folderField, String(query.folder));
    }
    if ("unattached" === query.view) {
      params.set("parent", "0");
    }
    if (["missing-alt", "converted", "unfiled"].includes(query.view)) {
      params.set("atme_view", query.view);
    }
    const { body, response } = await wpRequest(`/media?${params.toString()}`);
    return {
      items: body.map(toMediaItem),
      total: parseInt(response.headers.get("X-WP-Total") ?? "0", 10),
      totalPages: parseInt(response.headers.get("X-WP-TotalPages") ?? "0", 10)
    };
  }
  async function fetchMediaItem(id) {
    const { body } = await wpRequest(`/media/${id}?_fields=${MEDIA_FIELDS}`);
    return toMediaItem(body);
  }
  async function updateMedia(id, edits) {
    const { body } = await wpRequest(`/media/${id}?_fields=${MEDIA_FIELDS}`, {
      method: "POST",
      body: JSON.stringify(edits)
    });
    announceChange(id, "updated");
    return toMediaItem(body);
  }
  async function deleteMedia(id, force) {
    await wpRequest(`/media/${id}?force=${"true"}`, { method: "DELETE" });
    announceChange(id, "trashed");
  }
  async function uploadMedia(file, folder = 0) {
    const form = new FormData();
    form.append("file", file, file.name);
    const { body } = await wpRequest("/media", { method: "POST", body: form });
    const item = toMediaItem(body);
    if (folder > 0) {
      await fileIntoFolder([item.id], folder);
      item.folders = [...item.folders, folder];
    }
    announceChange(item.id, "created");
    return item;
  }
  async function rotateMedia(id, mime, degrees) {
    const format = mime.replace("image/", "").replace("jpg", "jpeg") || "jpeg";
    await convertMedia(id, { format, quality: 92, rotate: degrees, replace: true });
    announceChange(id, "updated");
  }
  function convertMedia(id, args) {
    return request("/convert", { method: "POST", body: JSON.stringify({ id, ...args }) });
  }
  async function replaceMedia(id, file) {
    const config = getConfig();
    const shell = getShell();
    const form = new FormData();
    form.append("file", file, file.name);
    const url = restEndpoint(config.restUrl, `/replace/${id}`);
    const options = { method: "POST", credentials: "same-origin", body: form };
    if (!shell?.fetch) {
      options.headers = { "X-WP-Nonce": config.nonce };
    }
    const response = shell?.fetch ? await shell.fetch(url, options, { source: "allterrain-media-explorer" }) : await fetch(url, options);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(body.message ?? "Replace failed", body.code ?? "atme_request_failed", response.status);
    }
    announceChange(id, "updated");
    return await response.json();
  }
  function fetchVersions(id) {
    return request(`/versions/${id}`, {}, true);
  }
  async function rollbackVersion(id, file) {
    await request(`/versions/${id}`, { method: "POST", body: JSON.stringify({ file }) });
    announceChange(id, "updated");
  }
  function fetchUsage(id) {
    return request(`/usage/${id}`, {}, true);
  }
  function fetchFacts(id) {
    return request(`/facts/${id}`, {}, true);
  }
  function regenerate(id) {
    return request("/regenerate", { method: "POST", body: JSON.stringify({ id }) });
  }
  function fetchFolders() {
    return request("/folders", {}, true);
  }
  function createFolder(name, parent = 0) {
    return request("/folders", { method: "POST", body: JSON.stringify({ name, parent }) });
  }
  function fileIntoFolder(ids, folder) {
    return request("/folders/file", { method: "POST", body: JSON.stringify({ ids, folder }) });
  }
  function scanChunk(offset, limit = 25) {
    return request(`/scan?offset=${offset}&limit=${limit}`, {}, true);
  }
  function fetchWizardState() {
    return request("/wizard-state", {}, true);
  }
  function saveWizardState(state) {
    return request("/wizard-state", { method: "POST", body: JSON.stringify({ state }) });
  }
  function fetchDuplicates() {
    return request("/duplicates", {}, true);
  }
  async function fetchMediaByIds(ids) {
    if (ids.length === 0) {
      return [];
    }
    const params = new URLSearchParams();
    params.set("_fields", MEDIA_FIELDS);
    params.set("include", ids.join(","));
    params.set("orderby", "include");
    params.set("per_page", String(Math.min(100, ids.length)));
    const { body } = await wpRequest(`/media?${params.toString()}`);
    return body.map(toMediaItem);
  }
  async function fetchCollections() {
    const { body } = await wpRequest(
      "/atme-collections?per_page=100&_fields=id,title.rendered,meta",
      {},
      true
    );
    return body.map((raw) => {
      let query = null;
      try {
        query = JSON.parse(raw.meta?.["_atme_query"] ?? "");
      } catch {
        query = null;
      }
      return query ? { id: raw.id, title: textOf(raw.title?.rendered), query } : null;
    }).filter((collection) => !!collection);
  }
  async function createCollection(title, query) {
    const { body } = await wpRequest("/atme-collections", {
      method: "POST",
      body: JSON.stringify({
        title,
        status: "publish",
        meta: { _atme_query: JSON.stringify(query) }
      })
    });
    return { id: body.id, title, query };
  }
  async function deleteCollection(id) {
    await wpRequest(`/atme-collections/${id}?force=true`, { method: "DELETE" });
  }
  async function fetchNeighbors(item) {
    const base = `/media?_fields=${MEDIA_FIELDS}&per_page=1`;
    const [newer, older] = await Promise.all([
      wpRequest(`${base}&orderby=date&order=asc&after=${encodeURIComponent(item.date + "Z")}`, {}, true),
      wpRequest(`${base}&orderby=date&order=desc&before=${encodeURIComponent(item.date + "Z")}`, {}, true)
    ]);
    return {
      prev: newer.body[0] ? toMediaItem(newer.body[0]) : null,
      next: older.body[0] ? toMediaItem(older.body[0]) : null
    };
  }
  function announceChange(id, action) {
    getShell()?.broadcast?.(CHANGE_TOPIC, { source: BROADCAST_SOURCE, action, ids: [id] });
  }
  function onMediaChanged(cb) {
    const shell = getShell();
    if (!shell?.subscribe) {
      return () => void 0;
    }
    return shell.subscribe(CHANGE_TOPIC, (payload) => {
      const change = payload;
      if (change?.source === BROADCAST_SOURCE) {
        return;
      }
      cb((change?.ids ?? []).map((id) => Number(id)));
    });
  }
  const ACCEPTED_TYPES = ["shortcut", "desktop-file"];
  function entitiesIn(payload) {
    if (payload.type === "shortcut") {
      const data = payload.data;
      const items = data.items?.length ? data.items : [data];
      return items.map(toEntity).filter(isUsable);
    }
    if (payload.type === "desktop-file") {
      const data = payload.data;
      const list = data.placements?.length ? data.placements : [data.placement];
      return list.map(
        (placement) => toEntity({
          kind: placement?.file?.type,
          ref: placement?.file?.ref,
          title: placement?.file?.title
        })
      ).filter(isUsable);
    }
    return [];
  }
  function toEntity(item) {
    return {
      kind: String(item.kind ?? ""),
      ref: String(item.ref ?? ""),
      title: String(item.title ?? "").trim()
    };
  }
  function isUsable(entity) {
    return entity.kind !== "" && entity.ref !== "";
  }
  function isDesktopPayload(payload) {
    return ACCEPTED_TYPES.includes(payload.type);
  }
  function mountQuickLook(host, navigate) {
    let overlay = null;
    const close = () => {
      overlay?.remove();
      overlay = null;
    };
    const paint = (item) => {
      if (!overlay) {
        return;
      }
      const stage = overlay.querySelector(".atme-quicklook__stage");
      const caption = overlay.querySelector(".atme-quicklook__caption");
      if (!stage || !caption) {
        return;
      }
      stage.textContent = "";
      if (item.kind === "image") {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.alt;
        stage.appendChild(img);
      } else if (item.kind === "video") {
        const video = document.createElement("video");
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        stage.appendChild(video);
      } else if (item.kind === "audio") {
        const audio = document.createElement("audio");
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;
        stage.appendChild(audio);
      } else {
        const icon = document.createElement("span");
        icon.className = "dashicons dashicons-media-default";
        stage.appendChild(icon);
      }
      const dimensions = item.width > 0 ? ` — ${item.width} × ${item.height}` : "";
      caption.textContent = `${item.title || `#${item.id}`}${dimensions}`;
    };
    const onKeydown = (event) => {
      if (!overlay) {
        return;
      }
      if (event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        const next = navigate(event.key === "ArrowRight" ? 1 : -1);
        if (next) {
          paint(next);
        }
      }
    };
    window.addEventListener("keydown", onKeydown, true);
    return {
      open(item) {
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.className = "atme-quicklook";
          overlay.setAttribute("role", "dialog");
          overlay.setAttribute("aria-label", "Preview");
          const stage = document.createElement("div");
          stage.className = "atme-quicklook__stage";
          overlay.appendChild(stage);
          const caption = document.createElement("div");
          caption.className = "atme-quicklook__caption";
          overlay.appendChild(caption);
          overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
              close();
            }
          });
          host.appendChild(overlay);
        }
        paint(item);
      },
      close,
      isOpen: () => !!overlay,
      destroy() {
        window.removeEventListener("keydown", onKeydown, true);
        close();
      }
    };
  }
  function registered(tag) {
    return typeof customElements !== "undefined" && !!customElements.get(tag);
  }
  const COMPONENT_TAGS = [
    "os-select",
    "os-option",
    "os-button",
    "os-text-field",
    "os-textarea",
    "os-checkbox-label",
    "os-range-field",
    "os-notice",
    "os-empty-state",
    "os-progress-bar",
    "os-steps",
    "os-step",
    "os-spinner",
    "os-icon",
    "os-relative-time",
    "os-chip"
  ];
  async function ensureComponents(tags = COMPONENT_TAGS) {
    const missing = tags.filter((tag) => !registered(tag));
    if (!missing.length) {
      return false;
    }
    const load = window.wp?.os?.loadComponents;
    if ("function" !== typeof load) {
      return false;
    }
    try {
      await load(tags);
    } catch {
      return false;
    }
    return missing.some((tag) => registered(tag));
  }
  function selectControl(opts) {
    if (registered("os-select")) {
      const select2 = document.createElement("os-select");
      select2.setAttribute("value", opts.value);
      if (opts.hideLabel) {
        select2.setAttribute("placeholder", opts.label);
      } else {
        select2.setAttribute("label", opts.label);
      }
      for (const option of opts.options) {
        const el = document.createElement("os-option");
        el.setAttribute("value", option.value);
        el.textContent = option.label;
        select2.appendChild(el);
      }
      select2.addEventListener("os-pick", (event) => {
        const value = event.detail?.value;
        if (typeof value === "string") {
          opts.onChange(value);
        }
      });
      return select2;
    }
    const select = document.createElement("select");
    select.className = opts.className ?? "";
    select.setAttribute("aria-label", opts.label);
    for (const option of opts.options) {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    }
    select.value = opts.value;
    select.addEventListener("change", () => opts.onChange(select.value));
    return select;
  }
  function buttonControl(opts) {
    if (registered("os-button")) {
      const button2 = document.createElement("os-button");
      button2.textContent = opts.label;
      if (opts.variant) {
        button2.setAttribute("variant", opts.variant);
      }
      button2.addEventListener("click", opts.onClick);
      return button2;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = opts.className ?? "atme__button";
    button.textContent = opts.label;
    button.addEventListener("click", opts.onClick);
    return button;
  }
  function textControl(opts) {
    if (registered("os-text-field")) {
      const field = document.createElement("os-text-field");
      field.setAttribute("value", opts.value ?? "");
      if (opts.hideLabel) {
        field.setAttribute("aria-label", opts.label);
      } else {
        field.setAttribute("label", opts.label);
      }
      if (opts.placeholder) {
        field.setAttribute("placeholder", opts.placeholder);
      }
      field.addEventListener("os-input-change", (event) => {
        const value = event.detail?.value;
        opts.onInput(typeof value === "string" ? value : "");
      });
      field.addEventListener("input", (event) => {
        const value = event.target.value;
        if (typeof value === "string") {
          opts.onInput(value);
        }
      });
      return field;
    }
    const input = document.createElement("input");
    input.type = opts.type ?? "text";
    input.className = opts.className ?? "";
    input.setAttribute("aria-label", opts.label);
    input.value = opts.value ?? "";
    if (opts.placeholder) {
      input.placeholder = opts.placeholder;
    }
    input.addEventListener("input", () => opts.onInput(input.value));
    return input;
  }
  function textareaControl(opts) {
    if (registered("os-textarea")) {
      const field = document.createElement("os-textarea");
      field.setAttribute("value", opts.value ?? "");
      if (opts.hideLabel) {
        field.setAttribute("aria-label", opts.label);
      } else {
        field.setAttribute("label", opts.label);
      }
      field.addEventListener("os-input-change", (event) => {
        const value = event.detail?.value;
        opts.onInput(typeof value === "string" ? value : "");
      });
      field.addEventListener("input", (event) => {
        const value = event.target.value;
        if (typeof value === "string") {
          opts.onInput(value);
        }
      });
      return field;
    }
    const wrap = document.createElement("label");
    wrap.className = "atme-field";
    const caption = document.createElement("span");
    caption.className = "atme-field__label";
    caption.textContent = opts.label;
    if (!opts.hideLabel) {
      wrap.appendChild(caption);
    }
    const input = document.createElement("textarea");
    input.className = opts.className ?? "atme-field__input";
    input.setAttribute("aria-label", opts.label);
    input.value = opts.value ?? "";
    input.addEventListener("input", () => opts.onInput(input.value));
    wrap.appendChild(input);
    return wrap;
  }
  function checkboxControl(opts) {
    if (registered("os-checkbox-label")) {
      const box = document.createElement("os-checkbox-label");
      box.setAttribute("label", opts.label);
      if (opts.checked) {
        box.setAttribute("checked", "");
      }
      box.addEventListener("os-checkbox-change", (event) => {
        const checked = event.detail?.checked;
        opts.onChange(!!checked);
      });
      return box;
    }
    const wrap = document.createElement("label");
    wrap.className = "atme-convert__mode";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!opts.checked;
    input.addEventListener("change", () => opts.onChange(input.checked));
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(` ${opts.label}`));
    return wrap;
  }
  function rangeControl(opts) {
    if (registered("os-range-field")) {
      const field = document.createElement("os-range-field");
      field.setAttribute("label", opts.label);
      field.setAttribute("min", String(opts.min));
      field.setAttribute("max", String(opts.max));
      field.setAttribute("value", String(opts.value));
      field.addEventListener("os-range-change", (event) => {
        const value = Number(event.detail?.value);
        if (!Number.isNaN(value)) {
          opts.onChange(value);
        }
      });
      return field;
    }
    const wrap = document.createElement("div");
    wrap.className = "atme-convert";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.value = String(opts.value);
    input.setAttribute("aria-label", opts.label);
    const out = document.createElement("span");
    out.className = "atme-convert__quality";
    out.textContent = String(opts.value);
    input.addEventListener("input", () => {
      out.textContent = input.value;
      opts.onChange(Number(input.value));
    });
    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  }
  function emptyStateEl(opts) {
    if (registered("os-empty-state")) {
      const empty2 = document.createElement("os-empty-state");
      empty2.setAttribute("heading", opts.title);
      if (opts.icon) {
        empty2.setAttribute("icon", opts.icon);
      }
      if (opts.body) {
        empty2.setAttribute("description", opts.body);
      }
      return empty2;
    }
    const empty = document.createElement("div");
    empty.className = "atme-empty";
    const title = document.createElement("p");
    title.className = "atme-empty__title";
    title.textContent = opts.title;
    empty.appendChild(title);
    if (opts.body) {
      const body = document.createElement("p");
      body.className = "atme-empty__body";
      body.textContent = opts.body;
      empty.appendChild(body);
    }
    return empty;
  }
  function noticeEl(message, tone = "info") {
    if (registered("os-notice")) {
      const notice2 = document.createElement("os-notice");
      notice2.setAttribute("tone", tone);
      notice2.textContent = message;
      return notice2;
    }
    const notice = document.createElement("p");
    notice.className = "atme-inspector__hint";
    notice.textContent = message;
    return notice;
  }
  function setFindingsBadge(count) {
    const shell = getShell();
    shell?.dock?.setBadge?.("allterrain-media-explorer", count);
    shell?.sideDock?.setBadge?.("allterrain-media-explorer", count);
    shell?.icons?.setBadge?.("allterrain-media-explorer", count);
  }
  function formatFromMime(mime) {
    const slug = (mime ?? "").replace("image/", "");
    return "jpg" === slug ? "jpeg" : slug || "jpeg";
  }
  function mountWizard(host, onLibraryChanged, onClosed) {
    let panel = null;
    let cancelled = false;
    const close = () => {
      const wasOpen = !!panel;
      cancelled = true;
      panel?.remove();
      panel = null;
      inner = null;
      if (wasOpen) {
        onClosed?.();
      }
    };
    let inner = null;
    const shellPanel = () => {
      if (panel && inner) {
        inner.textContent = "";
        return inner;
      }
      if ("static" === getComputedStyle(host).position) {
        host.style.position = "relative";
      }
      panel = document.createElement("div");
      panel.className = "atme-wizard";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Optimization wizard");
      inner = document.createElement("div");
      inner.className = "atme-wizard__inner";
      panel.appendChild(inner);
      host.appendChild(panel);
      return inner;
    };
    const header = (el, title, step) => {
      const top = document.createElement("div");
      top.className = "atme-wizard__header";
      const strip = document.createElement("ol");
      strip.className = "atme-wizard__strip";
      strip.setAttribute("aria-label", `Step ${step + 1} of 4`);
      ["Scan", "Findings", "Fix", "Report"].forEach((label, index) => {
        const item = document.createElement("li");
        item.className = "atme-wizard__step";
        if (index < step) {
          item.classList.add("is-done");
        }
        if (index === step) {
          item.classList.add("is-current");
          item.setAttribute("aria-current", "step");
        }
        const dot = document.createElement("span");
        dot.className = "atme-wizard__stepdot";
        dot.textContent = index < step ? "✓" : String(index + 1);
        item.appendChild(dot);
        const text = document.createElement("span");
        text.className = "atme-wizard__steplabel";
        text.textContent = label;
        item.appendChild(text);
        strip.appendChild(item);
      });
      top.appendChild(strip);
      const closeButton = buttonControl({
        label: "Close",
        className: "atme-button atme-button--small",
        onClick: close
      });
      closeButton.classList.add("atme-wizard__close");
      top.appendChild(closeButton);
      el.appendChild(top);
      const heading = document.createElement("h2");
      heading.className = "atme-wizard__title";
      heading.textContent = title;
      el.appendChild(heading);
    };
    const progressBar = (el) => {
      let bar;
      let text;
      if (registered("os-progress-bar")) {
        bar = document.createElement("os-progress-bar");
        bar.setAttribute("max", "100");
        bar.setAttribute("value", "0");
      } else {
        bar = document.createElement("progress");
        bar.max = 100;
      }
      bar.classList.add("atme-wizard__progress");
      el.appendChild(bar);
      text = document.createElement("div");
      text.className = "atme-wizard__progresstext";
      el.appendChild(text);
      return (value, max, label) => {
        const pct = max > 0 ? Math.round(value / max * 100) : 0;
        bar.setAttribute("value", String(pct));
        if (bar instanceof HTMLProgressElement) {
          bar.value = pct;
        }
        text.textContent = label;
      };
    };
    const showIntro = async () => {
      const el = shellPanel();
      header(el, "Optimize the library", 0);
      const body = document.createElement("div");
      body.className = "atme-wizard__body";
      body.appendChild(
        noticeEl(
          "The wizard reads every image and reports what could be better: oversized originals, formats WebP would halve, missing alt text, duplicate files. Nothing changes until you say so."
        )
      );
      el.appendChild(body);
      const saved = await fetchWizardState().catch(() => ({ state: null }));
      if (saved.state && saved.state.queue.length > saved.state.done) {
        const resume = document.createElement("div");
        resume.className = "atme-wizard__resume";
        resume.appendChild(
          noticeEl(
            `A previous run stopped at ${saved.state.done} of ${saved.state.queue.length} fixes.`,
            "warning"
          )
        );
        resume.appendChild(
          buttonControl({
            label: "Resume it",
            variant: "primary",
            className: "atme-button atme-button--primary",
            onClick: () => void runQueue(saved.state)
          })
        );
        resume.appendChild(
          buttonControl({
            label: "Discard it",
            className: "atme-button",
            onClick: () => {
              void saveWizardState(null);
              void showIntro();
            }
          })
        );
        body.appendChild(resume);
      }
      const actions = document.createElement("div");
      actions.className = "atme-wizard__actions";
      actions.appendChild(
        buttonControl({
          label: "Scan the library",
          variant: "primary",
          className: "atme-button atme-button--primary",
          onClick: () => void runScan()
        })
      );
      el.appendChild(actions);
    };
    const runScan = async () => {
      const el = shellPanel();
      header(el, "Scanning…", 0);
      const body = document.createElement("div");
      body.className = "atme-wizard__body";
      el.appendChild(body);
      const update = progressBar(body);
      cancelled = false;
      const findings = [];
      let offset = 0;
      let total = 0;
      try {
        for (; ; ) {
          if (cancelled || !panel) {
            return;
          }
          const chunk = await scanChunk(offset);
          findings.push(...chunk.findings);
          total = chunk.total;
          update(Math.min(offset + 25, total), total, `${Math.min(offset + 25, total)} of ${total} files read`);
          if (chunk.next < 0) {
            break;
          }
          offset = chunk.next;
        }
      } catch (error) {
        body.appendChild(
          noticeEl(error instanceof Error ? error.message : "The scan failed part-way.", "warning")
        );
        return;
      }
      setFindingsBadge(findings.length);
      showFindings(findings);
    };
    const showFindings = (findings) => {
      const el = shellPanel();
      header(el, "What the scan found", 1);
      const body = document.createElement("div");
      body.className = "atme-wizard__body";
      el.appendChild(body);
      const byKind = (kind) => findings.filter((finding) => finding.kind === kind);
      const oversized = byKind("oversized");
      const legacy = byKind("legacy-format");
      const missingAlt = byKind("missing-alt");
      const duplicates = byKind("duplicate");
      const missingFiles = byKind("missing-file");
      if (findings.length === 0) {
        body.appendChild(
          emptyStateEl({
            title: "Nothing to fix",
            body: "Every image is sized sensibly, formatted modern, and described.",
            icon: "dashicons-yes-alt"
          })
        );
        return;
      }
      const choices = {
        convertLegacy: legacy.length > 0,
        format: getConfig().conversion.encode.webp ? "webp" : "jpeg",
        quality: 82,
        downscale: oversized.length > 0,
        maxWidth: 2560
      };
      const card = (title, count) => {
        const box = document.createElement("div");
        box.className = "atme-wizard__card";
        const heading = document.createElement("h3");
        heading.textContent = `${title} — ${count}`;
        box.appendChild(heading);
        body.appendChild(box);
        return box;
      };
      if (legacy.length > 0) {
        const box = card("Legacy formats", legacy.length);
        box.appendChild(
          checkboxControl({
            label: `Convert to ${choices.format.toUpperCase()} in place (originals kept as versions)`,
            checked: choices.convertLegacy,
            onChange: (checked) => {
              choices.convertLegacy = checked;
            }
          })
        );
        box.appendChild(
          rangeControl({
            label: "Quality",
            value: choices.quality,
            min: 40,
            max: 100,
            onChange: (value) => {
              choices.quality = value;
            }
          })
        );
      }
      if (oversized.length > 0) {
        const box = card("Oversized images", oversized.length);
        box.appendChild(
          checkboxControl({
            label: `Downscale to ${choices.maxWidth}px wide, in place`,
            checked: choices.downscale,
            onChange: (checked) => {
              choices.downscale = checked;
            }
          })
        );
      }
      if (missingAlt.length > 0) {
        const box = card("Missing alt text", missingAlt.length);
        box.appendChild(
          noticeEl("Alt text needs eyes. The “Missing alt text” smart view lists these for writing — or the AI assist in the inspector drafts one per image.")
        );
      }
      if (duplicates.length > 0) {
        const box = card("Duplicate files", duplicates.length);
        box.appendChild(
          noticeEl("Duplicates are never auto-deleted. The “Duplicates” smart view shows each group side by side for a human decision.")
        );
      }
      if (missingFiles.length > 0) {
        const box = card("Missing files", missingFiles.length);
        box.appendChild(
          noticeEl("These items exist in the library but their files are gone from disk.", "warning")
        );
      }
      const actions = document.createElement("div");
      actions.className = "atme-wizard__actions";
      actions.appendChild(
        buttonControl({
          label: "Apply the selected fixes",
          variant: "primary",
          className: "atme-button atme-button--primary",
          onClick: () => {
            const queue = [];
            if (choices.convertLegacy) {
              for (const finding of legacy) {
                queue.push({
                  id: finding.id,
                  remedy: "convert",
                  format: choices.format,
                  quality: choices.quality
                });
              }
            }
            if (choices.downscale) {
              for (const finding of oversized) {
                queue.push({
                  id: finding.id,
                  remedy: "downscale",
                  maxWidth: choices.maxWidth,
                  // A downscale keeps the file's own format.
                  format: formatFromMime(finding.mime)
                });
              }
            }
            if (queue.length === 0) {
              getShell()?.showToast?.({ message: "Nothing selected to fix" });
              return;
            }
            void runQueue({ queue, done: 0, failed: [] });
          }
        })
      );
      el.appendChild(actions);
    };
    const runQueue = async (state) => {
      const el = shellPanel();
      header(el, "Fixing…", 2);
      const body = document.createElement("div");
      body.className = "atme-wizard__body";
      el.appendChild(body);
      const update = progressBar(body);
      const pause = buttonControl({
        label: "Pause (resumable later)",
        className: "atme-button",
        onClick: () => {
          cancelled = true;
        }
      });
      body.appendChild(pause);
      cancelled = false;
      while (state.done < state.queue.length) {
        if (cancelled || !panel) {
          await saveWizardState(state);
          return;
        }
        const job = state.queue[state.done];
        update(state.done, state.queue.length, `${state.done} of ${state.queue.length} fixed`);
        try {
          if ("convert" === job.remedy) {
            await convertMedia(job.id, {
              format: job.format ?? "webp",
              quality: job.quality ?? 82,
              replace: true
            });
          } else if ("downscale" === job.remedy) {
            await convertMedia(job.id, {
              // Same format, smaller canvas — "convert" is also the
              // resize verb, which keeps one server code path.
              format: formatOfId(job),
              quality: 92,
              max_width: job.maxWidth ?? 2560,
              replace: true
            });
          } else if ("alt" === job.remedy) {
            await updateMedia(job.id, { alt_text: "" });
          }
        } catch (error) {
          state.failed.push({
            id: job.id,
            message: error instanceof Error ? error.message : "failed"
          });
        }
        state.done += 1;
        if (state.done % 5 === 0) {
          await saveWizardState(state).catch(() => void 0);
        }
      }
      await saveWizardState(null).catch(() => void 0);
      setFindingsBadge(0);
      onLibraryChanged();
      showReport(state);
    };
    const formatOfId = (job) => {
      return job.format ?? "jpeg";
    };
    const showReport = (state) => {
      const el = shellPanel();
      header(el, "Done", 3);
      const body = document.createElement("div");
      body.className = "atme-wizard__body";
      el.appendChild(body);
      const fixed = state.done - state.failed.length;
      body.appendChild(
        emptyStateEl({
          title: `${fixed} file${fixed === 1 ? "" : "s"} improved`,
          body: state.failed.length > 0 ? `${state.failed.length} could not be fixed.` : "Every selected fix landed.",
          icon: "dashicons-yes-alt"
        })
      );
      if (state.failed.length > 0) {
        const list = document.createElement("ul");
        list.className = "atme-wizard__failures";
        for (const failure of state.failed.slice(0, 20)) {
          const row = document.createElement("li");
          row.textContent = `#${failure.id}: ${failure.message}`;
          list.appendChild(row);
        }
        body.appendChild(list);
      }
      getShell()?.showToast?.({ message: `Wizard finished — ${fixed} files improved` });
      const actions = document.createElement("div");
      actions.className = "atme-wizard__actions";
      actions.appendChild(
        buttonControl({
          label: "Close",
          variant: "primary",
          className: "atme-button atme-button--primary",
          onClick: close
        })
      );
      el.appendChild(actions);
    };
    return {
      open: () => void showIntro(),
      close,
      destroy: close
    };
  }
  class SelectionModel {
    constructor() {
      this.selected = /* @__PURE__ */ new Set();
      this.anchorId = 0;
      this.order = [];
    }
    /** Tells the model what the grid currently shows, in order. */
    setOrder(ids) {
      this.order = [...ids];
      const visible = new Set(ids);
      this.selected = new Set([...this.selected].filter((id) => visible.has(id)));
      if (this.anchorId && !visible.has(this.anchorId)) {
        this.anchorId = 0;
      }
    }
    /** A plain click: this item, alone. */
    select(id) {
      this.selected = /* @__PURE__ */ new Set([id]);
      this.anchorId = id;
    }
    /** ⌘/Ctrl-click: toggles one, moves the anchor to it. */
    toggle(id) {
      if (this.selected.has(id)) {
        this.selected.delete(id);
      } else {
        this.selected.add(id);
      }
      this.anchorId = id;
    }
    /** Shift-click: the run from the anchor to here, replacing the selection. */
    range(id) {
      if (!this.anchorId) {
        this.select(id);
        return;
      }
      const from = this.order.indexOf(this.anchorId);
      const to = this.order.indexOf(id);
      if (from === -1 || to === -1) {
        this.select(id);
        return;
      }
      const [start, end] = from < to ? [from, to] : [to, from];
      this.selected = new Set(this.order.slice(start, end + 1));
    }
    /** Everything, in grid order. */
    selectAll() {
      this.selected = new Set(this.order);
    }
    clear() {
      this.selected = /* @__PURE__ */ new Set();
      this.anchorId = 0;
    }
    has(id) {
      return this.selected.has(id);
    }
    count() {
      return this.selected.size;
    }
    /** Selected ids, in the order the grid shows them. */
    ids() {
      return this.order.filter((id) => this.selected.has(id));
    }
    /**
     * The set a drag starting on `id` carries: the selection when the grab
     * landed inside it, just the grabbed tile when it landed outside.
     */
    dragSet(id) {
      return this.selected.has(id) ? this.ids() : [id];
    }
  }
  const SHORTCUT_PAYLOAD_TYPE = "shortcut";
  function iconFor(item) {
    switch (item.kind) {
      case "image":
        return "dashicons-format-image";
      case "video":
        return "dashicons-format-video";
      case "audio":
        return "dashicons-format-audio";
      default:
        return "dashicons-media-default";
    }
  }
  function shortcutItem(item) {
    return {
      kind: "attachment",
      ref: String(item.id),
      title: item.title || item.url.split("/").pop() || `#${item.id}`,
      icon: iconFor(item),
      entityId: "media",
      bridgePayload: {
        kind: "attachment",
        id: item.id,
        url: item.url,
        title: item.title,
        alt: item.alt,
        mime: item.mime,
        thumbnailUrl: item.thumbnail || void 0
      }
    };
  }
  function attachmentPayload(grabbed, set, source, origin) {
    const rect = source.getBoundingClientRect();
    const top = shortcutItem(grabbed);
    return {
      type: SHORTCUT_PAYLOAD_TYPE,
      source,
      data: {
        ...top,
        items: set.map(shortcutItem)
      },
      ghost: {
        // Measured, never 0,0 — a ghost that snaps its corner to the
        // pointer reads as the tile jumping out from under the hand.
        offsetX: origin.clientX - rect.left,
        offsetY: origin.clientY - rect.top,
        hint: { hidden: false }
      }
    };
  }
  class MediaGrid {
    constructor(host, dnd, delegate) {
      this.selection = new SelectionModel();
      this.items = [];
      this.byId = /* @__PURE__ */ new Map();
      this.tiles = /* @__PURE__ */ new Map();
      this.focusedId = 0;
      this.keyHandler = null;
      this.dnd = dnd;
      this.delegate = delegate;
      this.list = document.createElement("div");
      this.list.className = "atme-grid";
      this.list.setAttribute("role", "listbox");
      this.list.setAttribute("aria-multiselectable", "true");
      this.list.setAttribute("aria-label", "Media library");
      this.list.tabIndex = 0;
      this.sentinel = document.createElement("div");
      this.sentinel.className = "atme-grid__sentinel";
      host.appendChild(this.list);
      host.appendChild(this.sentinel);
      this.observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.delegate.onNeedMore();
          }
        },
        { root: host, rootMargin: "600px" }
      ) : null;
      this.observer?.observe(this.sentinel);
      this.keyHandler = (event) => {
        const target = event.target;
        if (target && this.list.contains(target)) {
          this.onKeydown(event);
        }
      };
      window.addEventListener("keydown", this.keyHandler, true);
      this.list.addEventListener("pointerdown", (event) => {
        if (event.target === this.list && !this.dnd.recentlyEndedDrag?.()) {
          this.selection.clear();
          this.paintSelection();
          this.delegate.onSelection([]);
        }
      });
    }
    /** Switches between the tile grid and the detail list. */
    setLayout(layout) {
      this.list.classList.toggle("atme-grid--list", "list" === layout);
    }
    /** Replaces the whole result set (a new query). */
    setItems(items) {
      this.items = [...items];
      this.sync();
    }
    /** Appends a page (infinite scroll). */
    appendItems(items) {
      const known = new Set(this.items.map((item) => item.id));
      this.items = [...this.items, ...items.filter((item) => !known.has(item.id))];
      this.sync();
    }
    /** Patches single items in place after an edit elsewhere. */
    patchItems(items) {
      const patch = new Map(items.map((item) => [item.id, item]));
      this.items = this.items.map((item) => patch.get(item.id) ?? item);
      this.sync();
    }
    /** Drops items that no longer exist. */
    removeItems(ids) {
      const gone = new Set(ids);
      this.items = this.items.filter((item) => !gone.has(item.id));
      this.sync();
    }
    getItems() {
      return [...this.items];
    }
    selectedIds() {
      return this.selection.ids();
    }
    selectedItems() {
      return this.selection.ids().map((id) => this.byId.get(id)).filter((item) => !!item);
    }
    selectAll() {
      this.selection.selectAll();
      this.paintSelection();
      this.delegate.onSelection(this.selection.ids());
    }
    clearSelection() {
      this.selection.clear();
      this.paintSelection();
      this.delegate.onSelection([]);
    }
    /** Scrolls one item into view and selects it — the "reveal" verb. */
    reveal(id) {
      if (!this.byId.has(id)) {
        return;
      }
      this.selection.select(id);
      this.paintSelection();
      this.delegate.onSelection(this.selection.ids());
      this.tiles.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    /** Rebuilds the DOM to match `items`, recycling tiles by id. */
    sync() {
      this.byId = new Map(this.items.map((item) => [item.id, item]));
      this.selection.setOrder(this.items.map((item) => item.id));
      const wanted2 = new Set(this.items.map((item) => item.id));
      for (const [id, tile] of this.tiles) {
        if (!wanted2.has(id)) {
          tile.remove();
          this.tiles.delete(id);
        }
      }
      let previous = null;
      for (const item of this.items) {
        let tile = this.tiles.get(item.id);
        if (!tile) {
          tile = this.buildTile(item);
          this.tiles.set(item.id, tile);
        } else {
          this.updateTile(tile, item);
        }
        if (previous) {
          if (previous.nextElementSibling !== tile) {
            previous.after(tile);
          }
        } else if (this.list.firstElementChild !== tile) {
          this.list.prepend(tile);
        }
        previous = tile;
      }
      this.paintSelection();
    }
    buildTile(item) {
      const tile = document.createElement("div");
      tile.className = "atme-tile";
      tile.setAttribute("role", "option");
      tile.tabIndex = -1;
      tile.dataset.id = String(item.id);
      const preview = document.createElement("div");
      preview.className = "atme-tile__preview";
      tile.appendChild(preview);
      const name = document.createElement("div");
      name.className = "atme-tile__name";
      tile.appendChild(name);
      const meta = document.createElement("div");
      meta.className = "atme-tile__meta";
      tile.appendChild(meta);
      this.updateTile(tile, item);
      tile.addEventListener("pointerdown", (event) => this.onTilePointerDown(event, tile));
      tile.addEventListener("dblclick", () => {
        const current = this.byId.get(item.id);
        if (current) {
          this.delegate.onOpen(current);
        }
      });
      return tile;
    }
    updateTile(tile, item) {
      const preview = tile.querySelector(".atme-tile__preview");
      const name = tile.querySelector(".atme-tile__name");
      if (name) {
        name.textContent = item.title || item.url.split("/").pop() || `#${item.id}`;
      }
      tile.setAttribute("aria-label", item.title || `Media ${item.id}`);
      const meta = tile.querySelector(".atme-tile__meta");
      if (meta) {
        const parts = [item.mime];
        if (item.date) {
          parts.push((/* @__PURE__ */ new Date(item.date + "Z")).toLocaleDateString());
        }
        if (item.width > 0) {
          parts.push(`${item.width}×${item.height}`);
        }
        meta.textContent = parts.join(" · ");
      }
      if (!preview) {
        return;
      }
      if (item.thumbnail) {
        let img = preview.querySelector("img");
        if (!img) {
          preview.textContent = "";
          img = document.createElement("img");
          img.loading = "lazy";
          img.draggable = false;
          preview.appendChild(img);
        }
        if (img.getAttribute("src") !== item.thumbnail) {
          img.src = item.thumbnail;
        }
        img.alt = "";
      } else {
        preview.textContent = "";
        const icon = document.createElement("span");
        icon.className = `dashicons ${this.kindIcon(item)}`;
        preview.appendChild(icon);
        const ext = document.createElement("span");
        ext.className = "atme-tile__ext";
        ext.textContent = (item.url.split(".").pop() ?? "").toUpperCase().slice(0, 5);
        preview.appendChild(ext);
      }
    }
    kindIcon(item) {
      switch (item.kind) {
        case "video":
          return "dashicons-format-video";
        case "audio":
          return "dashicons-format-audio";
        default:
          return "dashicons-media-default";
      }
    }
    /**
     * Pointer down on a tile: selection now, drag if it moves, open on
     * double-click. The click handler lives on the drag *session*
     * (`onClickOnly`), so a press that becomes a drag never also selects
     * twice or opens.
     */
    onTilePointerDown(event, tile) {
      if (event.button !== 0) {
        return;
      }
      const id = Number(tile.dataset.id);
      const item = this.byId.get(id);
      if (!item) {
        return;
      }
      const additive = event.metaKey || event.ctrlKey;
      const ranged = event.shiftKey;
      const insideSelection = this.selection.has(id) && this.selection.count() > 1;
      if (ranged) {
        this.selection.range(id);
      } else if (additive) {
        this.selection.toggle(id);
      } else if (!insideSelection) {
        this.selection.select(id);
      }
      this.paintSelection();
      this.focusedId = id;
      this.delegate.onSelection(this.selection.ids());
      const set = this.selection.dragSet(id).map((memberId) => this.byId.get(memberId)).filter((member) => !!member);
      this.dnd.start({
        payload: attachmentPayload(item, set, tile, event),
        origin: event,
        onClickOnly: () => {
          if (!additive && !ranged && insideSelection) {
            this.selection.select(id);
            this.paintSelection();
            this.delegate.onSelection(this.selection.ids());
          }
        }
      });
    }
    onKeydown(event) {
      const columns = this.columnCount();
      const order = this.items.map((item) => item.id);
      if (order.length === 0) {
        return;
      }
      const currentIndex = Math.max(0, order.indexOf(this.focusedId));
      let nextIndex = -1;
      switch (event.key) {
        case "ArrowRight":
          nextIndex = Math.min(order.length - 1, currentIndex + 1);
          break;
        case "ArrowLeft":
          nextIndex = Math.max(0, currentIndex - 1);
          break;
        case "ArrowDown":
          nextIndex = Math.min(order.length - 1, currentIndex + columns);
          break;
        case "ArrowUp":
          nextIndex = Math.max(0, currentIndex - columns);
          break;
        case "a":
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            this.selectAll();
          }
          return;
        case "Enter": {
          const item = this.byId.get(this.focusedId);
          if (item) {
            event.preventDefault();
            event.stopPropagation();
            this.delegate.onOpen(item);
          }
          return;
        }
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      const nextId = order[nextIndex];
      this.focusedId = nextId;
      if (event.shiftKey) {
        this.selection.range(nextId);
      } else {
        this.selection.select(nextId);
      }
      this.paintSelection();
      this.delegate.onSelection(this.selection.ids());
      this.tiles.get(nextId)?.scrollIntoView({ block: "nearest" });
    }
    /** How many tiles share a row right now, for arrow-key geometry. */
    columnCount() {
      const first = this.list.firstElementChild;
      if (!first) {
        return 1;
      }
      const tileWidth = first.offsetWidth || 1;
      const listWidth = this.list.clientWidth || tileWidth;
      return Math.max(1, Math.floor(listWidth / tileWidth));
    }
    paintSelection() {
      for (const [id, tile] of this.tiles) {
        const selected = this.selection.has(id);
        tile.classList.toggle("is-selected", selected);
        tile.setAttribute("aria-selected", selected ? "true" : "false");
      }
    }
    destroy() {
      if (this.keyHandler) {
        window.removeEventListener("keydown", this.keyHandler, true);
        this.keyHandler = null;
      }
      this.observer?.disconnect();
      this.list.remove();
      this.sentinel.remove();
      this.tiles.clear();
    }
  }
  async function suggestAltText(item) {
    const shell = getShell();
    if (!shell?.ai?.ask || !shell.confirm) {
      return null;
    }
    const allowed = await shell.confirm({
      title: "Send media details to AI?",
      message: "The image URL, title and caption will be sent to the AI provider configured in OpenStation to draft alt text. The provider may fetch the image at that URL. Its terms and privacy policy apply.",
      confirmLabel: "Send and draft"
    });
    if (!allowed) {
      return null;
    }
    const answer = await shell.ai.ask(
      `Write concise, descriptive alt text (under 15 words, no quotes, no "image of") for a WordPress media item. Its file URL is ${item.url}, its title is "${item.title}" and its caption is "${item.caption}". Reply with the alt text only.`
    );
    const text = typeof answer === "string" ? answer : answer?.message;
    const alt = typeof text === "string" ? text.trim().replace(/^"|"$/g, "") : "";
    if (!alt || alt.length > 300) {
      throw new Error("The assistant did not return usable alt text.");
    }
    return alt;
  }
  function browserEncodeSupport() {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    return {
      jpeg: true,
      png: true,
      webp,
      // Via the lazy codec bundle, not the canvas.
      avif: typeof WebAssembly !== "undefined"
    };
  }
  let codecPromise = null;
  function loadCodec() {
    if (window.atmeCodec) {
      return Promise.resolve(window.atmeCodec);
    }
    if (!codecPromise) {
      codecPromise = new Promise((resolve, reject) => {
        const config = getConfig();
        const script = document.createElement("script");
        script.src = config.codecUrl;
        script.async = true;
        script.onload = () => {
          if (window.atmeCodec) {
            resolve(window.atmeCodec);
          } else {
            reject(new Error("The codec bundle loaded but registered nothing."));
          }
        };
        script.onerror = () => {
          codecPromise = null;
          script.remove();
          reject(new Error("The codec bundle could not be fetched."));
        };
        document.head.appendChild(script);
      });
    }
    return codecPromise;
  }
  async function readPixels(item) {
    const response = await fetch(item.url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("The original file could not be fetched.");
    }
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No 2D context — the browser is out of memory or headless.");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }
  async function encodeInBrowser(data, format, quality) {
    if ("avif" === format) {
      const codec = await loadCodec();
      const buffer = await codec.encodeAvif(data, quality);
      return new Blob([buffer], { type: "image/avif" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    canvas.getContext("2d")?.putImageData(data, 0, 0);
    const mime = "jpeg" === format ? "image/jpeg" : `image/${format}`;
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.type === mime) {
            resolve(blob);
          } else {
            reject(new Error(`This browser cannot encode ${format.toUpperCase()}.`));
          }
        },
        mime,
        quality / 100
      );
    });
  }
  async function downloadAs(item, format, quality = 82) {
    const data = await readPixels(item);
    const blob = await encodeInBrowser(data, format, quality);
    const stem = (item.url.split("/").pop() ?? `media-${item.id}`).replace(/\.[a-z0-9]+$/i, "");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${stem}.${"jpeg" === format ? "jpg" : format}`;
    link.rel = "noopener";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1e4);
  }
  var e = "undefined" != typeof self ? self : global;
  const t = "undefined" != typeof navigator, i = t && "undefined" == typeof HTMLImageElement, n = !("undefined" == typeof global || "undefined" == typeof process || !process.versions || !process.versions.node), s = e.Buffer, r = e.BigInt, a = !!s, o = (e2) => e2;
  function l(e2, t2 = o) {
    if (n) try {
      return "function" == typeof require ? Promise.resolve(t2(require(e2))) : import(
        /* webpackIgnore: true */
        e2
      ).then(t2);
    } catch (t3) {
      console.warn(`Couldn't load ${e2}`);
    }
  }
  let h = e.fetch;
  const u = (e2) => h = e2;
  if (!e.fetch) {
    const e2 = l("http", (e3) => e3), t2 = l("https", (e3) => e3), i2 = (n2, { headers: s2 } = {}) => new Promise(async (r2, a2) => {
      let { port: o2, hostname: l2, pathname: h2, protocol: u2, search: c2 } = new URL(n2);
      const f2 = { method: "GET", hostname: l2, path: encodeURI(h2) + c2, headers: s2 };
      "" !== o2 && (f2.port = Number(o2));
      const d2 = ("https:" === u2 ? await t2 : await e2).request(f2, (e3) => {
        if (301 === e3.statusCode || 302 === e3.statusCode) {
          let t3 = new URL(e3.headers.location, n2).toString();
          return i2(t3, { headers: s2 }).then(r2).catch(a2);
        }
        r2({ status: e3.statusCode, arrayBuffer: () => new Promise((t3) => {
          let i3 = [];
          e3.on("data", (e4) => i3.push(e4)), e3.on("end", () => t3(Buffer.concat(i3)));
        }) });
      });
      d2.on("error", a2), d2.end();
    });
    u(i2);
  }
  function c(e2, t2, i2) {
    return t2 in e2 ? Object.defineProperty(e2, t2, { value: i2, enumerable: true, configurable: true, writable: true }) : e2[t2] = i2, e2;
  }
  const f = (e2) => p(e2) ? void 0 : e2, d = (e2) => void 0 !== e2;
  function p(e2) {
    return void 0 === e2 || (e2 instanceof Map ? 0 === e2.size : 0 === Object.values(e2).filter(d).length);
  }
  function g(e2) {
    let t2 = new Error(e2);
    throw delete t2.stack, t2;
  }
  function m(e2) {
    return "" === (e2 = function(e3) {
      for (; e3.endsWith("\0"); ) e3 = e3.slice(0, -1);
      return e3;
    }(e2).trim()) ? void 0 : e2;
  }
  function S(e2) {
    let t2 = function(e3) {
      let t3 = 0;
      return e3.ifd0.enabled && (t3 += 1024), e3.exif.enabled && (t3 += 2048), e3.makerNote && (t3 += 2048), e3.userComment && (t3 += 1024), e3.gps.enabled && (t3 += 512), e3.interop.enabled && (t3 += 100), e3.ifd1.enabled && (t3 += 1024), t3 + 2048;
    }(e2);
    return e2.jfif.enabled && (t2 += 50), e2.xmp.enabled && (t2 += 2e4), e2.iptc.enabled && (t2 += 14e3), e2.icc.enabled && (t2 += 6e3), t2;
  }
  const C = (e2) => String.fromCharCode.apply(null, e2), y = "undefined" != typeof TextDecoder ? new TextDecoder("utf-8") : void 0;
  function b(e2) {
    return y ? y.decode(e2) : a ? Buffer.from(e2).toString("utf8") : decodeURIComponent(escape(C(e2)));
  }
  class I {
    static from(e2, t2) {
      return e2 instanceof this && e2.le === t2 ? e2 : new I(e2, void 0, void 0, t2);
    }
    constructor(e2, t2 = 0, i2, n2) {
      if ("boolean" == typeof n2 && (this.le = n2), Array.isArray(e2) && (e2 = new Uint8Array(e2)), 0 === e2) this.byteOffset = 0, this.byteLength = 0;
      else if (e2 instanceof ArrayBuffer) {
        void 0 === i2 && (i2 = e2.byteLength - t2);
        let n3 = new DataView(e2, t2, i2);
        this._swapDataView(n3);
      } else if (e2 instanceof Uint8Array || e2 instanceof DataView || e2 instanceof I) {
        void 0 === i2 && (i2 = e2.byteLength - t2), (t2 += e2.byteOffset) + i2 > e2.byteOffset + e2.byteLength && g("Creating view outside of available memory in ArrayBuffer");
        let n3 = new DataView(e2.buffer, t2, i2);
        this._swapDataView(n3);
      } else if ("number" == typeof e2) {
        let t3 = new DataView(new ArrayBuffer(e2));
        this._swapDataView(t3);
      } else g("Invalid input argument for BufferView: " + e2);
    }
    _swapArrayBuffer(e2) {
      this._swapDataView(new DataView(e2));
    }
    _swapBuffer(e2) {
      this._swapDataView(new DataView(e2.buffer, e2.byteOffset, e2.byteLength));
    }
    _swapDataView(e2) {
      this.dataView = e2, this.buffer = e2.buffer, this.byteOffset = e2.byteOffset, this.byteLength = e2.byteLength;
    }
    _lengthToEnd(e2) {
      return this.byteLength - e2;
    }
    set(e2, t2, i2 = I) {
      return e2 instanceof DataView || e2 instanceof I ? e2 = new Uint8Array(e2.buffer, e2.byteOffset, e2.byteLength) : e2 instanceof ArrayBuffer && (e2 = new Uint8Array(e2)), e2 instanceof Uint8Array || g("BufferView.set(): Invalid data argument."), this.toUint8().set(e2, t2), new i2(this, t2, e2.byteLength);
    }
    subarray(e2, t2) {
      return t2 = t2 || this._lengthToEnd(e2), new I(this, e2, t2);
    }
    toUint8() {
      return new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
    }
    getUint8Array(e2, t2) {
      return new Uint8Array(this.buffer, this.byteOffset + e2, t2);
    }
    getString(e2 = 0, t2 = this.byteLength) {
      return b(this.getUint8Array(e2, t2));
    }
    getLatin1String(e2 = 0, t2 = this.byteLength) {
      let i2 = this.getUint8Array(e2, t2);
      return C(i2);
    }
    getUnicodeString(e2 = 0, t2 = this.byteLength) {
      const i2 = [];
      for (let n2 = 0; n2 < t2 && e2 + n2 < this.byteLength; n2 += 2) i2.push(this.getUint16(e2 + n2));
      return C(i2);
    }
    getInt8(e2) {
      return this.dataView.getInt8(e2);
    }
    getUint8(e2) {
      return this.dataView.getUint8(e2);
    }
    getInt16(e2, t2 = this.le) {
      return this.dataView.getInt16(e2, t2);
    }
    getInt32(e2, t2 = this.le) {
      return this.dataView.getInt32(e2, t2);
    }
    getUint16(e2, t2 = this.le) {
      return this.dataView.getUint16(e2, t2);
    }
    getUint32(e2, t2 = this.le) {
      return this.dataView.getUint32(e2, t2);
    }
    getFloat32(e2, t2 = this.le) {
      return this.dataView.getFloat32(e2, t2);
    }
    getFloat64(e2, t2 = this.le) {
      return this.dataView.getFloat64(e2, t2);
    }
    getFloat(e2, t2 = this.le) {
      return this.dataView.getFloat32(e2, t2);
    }
    getDouble(e2, t2 = this.le) {
      return this.dataView.getFloat64(e2, t2);
    }
    getUintBytes(e2, t2, i2) {
      switch (t2) {
        case 1:
          return this.getUint8(e2, i2);
        case 2:
          return this.getUint16(e2, i2);
        case 4:
          return this.getUint32(e2, i2);
        case 8:
          return this.getUint64 && this.getUint64(e2, i2);
      }
    }
    getUint(e2, t2, i2) {
      switch (t2) {
        case 8:
          return this.getUint8(e2, i2);
        case 16:
          return this.getUint16(e2, i2);
        case 32:
          return this.getUint32(e2, i2);
        case 64:
          return this.getUint64 && this.getUint64(e2, i2);
      }
    }
    toString(e2) {
      return this.dataView.toString(e2, this.constructor.name);
    }
    ensureChunk() {
    }
  }
  function P(e2, t2) {
    g(`${e2} '${t2}' was not loaded, try using full build of exifr.`);
  }
  class k extends Map {
    constructor(e2) {
      super(), this.kind = e2;
    }
    get(e2, t2) {
      return this.has(e2) || P(this.kind, e2), t2 && (e2 in t2 || function(e3, t3) {
        g(`Unknown ${e3} '${t3}'.`);
      }(this.kind, e2), t2[e2].enabled || P(this.kind, e2)), super.get(e2);
    }
    keyList() {
      return Array.from(this.keys());
    }
  }
  var w = new k("file parser"), T = new k("segment parser"), A = new k("file reader");
  function D(e2, n2) {
    return "string" == typeof e2 ? O(e2, n2) : t && !i && e2 instanceof HTMLImageElement ? O(e2.src, n2) : e2 instanceof Uint8Array || e2 instanceof ArrayBuffer || e2 instanceof DataView ? new I(e2) : t && e2 instanceof Blob ? x(e2, n2, "blob", R) : void g("Invalid input argument");
  }
  function O(e2, i2) {
    return (s2 = e2).startsWith("data:") || s2.length > 1e4 ? v(e2, i2, "base64") : n && e2.includes("://") ? x(e2, i2, "url", M) : n ? v(e2, i2, "fs") : t ? x(e2, i2, "url", M) : void g("Invalid input argument");
    var s2;
  }
  async function x(e2, t2, i2, n2) {
    return A.has(i2) ? v(e2, t2, i2) : n2 ? async function(e3, t3) {
      let i3 = await t3(e3);
      return new I(i3);
    }(e2, n2) : void g(`Parser ${i2} is not loaded`);
  }
  async function v(e2, t2, i2) {
    let n2 = new (A.get(i2))(e2, t2);
    return await n2.read(), n2;
  }
  const M = (e2) => h(e2).then((e3) => e3.arrayBuffer()), R = (e2) => new Promise((t2, i2) => {
    let n2 = new FileReader();
    n2.onloadend = () => t2(n2.result || new ArrayBuffer()), n2.onerror = i2, n2.readAsArrayBuffer(e2);
  });
  class L extends Map {
    get tagKeys() {
      return this.allKeys || (this.allKeys = Array.from(this.keys())), this.allKeys;
    }
    get tagValues() {
      return this.allValues || (this.allValues = Array.from(this.values())), this.allValues;
    }
  }
  function U(e2, t2, i2) {
    let n2 = new L();
    for (let [e3, t3] of i2) n2.set(e3, t3);
    if (Array.isArray(t2)) for (let i3 of t2) e2.set(i3, n2);
    else e2.set(t2, n2);
    return n2;
  }
  function F(e2, t2, i2) {
    let n2, s2 = e2.get(t2);
    for (n2 of i2) s2.set(n2[0], n2[1]);
  }
  const E = /* @__PURE__ */ new Map(), B = /* @__PURE__ */ new Map(), N = /* @__PURE__ */ new Map(), G = ["chunked", "firstChunkSize", "firstChunkSizeNode", "firstChunkSizeBrowser", "chunkSize", "chunkLimit"], V = ["jfif", "xmp", "icc", "iptc", "ihdr"], z = ["tiff", ...V], H = ["ifd0", "ifd1", "exif", "gps", "interop"], j = [...z, ...H], W = ["makerNote", "userComment"], K = ["translateKeys", "translateValues", "reviveValues", "multiSegment"], X = [...K, "sanitize", "mergeOutput", "silentErrors"];
  class _ {
    get translate() {
      return this.translateKeys || this.translateValues || this.reviveValues;
    }
  }
  class Y extends _ {
    get needed() {
      return this.enabled || this.deps.size > 0;
    }
    constructor(e2, t2, i2, n2) {
      if (super(), c(this, "enabled", false), c(this, "skip", /* @__PURE__ */ new Set()), c(this, "pick", /* @__PURE__ */ new Set()), c(this, "deps", /* @__PURE__ */ new Set()), c(this, "translateKeys", false), c(this, "translateValues", false), c(this, "reviveValues", false), this.key = e2, this.enabled = t2, this.parse = this.enabled, this.applyInheritables(n2), this.canBeFiltered = H.includes(e2), this.canBeFiltered && (this.dict = E.get(e2)), void 0 !== i2) if (Array.isArray(i2)) this.parse = this.enabled = true, this.canBeFiltered && i2.length > 0 && this.translateTagSet(i2, this.pick);
      else if ("object" == typeof i2) {
        if (this.enabled = true, this.parse = false !== i2.parse, this.canBeFiltered) {
          let { pick: e3, skip: t3 } = i2;
          e3 && e3.length > 0 && this.translateTagSet(e3, this.pick), t3 && t3.length > 0 && this.translateTagSet(t3, this.skip);
        }
        this.applyInheritables(i2);
      } else true === i2 || false === i2 ? this.parse = this.enabled = i2 : g(`Invalid options argument: ${i2}`);
    }
    applyInheritables(e2) {
      let t2, i2;
      for (t2 of K) i2 = e2[t2], void 0 !== i2 && (this[t2] = i2);
    }
    translateTagSet(e2, t2) {
      if (this.dict) {
        let i2, n2, { tagKeys: s2, tagValues: r2 } = this.dict;
        for (i2 of e2) "string" == typeof i2 ? (n2 = r2.indexOf(i2), -1 === n2 && (n2 = s2.indexOf(Number(i2))), -1 !== n2 && t2.add(Number(s2[n2]))) : t2.add(i2);
      } else for (let i2 of e2) t2.add(i2);
    }
    finalizeFilters() {
      !this.enabled && this.deps.size > 0 ? (this.enabled = true, ee(this.pick, this.deps)) : this.enabled && this.pick.size > 0 && ee(this.pick, this.deps);
    }
  }
  var $ = { jfif: false, tiff: true, xmp: false, icc: false, iptc: false, ifd0: true, ifd1: false, exif: true, gps: true, interop: false, ihdr: void 0, makerNote: false, userComment: false, multiSegment: false, skip: [], pick: [], translateKeys: true, translateValues: true, reviveValues: true, sanitize: true, mergeOutput: true, silentErrors: true, chunked: true, firstChunkSize: void 0, firstChunkSizeNode: 512, firstChunkSizeBrowser: 65536, chunkSize: 65536, chunkLimit: 5 }, J = /* @__PURE__ */ new Map();
  class q extends _ {
    static useCached(e2) {
      let t2 = J.get(e2);
      return void 0 !== t2 || (t2 = new this(e2), J.set(e2, t2)), t2;
    }
    constructor(e2) {
      super(), true === e2 ? this.setupFromTrue() : void 0 === e2 ? this.setupFromUndefined() : Array.isArray(e2) ? this.setupFromArray(e2) : "object" == typeof e2 ? this.setupFromObject(e2) : g(`Invalid options argument ${e2}`), void 0 === this.firstChunkSize && (this.firstChunkSize = t ? this.firstChunkSizeBrowser : this.firstChunkSizeNode), this.mergeOutput && (this.ifd1.enabled = false), this.filterNestedSegmentTags(), this.traverseTiffDependencyTree(), this.checkLoadedPlugins();
    }
    setupFromUndefined() {
      let e2;
      for (e2 of G) this[e2] = $[e2];
      for (e2 of X) this[e2] = $[e2];
      for (e2 of W) this[e2] = $[e2];
      for (e2 of j) this[e2] = new Y(e2, $[e2], void 0, this);
    }
    setupFromTrue() {
      let e2;
      for (e2 of G) this[e2] = $[e2];
      for (e2 of X) this[e2] = $[e2];
      for (e2 of W) this[e2] = true;
      for (e2 of j) this[e2] = new Y(e2, true, void 0, this);
    }
    setupFromArray(e2) {
      let t2;
      for (t2 of G) this[t2] = $[t2];
      for (t2 of X) this[t2] = $[t2];
      for (t2 of W) this[t2] = $[t2];
      for (t2 of j) this[t2] = new Y(t2, false, void 0, this);
      this.setupGlobalFilters(e2, void 0, H);
    }
    setupFromObject(e2) {
      let t2;
      for (t2 of (H.ifd0 = H.ifd0 || H.image, H.ifd1 = H.ifd1 || H.thumbnail, Object.assign(this, e2), G)) this[t2] = Z(e2[t2], $[t2]);
      for (t2 of X) this[t2] = Z(e2[t2], $[t2]);
      for (t2 of W) this[t2] = Z(e2[t2], $[t2]);
      for (t2 of z) this[t2] = new Y(t2, $[t2], e2[t2], this);
      for (t2 of H) this[t2] = new Y(t2, $[t2], e2[t2], this.tiff);
      this.setupGlobalFilters(e2.pick, e2.skip, H, j), true === e2.tiff ? this.batchEnableWithBool(H, true) : false === e2.tiff ? this.batchEnableWithUserValue(H, e2) : Array.isArray(e2.tiff) ? this.setupGlobalFilters(e2.tiff, void 0, H) : "object" == typeof e2.tiff && this.setupGlobalFilters(e2.tiff.pick, e2.tiff.skip, H);
    }
    batchEnableWithBool(e2, t2) {
      for (let i2 of e2) this[i2].enabled = t2;
    }
    batchEnableWithUserValue(e2, t2) {
      for (let i2 of e2) {
        let e3 = t2[i2];
        this[i2].enabled = false !== e3 && void 0 !== e3;
      }
    }
    setupGlobalFilters(e2, t2, i2, n2 = i2) {
      if (e2 && e2.length) {
        for (let e3 of n2) this[e3].enabled = false;
        let t3 = Q(e2, i2);
        for (let [e3, i3] of t3) ee(this[e3].pick, i3), this[e3].enabled = true;
      } else if (t2 && t2.length) {
        let e3 = Q(t2, i2);
        for (let [t3, i3] of e3) ee(this[t3].skip, i3);
      }
    }
    filterNestedSegmentTags() {
      let { ifd0: e2, exif: t2, xmp: i2, iptc: n2, icc: s2 } = this;
      this.makerNote ? t2.deps.add(37500) : t2.skip.add(37500), this.userComment ? t2.deps.add(37510) : t2.skip.add(37510), i2.enabled || e2.skip.add(700), n2.enabled || e2.skip.add(33723), s2.enabled || e2.skip.add(34675);
    }
    traverseTiffDependencyTree() {
      let { ifd0: e2, exif: t2, gps: i2, interop: n2 } = this;
      n2.needed && (t2.deps.add(40965), e2.deps.add(40965)), t2.needed && e2.deps.add(34665), i2.needed && e2.deps.add(34853), this.tiff.enabled = H.some((e3) => true === this[e3].enabled) || this.makerNote || this.userComment;
      for (let e3 of H) this[e3].finalizeFilters();
    }
    get onlyTiff() {
      return !V.map((e2) => this[e2].enabled).some((e2) => true === e2) && this.tiff.enabled;
    }
    checkLoadedPlugins() {
      for (let e2 of z) this[e2].enabled && !T.has(e2) && P("segment parser", e2);
    }
  }
  function Q(e2, t2) {
    let i2, n2, s2, r2, a2 = [];
    for (s2 of t2) {
      for (r2 of (i2 = E.get(s2), n2 = [], i2)) (e2.includes(r2[0]) || e2.includes(r2[1])) && n2.push(r2[0]);
      n2.length && a2.push([s2, n2]);
    }
    return a2;
  }
  function Z(e2, t2) {
    return void 0 !== e2 ? e2 : void 0 !== t2 ? t2 : void 0;
  }
  function ee(e2, t2) {
    for (let i2 of t2) e2.add(i2);
  }
  c(q, "default", $);
  class te {
    constructor(e2) {
      c(this, "parsers", {}), c(this, "output", {}), c(this, "errors", []), c(this, "pushToErrors", (e3) => this.errors.push(e3)), this.options = q.useCached(e2);
    }
    async read(e2) {
      this.file = await D(e2, this.options);
    }
    setup() {
      if (this.fileParser) return;
      let { file: e2 } = this, t2 = e2.getUint16(0);
      for (let [i2, n2] of w) if (n2.canHandle(e2, t2)) return this.fileParser = new n2(this.options, this.file, this.parsers), e2[i2] = true;
      this.file.close && this.file.close(), g("Unknown file format");
    }
    async parse() {
      let { output: e2, errors: t2 } = this;
      return this.setup(), this.options.silentErrors ? (await this.executeParsers().catch(this.pushToErrors), t2.push(...this.fileParser.errors)) : await this.executeParsers(), this.file.close && this.file.close(), this.options.silentErrors && t2.length > 0 && (e2.errors = t2), f(e2);
    }
    async executeParsers() {
      let { output: e2 } = this;
      await this.fileParser.parse();
      let t2 = Object.values(this.parsers).map(async (t3) => {
        let i2 = await t3.parse();
        t3.assignToOutput(e2, i2);
      });
      this.options.silentErrors && (t2 = t2.map((e3) => e3.catch(this.pushToErrors))), await Promise.all(t2);
    }
    async extractThumbnail() {
      this.setup();
      let { options: e2, file: t2 } = this, i2 = T.get("tiff", e2);
      var n2;
      if (t2.tiff ? n2 = { start: 0, type: "tiff" } : t2.jpeg && (n2 = await this.fileParser.getOrFindSegment("tiff")), void 0 === n2) return;
      let s2 = await this.fileParser.ensureSegmentChunk(n2), r2 = this.parsers.tiff = new i2(s2, e2, t2), a2 = await r2.extractThumbnail();
      return t2.close && t2.close(), a2;
    }
  }
  async function ie(e2, t2) {
    let i2 = new te(t2);
    return await i2.read(e2), i2.parse();
  }
  var ne = Object.freeze({ __proto__: null, parse: ie, Exifr: te, fileParsers: w, segmentParsers: T, fileReaders: A, tagKeys: E, tagValues: B, tagRevivers: N, createDictionary: U, extendDictionary: F, fetchUrlAsArrayBuffer: M, readBlobAsArrayBuffer: R, chunkedProps: G, otherSegments: V, segments: z, tiffBlocks: H, segmentsAndBlocks: j, tiffExtractables: W, inheritables: K, allFormatters: X, Options: q });
  class se {
    constructor(e2, t2, i2) {
      c(this, "errors", []), c(this, "ensureSegmentChunk", async (e3) => {
        let t3 = e3.start, i3 = e3.size || 65536;
        if (this.file.chunked) if (this.file.available(t3, i3)) e3.chunk = this.file.subarray(t3, i3);
        else try {
          e3.chunk = await this.file.readChunk(t3, i3);
        } catch (t4) {
          g(`Couldn't read segment: ${JSON.stringify(e3)}. ${t4.message}`);
        }
        else this.file.byteLength > t3 + i3 ? e3.chunk = this.file.subarray(t3, i3) : void 0 === e3.size ? e3.chunk = this.file.subarray(t3) : g("Segment unreachable: " + JSON.stringify(e3));
        return e3.chunk;
      }), this.extendOptions && this.extendOptions(e2), this.options = e2, this.file = t2, this.parsers = i2;
    }
    injectSegment(e2, t2) {
      this.options[e2].enabled && this.createParser(e2, t2);
    }
    createParser(e2, t2) {
      let i2 = new (T.get(e2))(t2, this.options, this.file);
      return this.parsers[e2] = i2;
    }
    createParsers(e2) {
      for (let t2 of e2) {
        let { type: e3, chunk: i2 } = t2, n2 = this.options[e3];
        if (n2 && n2.enabled) {
          let t3 = this.parsers[e3];
          t3 && t3.append || t3 || this.createParser(e3, i2);
        }
      }
    }
    async readSegments(e2) {
      let t2 = e2.map(this.ensureSegmentChunk);
      await Promise.all(t2);
    }
  }
  class re {
    static findPosition(e2, t2) {
      let i2 = e2.getUint16(t2 + 2) + 2, n2 = "function" == typeof this.headerLength ? this.headerLength(e2, t2, i2) : this.headerLength, s2 = t2 + n2, r2 = i2 - n2;
      return { offset: t2, length: i2, headerLength: n2, start: s2, size: r2, end: s2 + r2 };
    }
    static parse(e2, t2 = {}) {
      return new this(e2, new q({ [this.type]: t2 }), e2).parse();
    }
    normalizeInput(e2) {
      return e2 instanceof I ? e2 : new I(e2);
    }
    constructor(e2, t2 = {}, i2) {
      c(this, "errors", []), c(this, "raw", /* @__PURE__ */ new Map()), c(this, "handleError", (e3) => {
        if (!this.options.silentErrors) throw e3;
        this.errors.push(e3.message);
      }), this.chunk = this.normalizeInput(e2), this.file = i2, this.type = this.constructor.type, this.globalOptions = this.options = t2, this.localOptions = t2[this.type], this.canTranslate = this.localOptions && this.localOptions.translate;
    }
    translate() {
      this.canTranslate && (this.translated = this.translateBlock(this.raw, this.type));
    }
    get output() {
      return this.translated ? this.translated : this.raw ? Object.fromEntries(this.raw) : void 0;
    }
    translateBlock(e2, t2) {
      let i2 = N.get(t2), n2 = B.get(t2), s2 = E.get(t2), r2 = this.options[t2], a2 = r2.reviveValues && !!i2, o2 = r2.translateValues && !!n2, l2 = r2.translateKeys && !!s2, h2 = {};
      for (let [t3, r3] of e2) a2 && i2.has(t3) ? r3 = i2.get(t3)(r3) : o2 && n2.has(t3) && (r3 = this.translateValue(r3, n2.get(t3))), l2 && s2.has(t3) && (t3 = s2.get(t3) || t3), h2[t3] = r3;
      return h2;
    }
    translateValue(e2, t2) {
      return t2[e2] || t2.DEFAULT || e2;
    }
    assignToOutput(e2, t2) {
      this.assignObjectToOutput(e2, this.constructor.type, t2);
    }
    assignObjectToOutput(e2, t2, i2) {
      if (this.globalOptions.mergeOutput) return Object.assign(e2, i2);
      e2[t2] ? Object.assign(e2[t2], i2) : e2[t2] = i2;
    }
  }
  c(re, "headerLength", 4), c(re, "type", void 0), c(re, "multiSegment", false), c(re, "canHandle", () => false);
  function ae(e2) {
    return 192 === e2 || 194 === e2 || 196 === e2 || 219 === e2 || 221 === e2 || 218 === e2 || 254 === e2;
  }
  function oe(e2) {
    return e2 >= 224 && e2 <= 239;
  }
  function le(e2, t2, i2) {
    for (let [n2, s2] of T) if (s2.canHandle(e2, t2, i2)) return n2;
  }
  class he extends se {
    constructor(...e2) {
      super(...e2), c(this, "appSegments", []), c(this, "jpegSegments", []), c(this, "unknownSegments", []);
    }
    static canHandle(e2, t2) {
      return 65496 === t2;
    }
    async parse() {
      await this.findAppSegments(), await this.readSegments(this.appSegments), this.mergeMultiSegments(), this.createParsers(this.mergedAppSegments || this.appSegments);
    }
    setupSegmentFinderArgs(e2) {
      true === e2 ? (this.findAll = true, this.wanted = new Set(T.keyList())) : (e2 = void 0 === e2 ? T.keyList().filter((e3) => this.options[e3].enabled) : e2.filter((e3) => this.options[e3].enabled && T.has(e3)), this.findAll = false, this.remaining = new Set(e2), this.wanted = new Set(e2)), this.unfinishedMultiSegment = false;
    }
    async findAppSegments(e2 = 0, t2) {
      this.setupSegmentFinderArgs(t2);
      let { file: i2, findAll: n2, wanted: s2, remaining: r2 } = this;
      if (!n2 && this.file.chunked && (n2 = Array.from(s2).some((e3) => {
        let t3 = T.get(e3), i3 = this.options[e3];
        return t3.multiSegment && i3.multiSegment;
      }), n2 && await this.file.readWhole()), e2 = this.findAppSegmentsInRange(e2, i2.byteLength), !this.options.onlyTiff && i2.chunked) {
        let t3 = false;
        for (; r2.size > 0 && !t3 && (i2.canReadNextChunk || this.unfinishedMultiSegment); ) {
          let { nextChunkOffset: n3 } = i2, s3 = this.appSegments.some((e3) => !this.file.available(e3.offset || e3.start, e3.length || e3.size));
          if (t3 = e2 > n3 && !s3 ? !await i2.readNextChunk(e2) : !await i2.readNextChunk(n3), void 0 === (e2 = this.findAppSegmentsInRange(e2, i2.byteLength))) return;
        }
      }
    }
    findAppSegmentsInRange(e2, t2) {
      t2 -= 2;
      let i2, n2, s2, r2, a2, o2, { file: l2, findAll: h2, wanted: u2, remaining: c2, options: f2 } = this;
      for (; e2 < t2; e2++) if (255 === l2.getUint8(e2)) {
        if (i2 = l2.getUint8(e2 + 1), oe(i2)) {
          if (n2 = l2.getUint16(e2 + 2), s2 = le(l2, e2, n2), s2 && u2.has(s2) && (r2 = T.get(s2), a2 = r2.findPosition(l2, e2), o2 = f2[s2], a2.type = s2, this.appSegments.push(a2), !h2 && (r2.multiSegment && o2.multiSegment ? (this.unfinishedMultiSegment = a2.chunkNumber < a2.chunkCount, this.unfinishedMultiSegment || c2.delete(s2)) : c2.delete(s2), 0 === c2.size))) break;
          f2.recordUnknownSegments && (a2 = re.findPosition(l2, e2), a2.marker = i2, this.unknownSegments.push(a2)), e2 += n2 + 1;
        } else if (ae(i2)) {
          if (n2 = l2.getUint16(e2 + 2), 218 === i2 && false !== f2.stopAfterSos) return;
          f2.recordJpegSegments && this.jpegSegments.push({ offset: e2, length: n2, marker: i2 }), e2 += n2 + 1;
        }
      }
      return e2;
    }
    mergeMultiSegments() {
      if (!this.appSegments.some((e3) => e3.multiSegment)) return;
      let e2 = function(e3, t2) {
        let i2, n2, s2, r2 = /* @__PURE__ */ new Map();
        for (let a2 = 0; a2 < e3.length; a2++) i2 = e3[a2], n2 = i2[t2], r2.has(n2) ? s2 = r2.get(n2) : r2.set(n2, s2 = []), s2.push(i2);
        return Array.from(r2);
      }(this.appSegments, "type");
      this.mergedAppSegments = e2.map(([e3, t2]) => {
        let i2 = T.get(e3, this.options);
        if (i2.handleMultiSegments) {
          return { type: e3, chunk: i2.handleMultiSegments(t2) };
        }
        return t2[0];
      });
    }
    getSegment(e2) {
      return this.appSegments.find((t2) => t2.type === e2);
    }
    async getOrFindSegment(e2) {
      let t2 = this.getSegment(e2);
      return void 0 === t2 && (await this.findAppSegments(0, [e2]), t2 = this.getSegment(e2)), t2;
    }
  }
  c(he, "type", "jpeg"), w.set("jpeg", he);
  const ue = [void 0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  class ce extends re {
    parseHeader() {
      var e2 = this.chunk.getUint16();
      18761 === e2 ? this.le = true : 19789 === e2 && (this.le = false), this.chunk.le = this.le, this.headerParsed = true;
    }
    parseTags(e2, t2, i2 = /* @__PURE__ */ new Map()) {
      let { pick: n2, skip: s2 } = this.options[t2];
      n2 = new Set(n2);
      let r2 = n2.size > 0, a2 = 0 === s2.size, o2 = this.chunk.getUint16(e2);
      e2 += 2;
      for (let l2 = 0; l2 < o2; l2++) {
        let o3 = this.chunk.getUint16(e2);
        if (r2) {
          if (n2.has(o3) && (i2.set(o3, this.parseTag(e2, o3, t2)), n2.delete(o3), 0 === n2.size)) break;
        } else !a2 && s2.has(o3) || i2.set(o3, this.parseTag(e2, o3, t2));
        e2 += 12;
      }
      return i2;
    }
    parseTag(e2, t2, i2) {
      let { chunk: n2 } = this, s2 = n2.getUint16(e2 + 2), r2 = n2.getUint32(e2 + 4), a2 = ue[s2];
      if (a2 * r2 <= 4 ? e2 += 8 : e2 = n2.getUint32(e2 + 8), (s2 < 1 || s2 > 13) && g(`Invalid TIFF value type. block: ${i2.toUpperCase()}, tag: ${t2.toString(16)}, type: ${s2}, offset ${e2}`), e2 > n2.byteLength && g(`Invalid TIFF value offset. block: ${i2.toUpperCase()}, tag: ${t2.toString(16)}, type: ${s2}, offset ${e2} is outside of chunk size ${n2.byteLength}`), 1 === s2) return n2.getUint8Array(e2, r2);
      if (2 === s2) return m(n2.getString(e2, r2));
      if (7 === s2) return n2.getUint8Array(e2, r2);
      if (1 === r2) return this.parseTagValue(s2, e2);
      {
        let t3 = new (function(e3) {
          switch (e3) {
            case 1:
              return Uint8Array;
            case 3:
              return Uint16Array;
            case 4:
              return Uint32Array;
            case 5:
              return Array;
            case 6:
              return Int8Array;
            case 8:
              return Int16Array;
            case 9:
              return Int32Array;
            case 10:
              return Array;
            case 11:
              return Float32Array;
            case 12:
              return Float64Array;
            default:
              return Array;
          }
        }(s2))(r2), i3 = a2;
        for (let n3 = 0; n3 < r2; n3++) t3[n3] = this.parseTagValue(s2, e2), e2 += i3;
        return t3;
      }
    }
    parseTagValue(e2, t2) {
      let { chunk: i2 } = this;
      switch (e2) {
        case 1:
          return i2.getUint8(t2);
        case 3:
          return i2.getUint16(t2);
        case 4:
          return i2.getUint32(t2);
        case 5:
          return i2.getUint32(t2) / i2.getUint32(t2 + 4);
        case 6:
          return i2.getInt8(t2);
        case 8:
          return i2.getInt16(t2);
        case 9:
          return i2.getInt32(t2);
        case 10:
          return i2.getInt32(t2) / i2.getInt32(t2 + 4);
        case 11:
          return i2.getFloat(t2);
        case 12:
          return i2.getDouble(t2);
        case 13:
          return i2.getUint32(t2);
        default:
          g(`Invalid tiff type ${e2}`);
      }
    }
  }
  class fe extends ce {
    static canHandle(e2, t2) {
      return 225 === e2.getUint8(t2 + 1) && 1165519206 === e2.getUint32(t2 + 4) && 0 === e2.getUint16(t2 + 8);
    }
    async parse() {
      this.parseHeader();
      let { options: e2 } = this;
      return e2.ifd0.enabled && await this.parseIfd0Block(), e2.exif.enabled && await this.safeParse("parseExifBlock"), e2.gps.enabled && await this.safeParse("parseGpsBlock"), e2.interop.enabled && await this.safeParse("parseInteropBlock"), e2.ifd1.enabled && await this.safeParse("parseThumbnailBlock"), this.createOutput();
    }
    safeParse(e2) {
      let t2 = this[e2]();
      return void 0 !== t2.catch && (t2 = t2.catch(this.handleError)), t2;
    }
    findIfd0Offset() {
      void 0 === this.ifd0Offset && (this.ifd0Offset = this.chunk.getUint32(4));
    }
    findIfd1Offset() {
      if (void 0 === this.ifd1Offset) {
        this.findIfd0Offset();
        let e2 = this.chunk.getUint16(this.ifd0Offset), t2 = this.ifd0Offset + 2 + 12 * e2;
        this.ifd1Offset = this.chunk.getUint32(t2);
      }
    }
    parseBlock(e2, t2) {
      let i2 = /* @__PURE__ */ new Map();
      return this[t2] = i2, this.parseTags(e2, t2, i2), i2;
    }
    async parseIfd0Block() {
      if (this.ifd0) return;
      let { file: e2 } = this;
      this.findIfd0Offset(), this.ifd0Offset < 8 && g("Malformed EXIF data"), !e2.chunked && this.ifd0Offset > e2.byteLength && g(`IFD0 offset points to outside of file.
this.ifd0Offset: ${this.ifd0Offset}, file.byteLength: ${e2.byteLength}`), e2.tiff && await e2.ensureChunk(this.ifd0Offset, S(this.options));
      let t2 = this.parseBlock(this.ifd0Offset, "ifd0");
      return 0 !== t2.size ? (this.exifOffset = t2.get(34665), this.interopOffset = t2.get(40965), this.gpsOffset = t2.get(34853), this.xmp = t2.get(700), this.iptc = t2.get(33723), this.icc = t2.get(34675), this.options.sanitize && (t2.delete(34665), t2.delete(40965), t2.delete(34853), t2.delete(700), t2.delete(33723), t2.delete(34675)), t2) : void 0;
    }
    async parseExifBlock() {
      if (this.exif) return;
      if (this.ifd0 || await this.parseIfd0Block(), void 0 === this.exifOffset) return;
      this.file.tiff && await this.file.ensureChunk(this.exifOffset, S(this.options));
      let e2 = this.parseBlock(this.exifOffset, "exif");
      return this.interopOffset || (this.interopOffset = e2.get(40965)), this.makerNote = e2.get(37500), this.userComment = e2.get(37510), this.options.sanitize && (e2.delete(40965), e2.delete(37500), e2.delete(37510)), this.unpack(e2, 41728), this.unpack(e2, 41729), e2;
    }
    unpack(e2, t2) {
      let i2 = e2.get(t2);
      i2 && 1 === i2.length && e2.set(t2, i2[0]);
    }
    async parseGpsBlock() {
      if (this.gps) return;
      if (this.ifd0 || await this.parseIfd0Block(), void 0 === this.gpsOffset) return;
      let e2 = this.parseBlock(this.gpsOffset, "gps");
      return e2 && e2.has(2) && e2.has(4) && (e2.set("latitude", de(...e2.get(2), e2.get(1))), e2.set("longitude", de(...e2.get(4), e2.get(3)))), e2;
    }
    async parseInteropBlock() {
      if (!this.interop && (this.ifd0 || await this.parseIfd0Block(), void 0 !== this.interopOffset || this.exif || await this.parseExifBlock(), void 0 !== this.interopOffset)) return this.parseBlock(this.interopOffset, "interop");
    }
    async parseThumbnailBlock(e2 = false) {
      if (!this.ifd1 && !this.ifd1Parsed && (!this.options.mergeOutput || e2)) return this.findIfd1Offset(), this.ifd1Offset > 0 && (this.parseBlock(this.ifd1Offset, "ifd1"), this.ifd1Parsed = true), this.ifd1;
    }
    async extractThumbnail() {
      if (this.headerParsed || this.parseHeader(), this.ifd1Parsed || await this.parseThumbnailBlock(true), void 0 === this.ifd1) return;
      let e2 = this.ifd1.get(513), t2 = this.ifd1.get(514);
      return this.chunk.getUint8Array(e2, t2);
    }
    get image() {
      return this.ifd0;
    }
    get thumbnail() {
      return this.ifd1;
    }
    createOutput() {
      let e2, t2, i2, n2 = {};
      for (t2 of H) if (e2 = this[t2], !p(e2)) if (i2 = this.canTranslate ? this.translateBlock(e2, t2) : Object.fromEntries(e2), this.options.mergeOutput) {
        if ("ifd1" === t2) continue;
        Object.assign(n2, i2);
      } else n2[t2] = i2;
      return this.makerNote && (n2.makerNote = this.makerNote), this.userComment && (n2.userComment = this.userComment), n2;
    }
    assignToOutput(e2, t2) {
      if (this.globalOptions.mergeOutput) Object.assign(e2, t2);
      else for (let [i2, n2] of Object.entries(t2)) this.assignObjectToOutput(e2, i2, n2);
    }
  }
  function de(e2, t2, i2, n2) {
    var s2 = e2 + t2 / 60 + i2 / 3600;
    return "S" !== n2 && "W" !== n2 || (s2 *= -1), s2;
  }
  c(fe, "type", "tiff"), c(fe, "headerLength", 10), T.set("tiff", fe);
  var pe = Object.freeze({ __proto__: null, default: ne, Exifr: te, fileParsers: w, segmentParsers: T, fileReaders: A, tagKeys: E, tagValues: B, tagRevivers: N, createDictionary: U, extendDictionary: F, fetchUrlAsArrayBuffer: M, readBlobAsArrayBuffer: R, chunkedProps: G, otherSegments: V, segments: z, tiffBlocks: H, segmentsAndBlocks: j, tiffExtractables: W, inheritables: K, allFormatters: X, Options: q, parse: ie });
  const ge = { ifd0: false, ifd1: false, exif: false, gps: false, interop: false, sanitize: false, reviveValues: true, translateKeys: false, translateValues: false, mergeOutput: false }, me = Object.assign({}, ge, { firstChunkSize: 4e4, gps: [1, 2, 3, 4] });
  async function Se(e2) {
    let t2 = new te(me);
    await t2.read(e2);
    let i2 = await t2.parse();
    if (i2 && i2.gps) {
      let { latitude: e3, longitude: t3 } = i2.gps;
      return { latitude: e3, longitude: t3 };
    }
  }
  const Ce = Object.assign({}, ge, { tiff: false, ifd1: true, mergeOutput: false });
  async function ye(e2) {
    let t2 = new te(Ce);
    await t2.read(e2);
    let i2 = await t2.extractThumbnail();
    return i2 && a ? s.from(i2) : i2;
  }
  async function be(e2) {
    let t2 = await this.thumbnail(e2);
    if (void 0 !== t2) {
      let e3 = new Blob([t2]);
      return URL.createObjectURL(e3);
    }
  }
  const Ie = Object.assign({}, ge, { firstChunkSize: 4e4, ifd0: [274] });
  async function Pe(e2) {
    let t2 = new te(Ie);
    await t2.read(e2);
    let i2 = await t2.parse();
    if (i2 && i2.ifd0) return i2.ifd0[274];
  }
  const ke = Object.freeze({ 1: { dimensionSwapped: false, scaleX: 1, scaleY: 1, deg: 0, rad: 0 }, 2: { dimensionSwapped: false, scaleX: -1, scaleY: 1, deg: 0, rad: 0 }, 3: { dimensionSwapped: false, scaleX: 1, scaleY: 1, deg: 180, rad: 180 * Math.PI / 180 }, 4: { dimensionSwapped: false, scaleX: -1, scaleY: 1, deg: 180, rad: 180 * Math.PI / 180 }, 5: { dimensionSwapped: true, scaleX: 1, scaleY: -1, deg: 90, rad: 90 * Math.PI / 180 }, 6: { dimensionSwapped: true, scaleX: 1, scaleY: 1, deg: 90, rad: 90 * Math.PI / 180 }, 7: { dimensionSwapped: true, scaleX: 1, scaleY: -1, deg: 270, rad: 270 * Math.PI / 180 }, 8: { dimensionSwapped: true, scaleX: 1, scaleY: 1, deg: 270, rad: 270 * Math.PI / 180 } });
  let we = true, Te = true;
  if ("object" == typeof navigator) {
    let e2 = navigator.userAgent;
    if (e2.includes("iPad") || e2.includes("iPhone")) {
      let t2 = e2.match(/OS (\d+)_(\d+)/);
      if (t2) {
        let [, e3, i2] = t2, n2 = Number(e3) + 0.1 * Number(i2);
        we = n2 < 13.4, Te = false;
      }
    } else if (e2.includes("OS X 10")) {
      let [, t2] = e2.match(/OS X 10[_.](\d+)/);
      we = Te = Number(t2) < 15;
    }
    if (e2.includes("Chrome/")) {
      let [, t2] = e2.match(/Chrome\/(\d+)/);
      we = Te = Number(t2) < 81;
    } else if (e2.includes("Firefox/")) {
      let [, t2] = e2.match(/Firefox\/(\d+)/);
      we = Te = Number(t2) < 77;
    }
  }
  async function Ae(e2) {
    let t2 = await Pe(e2);
    return Object.assign({ canvas: we, css: Te }, ke[t2]);
  }
  class De extends I {
    constructor(...e2) {
      super(...e2), c(this, "ranges", new Oe()), 0 !== this.byteLength && this.ranges.add(0, this.byteLength);
    }
    _tryExtend(e2, t2, i2) {
      if (0 === e2 && 0 === this.byteLength && i2) {
        let e3 = new DataView(i2.buffer || i2, i2.byteOffset, i2.byteLength);
        this._swapDataView(e3);
      } else {
        let i3 = e2 + t2;
        if (i3 > this.byteLength) {
          let { dataView: e3 } = this._extend(i3);
          this._swapDataView(e3);
        }
      }
    }
    _extend(e2) {
      let t2;
      t2 = a ? s.allocUnsafe(e2) : new Uint8Array(e2);
      let i2 = new DataView(t2.buffer, t2.byteOffset, t2.byteLength);
      return t2.set(new Uint8Array(this.buffer, this.byteOffset, this.byteLength), 0), { uintView: t2, dataView: i2 };
    }
    subarray(e2, t2, i2 = false) {
      return t2 = t2 || this._lengthToEnd(e2), i2 && this._tryExtend(e2, t2), this.ranges.add(e2, t2), super.subarray(e2, t2);
    }
    set(e2, t2, i2 = false) {
      i2 && this._tryExtend(t2, e2.byteLength, e2);
      let n2 = super.set(e2, t2);
      return this.ranges.add(t2, n2.byteLength), n2;
    }
    async ensureChunk(e2, t2) {
      this.chunked && (this.ranges.available(e2, t2) || await this.readChunk(e2, t2));
    }
    available(e2, t2) {
      return this.ranges.available(e2, t2);
    }
  }
  class Oe {
    constructor() {
      c(this, "list", []);
    }
    get length() {
      return this.list.length;
    }
    add(e2, t2, i2 = 0) {
      let n2 = e2 + t2, s2 = this.list.filter((t3) => xe(e2, t3.offset, n2) || xe(e2, t3.end, n2));
      if (s2.length > 0) {
        e2 = Math.min(e2, ...s2.map((e3) => e3.offset)), n2 = Math.max(n2, ...s2.map((e3) => e3.end)), t2 = n2 - e2;
        let i3 = s2.shift();
        i3.offset = e2, i3.length = t2, i3.end = n2, this.list = this.list.filter((e3) => !s2.includes(e3));
      } else this.list.push({ offset: e2, length: t2, end: n2 });
    }
    available(e2, t2) {
      let i2 = e2 + t2;
      return this.list.some((t3) => t3.offset <= e2 && i2 <= t3.end);
    }
  }
  function xe(e2, t2, i2) {
    return e2 <= t2 && t2 <= i2;
  }
  class ve extends De {
    constructor(e2, t2) {
      super(0), c(this, "chunksRead", 0), this.input = e2, this.options = t2;
    }
    async readWhole() {
      this.chunked = false, await this.readChunk(this.nextChunkOffset);
    }
    async readChunked() {
      this.chunked = true, await this.readChunk(0, this.options.firstChunkSize);
    }
    async readNextChunk(e2 = this.nextChunkOffset) {
      if (this.fullyRead) return this.chunksRead++, false;
      let t2 = this.options.chunkSize, i2 = await this.readChunk(e2, t2);
      return !!i2 && i2.byteLength === t2;
    }
    async readChunk(e2, t2) {
      if (this.chunksRead++, 0 !== (t2 = this.safeWrapAddress(e2, t2))) return this._readChunk(e2, t2);
    }
    safeWrapAddress(e2, t2) {
      return void 0 !== this.size && e2 + t2 > this.size ? Math.max(0, this.size - e2) : t2;
    }
    get nextChunkOffset() {
      if (0 !== this.ranges.list.length) return this.ranges.list[0].length;
    }
    get canReadNextChunk() {
      return this.chunksRead < this.options.chunkLimit;
    }
    get fullyRead() {
      return void 0 !== this.size && this.nextChunkOffset === this.size;
    }
    read() {
      return this.options.chunked ? this.readChunked() : this.readWhole();
    }
    close() {
    }
  }
  A.set("blob", class extends ve {
    async readWhole() {
      this.chunked = false;
      let e2 = await R(this.input);
      this._swapArrayBuffer(e2);
    }
    readChunked() {
      return this.chunked = true, this.size = this.input.size, super.readChunked();
    }
    async _readChunk(e2, t2) {
      let i2 = t2 ? e2 + t2 : void 0, n2 = this.input.slice(e2, i2), s2 = await R(n2);
      return this.set(s2, e2, true);
    }
  });
  var Me = Object.freeze({ __proto__: null, default: pe, Exifr: te, fileParsers: w, segmentParsers: T, fileReaders: A, tagKeys: E, tagValues: B, tagRevivers: N, createDictionary: U, extendDictionary: F, fetchUrlAsArrayBuffer: M, readBlobAsArrayBuffer: R, chunkedProps: G, otherSegments: V, segments: z, tiffBlocks: H, segmentsAndBlocks: j, tiffExtractables: W, inheritables: K, allFormatters: X, Options: q, parse: ie, gpsOnlyOptions: me, gps: Se, thumbnailOnlyOptions: Ce, thumbnail: ye, thumbnailUrl: be, orientationOnlyOptions: Ie, orientation: Pe, rotations: ke, get rotateCanvas() {
    return we;
  }, get rotateCss() {
    return Te;
  }, rotation: Ae });
  A.set("url", class extends ve {
    async readWhole() {
      this.chunked = false;
      let e2 = await M(this.input);
      e2 instanceof ArrayBuffer ? this._swapArrayBuffer(e2) : e2 instanceof Uint8Array && this._swapBuffer(e2);
    }
    async _readChunk(e2, t2) {
      let i2 = t2 ? e2 + t2 - 1 : void 0, n2 = this.options.httpHeaders || {};
      (e2 || i2) && (n2.range = `bytes=${[e2, i2].join("-")}`);
      let s2 = await h(this.input, { headers: n2 }), r2 = await s2.arrayBuffer(), a2 = r2.byteLength;
      if (416 !== s2.status) return a2 !== t2 && (this.size = e2 + a2), this.set(r2, e2, true);
    }
  });
  I.prototype.getUint64 = function(e2) {
    let t2 = this.getUint32(e2), i2 = this.getUint32(e2 + 4);
    return t2 < 1048575 ? t2 << 32 | i2 : void 0 !== typeof r ? (console.warn("Using BigInt because of type 64uint but JS can only handle 53b numbers."), r(t2) << r(32) | r(i2)) : void g("Trying to read 64b value but JS can only handle 53b numbers.");
  };
  class Re extends se {
    parseBoxes(e2 = 0) {
      let t2 = [];
      for (; e2 < this.file.byteLength - 4; ) {
        let i2 = this.parseBoxHead(e2);
        if (t2.push(i2), 0 === i2.length) break;
        e2 += i2.length;
      }
      return t2;
    }
    parseSubBoxes(e2) {
      e2.boxes = this.parseBoxes(e2.start);
    }
    findBox(e2, t2) {
      return void 0 === e2.boxes && this.parseSubBoxes(e2), e2.boxes.find((e3) => e3.kind === t2);
    }
    parseBoxHead(e2) {
      let t2 = this.file.getUint32(e2), i2 = this.file.getString(e2 + 4, 4), n2 = e2 + 8;
      return 1 === t2 && (t2 = this.file.getUint64(e2 + 8), n2 += 8), { offset: e2, length: t2, kind: i2, start: n2 };
    }
    parseBoxFullHead(e2) {
      if (void 0 !== e2.version) return;
      let t2 = this.file.getUint32(e2.start);
      e2.version = t2 >> 24, e2.start += 4;
    }
  }
  class Le extends Re {
    static canHandle(e2, t2) {
      if (0 !== t2) return false;
      let i2 = e2.getUint16(2);
      if (i2 > 50) return false;
      let n2 = 16, s2 = [];
      for (; n2 < i2; ) s2.push(e2.getString(n2, 4)), n2 += 4;
      return s2.includes(this.type);
    }
    async parse() {
      let e2 = this.file.getUint32(0), t2 = this.parseBoxHead(e2);
      for (; "meta" !== t2.kind; ) e2 += t2.length, await this.file.ensureChunk(e2, 16), t2 = this.parseBoxHead(e2);
      await this.file.ensureChunk(t2.offset, t2.length), this.parseBoxFullHead(t2), this.parseSubBoxes(t2), this.options.icc.enabled && await this.findIcc(t2), this.options.tiff.enabled && await this.findExif(t2);
    }
    async registerSegment(e2, t2, i2) {
      await this.file.ensureChunk(t2, i2);
      let n2 = this.file.subarray(t2, i2);
      this.createParser(e2, n2);
    }
    async findIcc(e2) {
      let t2 = this.findBox(e2, "iprp");
      if (void 0 === t2) return;
      let i2 = this.findBox(t2, "ipco");
      if (void 0 === i2) return;
      let n2 = this.findBox(i2, "colr");
      void 0 !== n2 && await this.registerSegment("icc", n2.offset + 12, n2.length);
    }
    async findExif(e2) {
      let t2 = this.findBox(e2, "iinf");
      if (void 0 === t2) return;
      let i2 = this.findBox(e2, "iloc");
      if (void 0 === i2) return;
      let n2 = this.findExifLocIdInIinf(t2), s2 = this.findExtentInIloc(i2, n2);
      if (void 0 === s2) return;
      let [r2, a2] = s2;
      await this.file.ensureChunk(r2, a2);
      let o2 = 4 + this.file.getUint32(r2);
      r2 += o2, a2 -= o2, await this.registerSegment("tiff", r2, a2);
    }
    findExifLocIdInIinf(e2) {
      this.parseBoxFullHead(e2);
      let t2, i2, n2, s2, r2 = e2.start, a2 = this.file.getUint16(r2);
      for (r2 += 2; a2--; ) {
        if (t2 = this.parseBoxHead(r2), this.parseBoxFullHead(t2), i2 = t2.start, t2.version >= 2 && (n2 = 3 === t2.version ? 4 : 2, s2 = this.file.getString(i2 + n2 + 2, 4), "Exif" === s2)) return this.file.getUintBytes(i2, n2);
        r2 += t2.length;
      }
    }
    get8bits(e2) {
      let t2 = this.file.getUint8(e2);
      return [t2 >> 4, 15 & t2];
    }
    findExtentInIloc(e2, t2) {
      this.parseBoxFullHead(e2);
      let i2 = e2.start, [n2, s2] = this.get8bits(i2++), [r2, a2] = this.get8bits(i2++), o2 = 2 === e2.version ? 4 : 2, l2 = 1 === e2.version || 2 === e2.version ? 2 : 0, h2 = a2 + n2 + s2, u2 = 2 === e2.version ? 4 : 2, c2 = this.file.getUintBytes(i2, u2);
      for (i2 += u2; c2--; ) {
        let e3 = this.file.getUintBytes(i2, o2);
        i2 += o2 + l2 + 2 + r2;
        let u3 = this.file.getUint16(i2);
        if (i2 += 2, e3 === t2) return u3 > 1 && console.warn("ILOC box has more than one extent but we're only processing one\nPlease create an issue at https://github.com/MikeKovarik/exifr with this file"), [this.file.getUintBytes(i2 + a2, n2), this.file.getUintBytes(i2 + a2 + n2, s2)];
        i2 += u3 * h2;
      }
    }
  }
  class Ue extends Le {
  }
  c(Ue, "type", "heic");
  class Fe extends Le {
  }
  c(Fe, "type", "avif"), w.set("heic", Ue), w.set("avif", Fe), U(E, ["ifd0", "ifd1"], [[256, "ImageWidth"], [257, "ImageHeight"], [258, "BitsPerSample"], [259, "Compression"], [262, "PhotometricInterpretation"], [270, "ImageDescription"], [271, "Make"], [272, "Model"], [273, "StripOffsets"], [274, "Orientation"], [277, "SamplesPerPixel"], [278, "RowsPerStrip"], [279, "StripByteCounts"], [282, "XResolution"], [283, "YResolution"], [284, "PlanarConfiguration"], [296, "ResolutionUnit"], [301, "TransferFunction"], [305, "Software"], [306, "ModifyDate"], [315, "Artist"], [316, "HostComputer"], [317, "Predictor"], [318, "WhitePoint"], [319, "PrimaryChromaticities"], [513, "ThumbnailOffset"], [514, "ThumbnailLength"], [529, "YCbCrCoefficients"], [530, "YCbCrSubSampling"], [531, "YCbCrPositioning"], [532, "ReferenceBlackWhite"], [700, "ApplicationNotes"], [33432, "Copyright"], [33723, "IPTC"], [34665, "ExifIFD"], [34675, "ICC"], [34853, "GpsIFD"], [330, "SubIFD"], [40965, "InteropIFD"], [40091, "XPTitle"], [40092, "XPComment"], [40093, "XPAuthor"], [40094, "XPKeywords"], [40095, "XPSubject"]]), U(E, "exif", [[33434, "ExposureTime"], [33437, "FNumber"], [34850, "ExposureProgram"], [34852, "SpectralSensitivity"], [34855, "ISO"], [34858, "TimeZoneOffset"], [34859, "SelfTimerMode"], [34864, "SensitivityType"], [34865, "StandardOutputSensitivity"], [34866, "RecommendedExposureIndex"], [34867, "ISOSpeed"], [34868, "ISOSpeedLatitudeyyy"], [34869, "ISOSpeedLatitudezzz"], [36864, "ExifVersion"], [36867, "DateTimeOriginal"], [36868, "CreateDate"], [36873, "GooglePlusUploadCode"], [36880, "OffsetTime"], [36881, "OffsetTimeOriginal"], [36882, "OffsetTimeDigitized"], [37121, "ComponentsConfiguration"], [37122, "CompressedBitsPerPixel"], [37377, "ShutterSpeedValue"], [37378, "ApertureValue"], [37379, "BrightnessValue"], [37380, "ExposureCompensation"], [37381, "MaxApertureValue"], [37382, "SubjectDistance"], [37383, "MeteringMode"], [37384, "LightSource"], [37385, "Flash"], [37386, "FocalLength"], [37393, "ImageNumber"], [37394, "SecurityClassification"], [37395, "ImageHistory"], [37396, "SubjectArea"], [37500, "MakerNote"], [37510, "UserComment"], [37520, "SubSecTime"], [37521, "SubSecTimeOriginal"], [37522, "SubSecTimeDigitized"], [37888, "AmbientTemperature"], [37889, "Humidity"], [37890, "Pressure"], [37891, "WaterDepth"], [37892, "Acceleration"], [37893, "CameraElevationAngle"], [40960, "FlashpixVersion"], [40961, "ColorSpace"], [40962, "ExifImageWidth"], [40963, "ExifImageHeight"], [40964, "RelatedSoundFile"], [41483, "FlashEnergy"], [41486, "FocalPlaneXResolution"], [41487, "FocalPlaneYResolution"], [41488, "FocalPlaneResolutionUnit"], [41492, "SubjectLocation"], [41493, "ExposureIndex"], [41495, "SensingMethod"], [41728, "FileSource"], [41729, "SceneType"], [41730, "CFAPattern"], [41985, "CustomRendered"], [41986, "ExposureMode"], [41987, "WhiteBalance"], [41988, "DigitalZoomRatio"], [41989, "FocalLengthIn35mmFormat"], [41990, "SceneCaptureType"], [41991, "GainControl"], [41992, "Contrast"], [41993, "Saturation"], [41994, "Sharpness"], [41996, "SubjectDistanceRange"], [42016, "ImageUniqueID"], [42032, "OwnerName"], [42033, "SerialNumber"], [42034, "LensInfo"], [42035, "LensMake"], [42036, "LensModel"], [42037, "LensSerialNumber"], [42080, "CompositeImage"], [42081, "CompositeImageCount"], [42082, "CompositeImageExposureTimes"], [42240, "Gamma"], [59932, "Padding"], [59933, "OffsetSchema"], [65e3, "OwnerName"], [65001, "SerialNumber"], [65002, "Lens"], [65100, "RawFile"], [65101, "Converter"], [65102, "WhiteBalance"], [65105, "Exposure"], [65106, "Shadows"], [65107, "Brightness"], [65108, "Contrast"], [65109, "Saturation"], [65110, "Sharpness"], [65111, "Smoothness"], [65112, "MoireFilter"], [40965, "InteropIFD"]]), U(E, "gps", [[0, "GPSVersionID"], [1, "GPSLatitudeRef"], [2, "GPSLatitude"], [3, "GPSLongitudeRef"], [4, "GPSLongitude"], [5, "GPSAltitudeRef"], [6, "GPSAltitude"], [7, "GPSTimeStamp"], [8, "GPSSatellites"], [9, "GPSStatus"], [10, "GPSMeasureMode"], [11, "GPSDOP"], [12, "GPSSpeedRef"], [13, "GPSSpeed"], [14, "GPSTrackRef"], [15, "GPSTrack"], [16, "GPSImgDirectionRef"], [17, "GPSImgDirection"], [18, "GPSMapDatum"], [19, "GPSDestLatitudeRef"], [20, "GPSDestLatitude"], [21, "GPSDestLongitudeRef"], [22, "GPSDestLongitude"], [23, "GPSDestBearingRef"], [24, "GPSDestBearing"], [25, "GPSDestDistanceRef"], [26, "GPSDestDistance"], [27, "GPSProcessingMethod"], [28, "GPSAreaInformation"], [29, "GPSDateStamp"], [30, "GPSDifferential"], [31, "GPSHPositioningError"]]), U(B, ["ifd0", "ifd1"], [[274, { 1: "Horizontal (normal)", 2: "Mirror horizontal", 3: "Rotate 180", 4: "Mirror vertical", 5: "Mirror horizontal and rotate 270 CW", 6: "Rotate 90 CW", 7: "Mirror horizontal and rotate 90 CW", 8: "Rotate 270 CW" }], [296, { 1: "None", 2: "inches", 3: "cm" }]]);
  let Ee = U(B, "exif", [[34850, { 0: "Not defined", 1: "Manual", 2: "Normal program", 3: "Aperture priority", 4: "Shutter priority", 5: "Creative program", 6: "Action program", 7: "Portrait mode", 8: "Landscape mode" }], [37121, { 0: "-", 1: "Y", 2: "Cb", 3: "Cr", 4: "R", 5: "G", 6: "B" }], [37383, { 0: "Unknown", 1: "Average", 2: "CenterWeightedAverage", 3: "Spot", 4: "MultiSpot", 5: "Pattern", 6: "Partial", 255: "Other" }], [37384, { 0: "Unknown", 1: "Daylight", 2: "Fluorescent", 3: "Tungsten (incandescent light)", 4: "Flash", 9: "Fine weather", 10: "Cloudy weather", 11: "Shade", 12: "Daylight fluorescent (D 5700 - 7100K)", 13: "Day white fluorescent (N 4600 - 5400K)", 14: "Cool white fluorescent (W 3900 - 4500K)", 15: "White fluorescent (WW 3200 - 3700K)", 17: "Standard light A", 18: "Standard light B", 19: "Standard light C", 20: "D55", 21: "D65", 22: "D75", 23: "D50", 24: "ISO studio tungsten", 255: "Other" }], [37385, { 0: "Flash did not fire", 1: "Flash fired", 5: "Strobe return light not detected", 7: "Strobe return light detected", 9: "Flash fired, compulsory flash mode", 13: "Flash fired, compulsory flash mode, return light not detected", 15: "Flash fired, compulsory flash mode, return light detected", 16: "Flash did not fire, compulsory flash mode", 24: "Flash did not fire, auto mode", 25: "Flash fired, auto mode", 29: "Flash fired, auto mode, return light not detected", 31: "Flash fired, auto mode, return light detected", 32: "No flash function", 65: "Flash fired, red-eye reduction mode", 69: "Flash fired, red-eye reduction mode, return light not detected", 71: "Flash fired, red-eye reduction mode, return light detected", 73: "Flash fired, compulsory flash mode, red-eye reduction mode", 77: "Flash fired, compulsory flash mode, red-eye reduction mode, return light not detected", 79: "Flash fired, compulsory flash mode, red-eye reduction mode, return light detected", 89: "Flash fired, auto mode, red-eye reduction mode", 93: "Flash fired, auto mode, return light not detected, red-eye reduction mode", 95: "Flash fired, auto mode, return light detected, red-eye reduction mode" }], [41495, { 1: "Not defined", 2: "One-chip color area sensor", 3: "Two-chip color area sensor", 4: "Three-chip color area sensor", 5: "Color sequential area sensor", 7: "Trilinear sensor", 8: "Color sequential linear sensor" }], [41728, { 1: "Film Scanner", 2: "Reflection Print Scanner", 3: "Digital Camera" }], [41729, { 1: "Directly photographed" }], [41985, { 0: "Normal", 1: "Custom", 2: "HDR (no original saved)", 3: "HDR (original saved)", 4: "Original (for HDR)", 6: "Panorama", 7: "Portrait HDR", 8: "Portrait" }], [41986, { 0: "Auto", 1: "Manual", 2: "Auto bracket" }], [41987, { 0: "Auto", 1: "Manual" }], [41990, { 0: "Standard", 1: "Landscape", 2: "Portrait", 3: "Night", 4: "Other" }], [41991, { 0: "None", 1: "Low gain up", 2: "High gain up", 3: "Low gain down", 4: "High gain down" }], [41996, { 0: "Unknown", 1: "Macro", 2: "Close", 3: "Distant" }], [42080, { 0: "Unknown", 1: "Not a Composite Image", 2: "General Composite Image", 3: "Composite Image Captured While Shooting" }]]);
  const Be = { 1: "No absolute unit of measurement", 2: "Inch", 3: "Centimeter" };
  Ee.set(37392, Be), Ee.set(41488, Be);
  const Ne = { 0: "Normal", 1: "Low", 2: "High" };
  function Ge(e2) {
    return "object" == typeof e2 && void 0 !== e2.length ? e2[0] : e2;
  }
  function Ve(e2) {
    let t2 = Array.from(e2).slice(1);
    return t2[1] > 15 && (t2 = t2.map((e3) => String.fromCharCode(e3))), "0" !== t2[2] && 0 !== t2[2] || t2.pop(), t2.join(".");
  }
  function ze(e2) {
    if ("string" == typeof e2) {
      var [t2, i2, n2, s2, r2, a2] = e2.trim().split(/[-: ]/g).map(Number), o2 = new Date(t2, i2 - 1, n2);
      return Number.isNaN(s2) || Number.isNaN(r2) || Number.isNaN(a2) || (o2.setHours(s2), o2.setMinutes(r2), o2.setSeconds(a2)), Number.isNaN(+o2) ? e2 : o2;
    }
  }
  function He(e2) {
    if ("string" == typeof e2) return e2;
    let t2 = [];
    if (0 === e2[1] && 0 === e2[e2.length - 1]) for (let i2 = 0; i2 < e2.length; i2 += 2) t2.push(je(e2[i2 + 1], e2[i2]));
    else for (let i2 = 0; i2 < e2.length; i2 += 2) t2.push(je(e2[i2], e2[i2 + 1]));
    return m(String.fromCodePoint(...t2));
  }
  function je(e2, t2) {
    return e2 << 8 | t2;
  }
  Ee.set(41992, Ne), Ee.set(41993, Ne), Ee.set(41994, Ne), U(N, ["ifd0", "ifd1"], [[50827, function(e2) {
    return "string" != typeof e2 ? b(e2) : e2;
  }], [306, ze], [40091, He], [40092, He], [40093, He], [40094, He], [40095, He]]), U(N, "exif", [[40960, Ve], [36864, Ve], [36867, ze], [36868, ze], [40962, Ge], [40963, Ge]]), U(N, "gps", [[0, (e2) => Array.from(e2).join(".")], [7, (e2) => Array.from(e2).join(":")]]);
  class We extends re {
    static canHandle(e2, t2) {
      return 225 === e2.getUint8(t2 + 1) && 1752462448 === e2.getUint32(t2 + 4) && "http://ns.adobe.com/" === e2.getString(t2 + 4, "http://ns.adobe.com/".length);
    }
    static headerLength(e2, t2) {
      return "http://ns.adobe.com/xmp/extension/" === e2.getString(t2 + 4, "http://ns.adobe.com/xmp/extension/".length) ? 79 : 4 + "http://ns.adobe.com/xap/1.0/".length + 1;
    }
    static findPosition(e2, t2) {
      let i2 = super.findPosition(e2, t2);
      return i2.multiSegment = i2.extended = 79 === i2.headerLength, i2.multiSegment ? (i2.chunkCount = e2.getUint8(t2 + 72), i2.chunkNumber = e2.getUint8(t2 + 76), 0 !== e2.getUint8(t2 + 77) && i2.chunkNumber++) : (i2.chunkCount = 1 / 0, i2.chunkNumber = -1), i2;
    }
    static handleMultiSegments(e2) {
      return e2.map((e3) => e3.chunk.getString()).join("");
    }
    normalizeInput(e2) {
      return "string" == typeof e2 ? e2 : I.from(e2).getString();
    }
    parse(e2 = this.chunk) {
      if (!this.localOptions.parse) return e2;
      e2 = function(e3) {
        let t3 = {}, i3 = {};
        for (let e4 of Ze) t3[e4] = [], i3[e4] = 0;
        return e3.replace(et, (e4, n3, s2) => {
          if ("<" === n3) {
            let n4 = ++i3[s2];
            return t3[s2].push(n4), `${e4}#${n4}`;
          }
          return `${e4}#${t3[s2].pop()}`;
        });
      }(e2);
      let t2 = Xe.findAll(e2, "rdf", "Description");
      0 === t2.length && t2.push(new Xe("rdf", "Description", void 0, e2));
      let i2, n2 = {};
      for (let e3 of t2) for (let t3 of e3.properties) i2 = Je(t3.ns, n2), _e(t3, i2);
      return function(e3) {
        let t3;
        for (let i3 in e3) t3 = e3[i3] = f(e3[i3]), void 0 === t3 && delete e3[i3];
        return f(e3);
      }(n2);
    }
    assignToOutput(e2, t2) {
      if (this.localOptions.parse) for (let [i2, n2] of Object.entries(t2)) switch (i2) {
        case "tiff":
          this.assignObjectToOutput(e2, "ifd0", n2);
          break;
        case "exif":
          this.assignObjectToOutput(e2, "exif", n2);
          break;
        case "xmlns":
          break;
        default:
          this.assignObjectToOutput(e2, i2, n2);
      }
      else e2.xmp = t2;
    }
  }
  c(We, "type", "xmp"), c(We, "multiSegment", true), T.set("xmp", We);
  class Ke {
    static findAll(e2) {
      return qe(e2, /([a-zA-Z0-9-]+):([a-zA-Z0-9-]+)=("[^"]*"|'[^']*')/gm).map(Ke.unpackMatch);
    }
    static unpackMatch(e2) {
      let t2 = e2[1], i2 = e2[2], n2 = e2[3].slice(1, -1);
      return n2 = Qe(n2), new Ke(t2, i2, n2);
    }
    constructor(e2, t2, i2) {
      this.ns = e2, this.name = t2, this.value = i2;
    }
    serialize() {
      return this.value;
    }
  }
  class Xe {
    static findAll(e2, t2, i2) {
      if (void 0 !== t2 || void 0 !== i2) {
        t2 = t2 || "[\\w\\d-]+", i2 = i2 || "[\\w\\d-]+";
        var n2 = new RegExp(`<(${t2}):(${i2})(#\\d+)?((\\s+?[\\w\\d-:]+=("[^"]*"|'[^']*'))*\\s*)(\\/>|>([\\s\\S]*?)<\\/\\1:\\2\\3>)`, "gm");
      } else n2 = /<([\w\d-]+):([\w\d-]+)(#\d+)?((\s+?[\w\d-:]+=("[^"]*"|'[^']*'))*\s*)(\/>|>([\s\S]*?)<\/\1:\2\3>)/gm;
      return qe(e2, n2).map(Xe.unpackMatch);
    }
    static unpackMatch(e2) {
      let t2 = e2[1], i2 = e2[2], n2 = e2[4], s2 = e2[8];
      return new Xe(t2, i2, n2, s2);
    }
    constructor(e2, t2, i2, n2) {
      this.ns = e2, this.name = t2, this.attrString = i2, this.innerXml = n2, this.attrs = Ke.findAll(i2), this.children = Xe.findAll(n2), this.value = 0 === this.children.length ? Qe(n2) : void 0, this.properties = [...this.attrs, ...this.children];
    }
    get isPrimitive() {
      return void 0 !== this.value && 0 === this.attrs.length && 0 === this.children.length;
    }
    get isListContainer() {
      return 1 === this.children.length && this.children[0].isList;
    }
    get isList() {
      let { ns: e2, name: t2 } = this;
      return "rdf" === e2 && ("Seq" === t2 || "Bag" === t2 || "Alt" === t2);
    }
    get isListItem() {
      return "rdf" === this.ns && "li" === this.name;
    }
    serialize() {
      if (0 === this.properties.length && void 0 === this.value) return;
      if (this.isPrimitive) return this.value;
      if (this.isListContainer) return this.children[0].serialize();
      if (this.isList) return $e(this.children.map(Ye));
      if (this.isListItem && 1 === this.children.length && 0 === this.attrs.length) return this.children[0].serialize();
      let e2 = {};
      for (let t2 of this.properties) _e(t2, e2);
      return void 0 !== this.value && (e2.value = this.value), f(e2);
    }
  }
  function _e(e2, t2) {
    let i2 = e2.serialize();
    void 0 !== i2 && (t2[e2.name] = i2);
  }
  var Ye = (e2) => e2.serialize(), $e = (e2) => 1 === e2.length ? e2[0] : e2, Je = (e2, t2) => t2[e2] ? t2[e2] : t2[e2] = {};
  function qe(e2, t2) {
    let i2, n2 = [];
    if (!e2) return n2;
    for (; null !== (i2 = t2.exec(e2)); ) n2.push(i2);
    return n2;
  }
  function Qe(e2) {
    if (function(e3) {
      return null == e3 || "null" === e3 || "undefined" === e3 || "" === e3 || "" === e3.trim();
    }(e2)) return;
    let t2 = Number(e2);
    if (!Number.isNaN(t2)) return t2;
    let i2 = e2.toLowerCase();
    return "true" === i2 || "false" !== i2 && e2.trim();
  }
  const Ze = ["rdf:li", "rdf:Seq", "rdf:Bag", "rdf:Alt", "rdf:Description"], et = new RegExp(`(<|\\/)(${Ze.join("|")})`, "g");
  var tt = Object.freeze({ __proto__: null, default: Me, Exifr: te, fileParsers: w, segmentParsers: T, fileReaders: A, tagKeys: E, tagValues: B, tagRevivers: N, createDictionary: U, extendDictionary: F, fetchUrlAsArrayBuffer: M, readBlobAsArrayBuffer: R, chunkedProps: G, otherSegments: V, segments: z, tiffBlocks: H, segmentsAndBlocks: j, tiffExtractables: W, inheritables: K, allFormatters: X, Options: q, parse: ie, gpsOnlyOptions: me, gps: Se, thumbnailOnlyOptions: Ce, thumbnail: ye, thumbnailUrl: be, orientationOnlyOptions: Ie, orientation: Pe, rotations: ke, get rotateCanvas() {
    return we;
  }, get rotateCss() {
    return Te;
  }, rotation: Ae });
  let at = l("fs", (e2) => e2.promises);
  A.set("fs", class extends ve {
    async readWhole() {
      this.chunked = false, this.fs = await at;
      let e2 = await this.fs.readFile(this.input);
      this._swapBuffer(e2);
    }
    async readChunked() {
      this.chunked = true, this.fs = await at, await this.open(), await this.readChunk(0, this.options.firstChunkSize);
    }
    async open() {
      void 0 === this.fh && (this.fh = await this.fs.open(this.input, "r"), this.size = (await this.fh.stat(this.input)).size);
    }
    async _readChunk(e2, t2) {
      void 0 === this.fh && await this.open(), e2 + t2 > this.size && (t2 = this.size - e2);
      var i2 = this.subarray(e2, t2, true);
      return await this.fh.read(i2.dataView, 0, t2, e2), i2;
    }
    async close() {
      if (this.fh) {
        let e2 = this.fh;
        this.fh = void 0, await e2.close();
      }
    }
  });
  A.set("base64", class extends ve {
    constructor(...e2) {
      super(...e2), this.input = this.input.replace(/^data:([^;]+);base64,/gim, ""), this.size = this.input.length / 4 * 3, this.input.endsWith("==") ? this.size -= 2 : this.input.endsWith("=") && (this.size -= 1);
    }
    async _readChunk(e2, t2) {
      let i2, n2, r2 = this.input;
      void 0 === e2 ? (e2 = 0, i2 = 0, n2 = 0) : (i2 = 4 * Math.floor(e2 / 3), n2 = e2 - i2 / 4 * 3), void 0 === t2 && (t2 = this.size);
      let o2 = e2 + t2, l2 = i2 + 4 * Math.ceil(o2 / 3);
      r2 = r2.slice(i2, l2);
      let h2 = Math.min(t2, this.size - e2);
      if (a) {
        let t3 = s.from(r2, "base64").slice(n2, n2 + h2);
        return this.set(t3, e2, true);
      }
      {
        let t3 = this.subarray(e2, h2, true), i3 = atob(r2), s2 = t3.toUint8();
        for (let e3 = 0; e3 < h2; e3++) s2[e3] = i3.charCodeAt(n2 + e3);
        return t3;
      }
    }
  });
  class ot extends se {
    static canHandle(e2, t2) {
      return 18761 === t2 || 19789 === t2;
    }
    extendOptions(e2) {
      let { ifd0: t2, xmp: i2, iptc: n2, icc: s2 } = e2;
      i2.enabled && t2.deps.add(700), n2.enabled && t2.deps.add(33723), s2.enabled && t2.deps.add(34675), t2.finalizeFilters();
    }
    async parse() {
      let { tiff: e2, xmp: t2, iptc: i2, icc: n2 } = this.options;
      if (e2.enabled || t2.enabled || i2.enabled || n2.enabled) {
        let e3 = Math.max(S(this.options), this.options.chunkSize);
        await this.file.ensureChunk(0, e3), this.createParser("tiff", this.file), this.parsers.tiff.parseHeader(), await this.parsers.tiff.parseIfd0Block(), this.adaptTiffPropAsSegment("xmp"), this.adaptTiffPropAsSegment("iptc"), this.adaptTiffPropAsSegment("icc");
      }
    }
    adaptTiffPropAsSegment(e2) {
      if (this.parsers.tiff[e2]) {
        let t2 = this.parsers.tiff[e2];
        this.injectSegment(e2, t2);
      }
    }
  }
  c(ot, "type", "tiff"), w.set("tiff", ot);
  let lt = l("zlib");
  const ht = ["ihdr", "iccp", "text", "itxt", "exif"];
  class ut extends se {
    constructor(...e2) {
      super(...e2), c(this, "catchError", (e3) => this.errors.push(e3)), c(this, "metaChunks", []), c(this, "unknownChunks", []);
    }
    static canHandle(e2, t2) {
      return 35152 === t2 && 2303741511 === e2.getUint32(0) && 218765834 === e2.getUint32(4);
    }
    async parse() {
      let { file: e2 } = this;
      await this.findPngChunksInRange("PNG\r\n\n".length, e2.byteLength), await this.readSegments(this.metaChunks), this.findIhdr(), this.parseTextChunks(), await this.findExif().catch(this.catchError), await this.findXmp().catch(this.catchError), await this.findIcc().catch(this.catchError);
    }
    async findPngChunksInRange(e2, t2) {
      let { file: i2 } = this;
      for (; e2 < t2; ) {
        let t3 = i2.getUint32(e2), n2 = i2.getUint32(e2 + 4), s2 = i2.getString(e2 + 4, 4).toLowerCase(), r2 = t3 + 4 + 4 + 4, a2 = { type: s2, offset: e2, length: r2, start: e2 + 4 + 4, size: t3, marker: n2 };
        ht.includes(s2) ? this.metaChunks.push(a2) : this.unknownChunks.push(a2), e2 += r2;
      }
    }
    parseTextChunks() {
      let e2 = this.metaChunks.filter((e3) => "text" === e3.type);
      for (let t2 of e2) {
        let [e3, i2] = this.file.getString(t2.start, t2.size).split("\0");
        this.injectKeyValToIhdr(e3, i2);
      }
    }
    injectKeyValToIhdr(e2, t2) {
      let i2 = this.parsers.ihdr;
      i2 && i2.raw.set(e2, t2);
    }
    findIhdr() {
      let e2 = this.metaChunks.find((e3) => "ihdr" === e3.type);
      e2 && false !== this.options.ihdr.enabled && this.createParser("ihdr", e2.chunk);
    }
    async findExif() {
      let e2 = this.metaChunks.find((e3) => "exif" === e3.type);
      e2 && this.injectSegment("tiff", e2.chunk);
    }
    async findXmp() {
      let e2 = this.metaChunks.filter((e3) => "itxt" === e3.type);
      for (let t2 of e2) {
        "XML:com.adobe.xmp" === t2.chunk.getString(0, "XML:com.adobe.xmp".length) && this.injectSegment("xmp", t2.chunk);
      }
    }
    async findIcc() {
      let e2 = this.metaChunks.find((e3) => "iccp" === e3.type);
      if (!e2) return;
      let { chunk: t2 } = e2, i2 = t2.getUint8Array(0, 81), s2 = 0;
      for (; s2 < 80 && 0 !== i2[s2]; ) s2++;
      let r2 = s2 + 2, a2 = t2.getString(0, s2);
      if (this.injectKeyValToIhdr("ProfileName", a2), n) {
        let e3 = await lt, i3 = t2.getUint8Array(r2);
        i3 = e3.inflateSync(i3), this.injectSegment("icc", i3);
      }
    }
  }
  c(ut, "type", "png"), w.set("png", ut), U(E, "interop", [[1, "InteropIndex"], [2, "InteropVersion"], [4096, "RelatedImageFileFormat"], [4097, "RelatedImageWidth"], [4098, "RelatedImageHeight"]]), F(E, "ifd0", [[11, "ProcessingSoftware"], [254, "SubfileType"], [255, "OldSubfileType"], [263, "Thresholding"], [264, "CellWidth"], [265, "CellLength"], [266, "FillOrder"], [269, "DocumentName"], [280, "MinSampleValue"], [281, "MaxSampleValue"], [285, "PageName"], [286, "XPosition"], [287, "YPosition"], [290, "GrayResponseUnit"], [297, "PageNumber"], [321, "HalftoneHints"], [322, "TileWidth"], [323, "TileLength"], [332, "InkSet"], [337, "TargetPrinter"], [18246, "Rating"], [18249, "RatingPercent"], [33550, "PixelScale"], [34264, "ModelTransform"], [34377, "PhotoshopSettings"], [50706, "DNGVersion"], [50707, "DNGBackwardVersion"], [50708, "UniqueCameraModel"], [50709, "LocalizedCameraModel"], [50736, "DNGLensInfo"], [50739, "ShadowScale"], [50740, "DNGPrivateData"], [33920, "IntergraphMatrix"], [33922, "ModelTiePoint"], [34118, "SEMInfo"], [34735, "GeoTiffDirectory"], [34736, "GeoTiffDoubleParams"], [34737, "GeoTiffAsciiParams"], [50341, "PrintIM"], [50721, "ColorMatrix1"], [50722, "ColorMatrix2"], [50723, "CameraCalibration1"], [50724, "CameraCalibration2"], [50725, "ReductionMatrix1"], [50726, "ReductionMatrix2"], [50727, "AnalogBalance"], [50728, "AsShotNeutral"], [50729, "AsShotWhiteXY"], [50730, "BaselineExposure"], [50731, "BaselineNoise"], [50732, "BaselineSharpness"], [50734, "LinearResponseLimit"], [50735, "CameraSerialNumber"], [50741, "MakerNoteSafety"], [50778, "CalibrationIlluminant1"], [50779, "CalibrationIlluminant2"], [50781, "RawDataUniqueID"], [50827, "OriginalRawFileName"], [50828, "OriginalRawFileData"], [50831, "AsShotICCProfile"], [50832, "AsShotPreProfileMatrix"], [50833, "CurrentICCProfile"], [50834, "CurrentPreProfileMatrix"], [50879, "ColorimetricReference"], [50885, "SRawType"], [50898, "PanasonicTitle"], [50899, "PanasonicTitle2"], [50931, "CameraCalibrationSig"], [50932, "ProfileCalibrationSig"], [50933, "ProfileIFD"], [50934, "AsShotProfileName"], [50936, "ProfileName"], [50937, "ProfileHueSatMapDims"], [50938, "ProfileHueSatMapData1"], [50939, "ProfileHueSatMapData2"], [50940, "ProfileToneCurve"], [50941, "ProfileEmbedPolicy"], [50942, "ProfileCopyright"], [50964, "ForwardMatrix1"], [50965, "ForwardMatrix2"], [50966, "PreviewApplicationName"], [50967, "PreviewApplicationVersion"], [50968, "PreviewSettingsName"], [50969, "PreviewSettingsDigest"], [50970, "PreviewColorSpace"], [50971, "PreviewDateTime"], [50972, "RawImageDigest"], [50973, "OriginalRawFileDigest"], [50981, "ProfileLookTableDims"], [50982, "ProfileLookTableData"], [51043, "TimeCodes"], [51044, "FrameRate"], [51058, "TStop"], [51081, "ReelName"], [51089, "OriginalDefaultFinalSize"], [51090, "OriginalBestQualitySize"], [51091, "OriginalDefaultCropSize"], [51105, "CameraLabel"], [51107, "ProfileHueSatMapEncoding"], [51108, "ProfileLookTableEncoding"], [51109, "BaselineExposureOffset"], [51110, "DefaultBlackRender"], [51111, "NewRawImageDigest"], [51112, "RawToPreviewGain"]]);
  let ct = [[273, "StripOffsets"], [279, "StripByteCounts"], [288, "FreeOffsets"], [289, "FreeByteCounts"], [291, "GrayResponseCurve"], [292, "T4Options"], [293, "T6Options"], [300, "ColorResponseUnit"], [320, "ColorMap"], [324, "TileOffsets"], [325, "TileByteCounts"], [326, "BadFaxLines"], [327, "CleanFaxData"], [328, "ConsecutiveBadFaxLines"], [330, "SubIFD"], [333, "InkNames"], [334, "NumberofInks"], [336, "DotRange"], [338, "ExtraSamples"], [339, "SampleFormat"], [340, "SMinSampleValue"], [341, "SMaxSampleValue"], [342, "TransferRange"], [343, "ClipPath"], [344, "XClipPathUnits"], [345, "YClipPathUnits"], [346, "Indexed"], [347, "JPEGTables"], [351, "OPIProxy"], [400, "GlobalParametersIFD"], [401, "ProfileType"], [402, "FaxProfile"], [403, "CodingMethods"], [404, "VersionYear"], [405, "ModeNumber"], [433, "Decode"], [434, "DefaultImageColor"], [435, "T82Options"], [437, "JPEGTables"], [512, "JPEGProc"], [515, "JPEGRestartInterval"], [517, "JPEGLosslessPredictors"], [518, "JPEGPointTransforms"], [519, "JPEGQTables"], [520, "JPEGDCTables"], [521, "JPEGACTables"], [559, "StripRowCounts"], [999, "USPTOMiscellaneous"], [18247, "XP_DIP_XML"], [18248, "StitchInfo"], [28672, "SonyRawFileType"], [28688, "SonyToneCurve"], [28721, "VignettingCorrection"], [28722, "VignettingCorrParams"], [28724, "ChromaticAberrationCorrection"], [28725, "ChromaticAberrationCorrParams"], [28726, "DistortionCorrection"], [28727, "DistortionCorrParams"], [29895, "SonyCropTopLeft"], [29896, "SonyCropSize"], [32781, "ImageID"], [32931, "WangTag1"], [32932, "WangAnnotation"], [32933, "WangTag3"], [32934, "WangTag4"], [32953, "ImageReferencePoints"], [32954, "RegionXformTackPoint"], [32955, "WarpQuadrilateral"], [32956, "AffineTransformMat"], [32995, "Matteing"], [32996, "DataType"], [32997, "ImageDepth"], [32998, "TileDepth"], [33300, "ImageFullWidth"], [33301, "ImageFullHeight"], [33302, "TextureFormat"], [33303, "WrapModes"], [33304, "FovCot"], [33305, "MatrixWorldToScreen"], [33306, "MatrixWorldToCamera"], [33405, "Model2"], [33421, "CFARepeatPatternDim"], [33422, "CFAPattern2"], [33423, "BatteryLevel"], [33424, "KodakIFD"], [33445, "MDFileTag"], [33446, "MDScalePixel"], [33447, "MDColorTable"], [33448, "MDLabName"], [33449, "MDSampleInfo"], [33450, "MDPrepDate"], [33451, "MDPrepTime"], [33452, "MDFileUnits"], [33589, "AdventScale"], [33590, "AdventRevision"], [33628, "UIC1Tag"], [33629, "UIC2Tag"], [33630, "UIC3Tag"], [33631, "UIC4Tag"], [33918, "IntergraphPacketData"], [33919, "IntergraphFlagRegisters"], [33921, "INGRReserved"], [34016, "Site"], [34017, "ColorSequence"], [34018, "IT8Header"], [34019, "RasterPadding"], [34020, "BitsPerRunLength"], [34021, "BitsPerExtendedRunLength"], [34022, "ColorTable"], [34023, "ImageColorIndicator"], [34024, "BackgroundColorIndicator"], [34025, "ImageColorValue"], [34026, "BackgroundColorValue"], [34027, "PixelIntensityRange"], [34028, "TransparencyIndicator"], [34029, "ColorCharacterization"], [34030, "HCUsage"], [34031, "TrapIndicator"], [34032, "CMYKEquivalent"], [34152, "AFCP_IPTC"], [34232, "PixelMagicJBIGOptions"], [34263, "JPLCartoIFD"], [34306, "WB_GRGBLevels"], [34310, "LeafData"], [34687, "TIFF_FXExtensions"], [34688, "MultiProfiles"], [34689, "SharedData"], [34690, "T88Options"], [34732, "ImageLayer"], [34750, "JBIGOptions"], [34856, "Opto-ElectricConvFactor"], [34857, "Interlace"], [34908, "FaxRecvParams"], [34909, "FaxSubAddress"], [34910, "FaxRecvTime"], [34929, "FedexEDR"], [34954, "LeafSubIFD"], [37387, "FlashEnergy"], [37388, "SpatialFrequencyResponse"], [37389, "Noise"], [37390, "FocalPlaneXResolution"], [37391, "FocalPlaneYResolution"], [37392, "FocalPlaneResolutionUnit"], [37397, "ExposureIndex"], [37398, "TIFF-EPStandardID"], [37399, "SensingMethod"], [37434, "CIP3DataFile"], [37435, "CIP3Sheet"], [37436, "CIP3Side"], [37439, "StoNits"], [37679, "MSDocumentText"], [37680, "MSPropertySetStorage"], [37681, "MSDocumentTextPosition"], [37724, "ImageSourceData"], [40965, "InteropIFD"], [40976, "SamsungRawPointersOffset"], [40977, "SamsungRawPointersLength"], [41217, "SamsungRawByteOrder"], [41218, "SamsungRawUnknown"], [41484, "SpatialFrequencyResponse"], [41485, "Noise"], [41489, "ImageNumber"], [41490, "SecurityClassification"], [41491, "ImageHistory"], [41494, "TIFF-EPStandardID"], [41995, "DeviceSettingDescription"], [42112, "GDALMetadata"], [42113, "GDALNoData"], [44992, "ExpandSoftware"], [44993, "ExpandLens"], [44994, "ExpandFilm"], [44995, "ExpandFilterLens"], [44996, "ExpandScanner"], [44997, "ExpandFlashLamp"], [46275, "HasselbladRawImage"], [48129, "PixelFormat"], [48130, "Transformation"], [48131, "Uncompressed"], [48132, "ImageType"], [48256, "ImageWidth"], [48257, "ImageHeight"], [48258, "WidthResolution"], [48259, "HeightResolution"], [48320, "ImageOffset"], [48321, "ImageByteCount"], [48322, "AlphaOffset"], [48323, "AlphaByteCount"], [48324, "ImageDataDiscard"], [48325, "AlphaDataDiscard"], [50215, "OceScanjobDesc"], [50216, "OceApplicationSelector"], [50217, "OceIDNumber"], [50218, "OceImageLogic"], [50255, "Annotations"], [50459, "HasselbladExif"], [50547, "OriginalFileName"], [50560, "USPTOOriginalContentType"], [50656, "CR2CFAPattern"], [50710, "CFAPlaneColor"], [50711, "CFALayout"], [50712, "LinearizationTable"], [50713, "BlackLevelRepeatDim"], [50714, "BlackLevel"], [50715, "BlackLevelDeltaH"], [50716, "BlackLevelDeltaV"], [50717, "WhiteLevel"], [50718, "DefaultScale"], [50719, "DefaultCropOrigin"], [50720, "DefaultCropSize"], [50733, "BayerGreenSplit"], [50737, "ChromaBlurRadius"], [50738, "AntiAliasStrength"], [50752, "RawImageSegmentation"], [50780, "BestQualityScale"], [50784, "AliasLayerMetadata"], [50829, "ActiveArea"], [50830, "MaskedAreas"], [50935, "NoiseReductionApplied"], [50974, "SubTileBlockSize"], [50975, "RowInterleaveFactor"], [51008, "OpcodeList1"], [51009, "OpcodeList2"], [51022, "OpcodeList3"], [51041, "NoiseProfile"], [51114, "CacheVersion"], [51125, "DefaultUserCrop"], [51157, "NikonNEFInfo"], [65024, "KdcIFD"]];
  F(E, "ifd0", ct), F(E, "exif", ct), U(B, "gps", [[23, { M: "Magnetic North", T: "True North" }], [25, { K: "Kilometers", M: "Miles", N: "Nautical Miles" }]]);
  class ft extends re {
    static canHandle(e2, t2) {
      return 224 === e2.getUint8(t2 + 1) && 1246120262 === e2.getUint32(t2 + 4) && 0 === e2.getUint8(t2 + 8);
    }
    parse() {
      return this.parseTags(), this.translate(), this.output;
    }
    parseTags() {
      this.raw = /* @__PURE__ */ new Map([[0, this.chunk.getUint16(0)], [2, this.chunk.getUint8(2)], [3, this.chunk.getUint16(3)], [5, this.chunk.getUint16(5)], [7, this.chunk.getUint8(7)], [8, this.chunk.getUint8(8)]]);
    }
  }
  c(ft, "type", "jfif"), c(ft, "headerLength", 9), T.set("jfif", ft), U(E, "jfif", [[0, "JFIFVersion"], [2, "ResolutionUnit"], [3, "XResolution"], [5, "YResolution"], [7, "ThumbnailWidth"], [8, "ThumbnailHeight"]]);
  class dt extends re {
    parse() {
      return this.parseTags(), this.translate(), this.output;
    }
    parseTags() {
      this.raw = new Map([[0, this.chunk.getUint32(0)], [4, this.chunk.getUint32(4)], [8, this.chunk.getUint8(8)], [9, this.chunk.getUint8(9)], [10, this.chunk.getUint8(10)], [11, this.chunk.getUint8(11)], [12, this.chunk.getUint8(12)], ...Array.from(this.raw)]);
    }
  }
  c(dt, "type", "ihdr"), T.set("ihdr", dt), U(E, "ihdr", [[0, "ImageWidth"], [4, "ImageHeight"], [8, "BitDepth"], [9, "ColorType"], [10, "Compression"], [11, "Filter"], [12, "Interlace"]]), U(B, "ihdr", [[9, { 0: "Grayscale", 2: "RGB", 3: "Palette", 4: "Grayscale with Alpha", 6: "RGB with Alpha", DEFAULT: "Unknown" }], [10, { 0: "Deflate/Inflate", DEFAULT: "Unknown" }], [11, { 0: "Adaptive", DEFAULT: "Unknown" }], [12, { 0: "Noninterlaced", 1: "Adam7 Interlace", DEFAULT: "Unknown" }]]);
  class pt extends re {
    static canHandle(e2, t2) {
      return 226 === e2.getUint8(t2 + 1) && 1229144927 === e2.getUint32(t2 + 4);
    }
    static findPosition(e2, t2) {
      let i2 = super.findPosition(e2, t2);
      return i2.chunkNumber = e2.getUint8(t2 + 16), i2.chunkCount = e2.getUint8(t2 + 17), i2.multiSegment = i2.chunkCount > 1, i2;
    }
    static handleMultiSegments(e2) {
      return function(e3) {
        let t2 = function(e4) {
          let t3 = e4[0].constructor, i2 = 0;
          for (let t4 of e4) i2 += t4.length;
          let n2 = new t3(i2), s2 = 0;
          for (let t4 of e4) n2.set(t4, s2), s2 += t4.length;
          return n2;
        }(e3.map((e4) => e4.chunk.toUint8()));
        return new I(t2);
      }(e2);
    }
    parse() {
      return this.raw = /* @__PURE__ */ new Map(), this.parseHeader(), this.parseTags(), this.translate(), this.output;
    }
    parseHeader() {
      let { raw: e2 } = this;
      this.chunk.byteLength < 84 && g("ICC header is too short");
      for (let [t2, i2] of Object.entries(gt)) {
        t2 = parseInt(t2, 10);
        let n2 = i2(this.chunk, t2);
        "\0\0\0\0" !== n2 && e2.set(t2, n2);
      }
    }
    parseTags() {
      let e2, t2, i2, n2, s2, { raw: r2 } = this, a2 = this.chunk.getUint32(128), o2 = 132, l2 = this.chunk.byteLength;
      for (; a2--; ) {
        if (e2 = this.chunk.getString(o2, 4), t2 = this.chunk.getUint32(o2 + 4), i2 = this.chunk.getUint32(o2 + 8), n2 = this.chunk.getString(t2, 4), t2 + i2 > l2) return void console.warn("reached the end of the first ICC chunk. Enable options.tiff.multiSegment to read all ICC segments.");
        s2 = this.parseTag(n2, t2, i2), void 0 !== s2 && "\0\0\0\0" !== s2 && r2.set(e2, s2), o2 += 12;
      }
    }
    parseTag(e2, t2, i2) {
      switch (e2) {
        case "desc":
          return this.parseDesc(t2);
        case "mluc":
          return this.parseMluc(t2);
        case "text":
          return this.parseText(t2, i2);
        case "sig ":
          return this.parseSig(t2);
      }
      if (!(t2 + i2 > this.chunk.byteLength)) return this.chunk.getUint8Array(t2, i2);
    }
    parseDesc(e2) {
      let t2 = this.chunk.getUint32(e2 + 8) - 1;
      return m(this.chunk.getString(e2 + 12, t2));
    }
    parseText(e2, t2) {
      return m(this.chunk.getString(e2 + 8, t2 - 8));
    }
    parseSig(e2) {
      return m(this.chunk.getString(e2 + 8, 4));
    }
    parseMluc(e2) {
      let { chunk: t2 } = this, i2 = t2.getUint32(e2 + 8), n2 = t2.getUint32(e2 + 12), s2 = e2 + 16, r2 = [];
      for (let a2 = 0; a2 < i2; a2++) {
        let i3 = t2.getString(s2 + 0, 2), a3 = t2.getString(s2 + 2, 2), o2 = t2.getUint32(s2 + 4), l2 = t2.getUint32(s2 + 8) + e2, h2 = m(t2.getUnicodeString(l2, o2));
        r2.push({ lang: i3, country: a3, text: h2 }), s2 += n2;
      }
      return 1 === i2 ? r2[0].text : r2;
    }
    translateValue(e2, t2) {
      return "string" == typeof e2 ? t2[e2] || t2[e2.toLowerCase()] || e2 : t2[e2] || e2;
    }
  }
  c(pt, "type", "icc"), c(pt, "multiSegment", true), c(pt, "headerLength", 18);
  const gt = { 4: mt, 8: function(e2, t2) {
    return [e2.getUint8(t2), e2.getUint8(t2 + 1) >> 4, e2.getUint8(t2 + 1) % 16].map((e3) => e3.toString(10)).join(".");
  }, 12: mt, 16: mt, 20: mt, 24: function(e2, t2) {
    const i2 = e2.getUint16(t2), n2 = e2.getUint16(t2 + 2) - 1, s2 = e2.getUint16(t2 + 4), r2 = e2.getUint16(t2 + 6), a2 = e2.getUint16(t2 + 8), o2 = e2.getUint16(t2 + 10);
    return new Date(Date.UTC(i2, n2, s2, r2, a2, o2));
  }, 36: mt, 40: mt, 48: mt, 52: mt, 64: (e2, t2) => e2.getUint32(t2), 80: mt };
  function mt(e2, t2) {
    return m(e2.getString(t2, 4));
  }
  T.set("icc", pt), U(E, "icc", [[4, "ProfileCMMType"], [8, "ProfileVersion"], [12, "ProfileClass"], [16, "ColorSpaceData"], [20, "ProfileConnectionSpace"], [24, "ProfileDateTime"], [36, "ProfileFileSignature"], [40, "PrimaryPlatform"], [44, "CMMFlags"], [48, "DeviceManufacturer"], [52, "DeviceModel"], [56, "DeviceAttributes"], [64, "RenderingIntent"], [68, "ConnectionSpaceIlluminant"], [80, "ProfileCreator"], [84, "ProfileID"], ["Header", "ProfileHeader"], ["MS00", "WCSProfiles"], ["bTRC", "BlueTRC"], ["bXYZ", "BlueMatrixColumn"], ["bfd", "UCRBG"], ["bkpt", "MediaBlackPoint"], ["calt", "CalibrationDateTime"], ["chad", "ChromaticAdaptation"], ["chrm", "Chromaticity"], ["ciis", "ColorimetricIntentImageState"], ["clot", "ColorantTableOut"], ["clro", "ColorantOrder"], ["clrt", "ColorantTable"], ["cprt", "ProfileCopyright"], ["crdi", "CRDInfo"], ["desc", "ProfileDescription"], ["devs", "DeviceSettings"], ["dmdd", "DeviceModelDesc"], ["dmnd", "DeviceMfgDesc"], ["dscm", "ProfileDescriptionML"], ["fpce", "FocalPlaneColorimetryEstimates"], ["gTRC", "GreenTRC"], ["gXYZ", "GreenMatrixColumn"], ["gamt", "Gamut"], ["kTRC", "GrayTRC"], ["lumi", "Luminance"], ["meas", "Measurement"], ["meta", "Metadata"], ["mmod", "MakeAndModel"], ["ncl2", "NamedColor2"], ["ncol", "NamedColor"], ["ndin", "NativeDisplayInfo"], ["pre0", "Preview0"], ["pre1", "Preview1"], ["pre2", "Preview2"], ["ps2i", "PS2RenderingIntent"], ["ps2s", "PostScript2CSA"], ["psd0", "PostScript2CRD0"], ["psd1", "PostScript2CRD1"], ["psd2", "PostScript2CRD2"], ["psd3", "PostScript2CRD3"], ["pseq", "ProfileSequenceDesc"], ["psid", "ProfileSequenceIdentifier"], ["psvm", "PS2CRDVMSize"], ["rTRC", "RedTRC"], ["rXYZ", "RedMatrixColumn"], ["resp", "OutputResponse"], ["rhoc", "ReflectionHardcopyOrigColorimetry"], ["rig0", "PerceptualRenderingIntentGamut"], ["rig2", "SaturationRenderingIntentGamut"], ["rpoc", "ReflectionPrintOutputColorimetry"], ["sape", "SceneAppearanceEstimates"], ["scoe", "SceneColorimetryEstimates"], ["scrd", "ScreeningDesc"], ["scrn", "Screening"], ["targ", "CharTarget"], ["tech", "Technology"], ["vcgt", "VideoCardGamma"], ["view", "ViewingConditions"], ["vued", "ViewingCondDesc"], ["wtpt", "MediaWhitePoint"]]);
  const St = { "4d2p": "Erdt Systems", AAMA: "Aamazing Technologies", ACER: "Acer", ACLT: "Acolyte Color Research", ACTI: "Actix Sytems", ADAR: "Adara Technology", ADBE: "Adobe", ADI: "ADI Systems", AGFA: "Agfa Graphics", ALMD: "Alps Electric", ALPS: "Alps Electric", ALWN: "Alwan Color Expertise", AMTI: "Amiable Technologies", AOC: "AOC International", APAG: "Apago", APPL: "Apple Computer", AST: "AST", "AT&T": "AT&T", BAEL: "BARBIERI electronic", BRCO: "Barco NV", BRKP: "Breakpoint", BROT: "Brother", BULL: "Bull", BUS: "Bus Computer Systems", "C-IT": "C-Itoh", CAMR: "Intel", CANO: "Canon", CARR: "Carroll Touch", CASI: "Casio", CBUS: "Colorbus PL", CEL: "Crossfield", CELx: "Crossfield", CGS: "CGS Publishing Technologies International", CHM: "Rochester Robotics", CIGL: "Colour Imaging Group, London", CITI: "Citizen", CL00: "Candela", CLIQ: "Color IQ", CMCO: "Chromaco", CMiX: "CHROMiX", COLO: "Colorgraphic Communications", COMP: "Compaq", COMp: "Compeq/Focus Technology", CONR: "Conrac Display Products", CORD: "Cordata Technologies", CPQ: "Compaq", CPRO: "ColorPro", CRN: "Cornerstone", CTX: "CTX International", CVIS: "ColorVision", CWC: "Fujitsu Laboratories", DARI: "Darius Technology", DATA: "Dataproducts", DCP: "Dry Creek Photo", DCRC: "Digital Contents Resource Center, Chung-Ang University", DELL: "Dell Computer", DIC: "Dainippon Ink and Chemicals", DICO: "Diconix", DIGI: "Digital", "DL&C": "Digital Light & Color", DPLG: "Doppelganger", DS: "Dainippon Screen", DSOL: "DOOSOL", DUPN: "DuPont", EPSO: "Epson", ESKO: "Esko-Graphics", ETRI: "Electronics and Telecommunications Research Institute", EVER: "Everex Systems", EXAC: "ExactCODE", Eizo: "Eizo", FALC: "Falco Data Products", FF: "Fuji Photo Film", FFEI: "FujiFilm Electronic Imaging", FNRD: "Fnord Software", FORA: "Fora", FORE: "Forefront Technology", FP: "Fujitsu", FPA: "WayTech Development", FUJI: "Fujitsu", FX: "Fuji Xerox", GCC: "GCC Technologies", GGSL: "Global Graphics Software", GMB: "Gretagmacbeth", GMG: "GMG", GOLD: "GoldStar Technology", GOOG: "Google", GPRT: "Giantprint", GTMB: "Gretagmacbeth", GVC: "WayTech Development", GW2K: "Sony", HCI: "HCI", HDM: "Heidelberger Druckmaschinen", HERM: "Hermes", HITA: "Hitachi America", HP: "Hewlett-Packard", HTC: "Hitachi", HiTi: "HiTi Digital", IBM: "IBM", IDNT: "Scitex", IEC: "Hewlett-Packard", IIYA: "Iiyama North America", IKEG: "Ikegami Electronics", IMAG: "Image Systems", IMI: "Ingram Micro", INTC: "Intel", INTL: "N/A (INTL)", INTR: "Intra Electronics", IOCO: "Iocomm International Technology", IPS: "InfoPrint Solutions Company", IRIS: "Scitex", ISL: "Ichikawa Soft Laboratory", ITNL: "N/A (ITNL)", IVM: "IVM", IWAT: "Iwatsu Electric", Idnt: "Scitex", Inca: "Inca Digital Printers", Iris: "Scitex", JPEG: "Joint Photographic Experts Group", JSFT: "Jetsoft Development", JVC: "JVC Information Products", KART: "Scitex", KFC: "KFC Computek Components", KLH: "KLH Computers", KMHD: "Konica Minolta", KNCA: "Konica", KODA: "Kodak", KYOC: "Kyocera", Kart: "Scitex", LCAG: "Leica", LCCD: "Leeds Colour", LDAK: "Left Dakota", LEAD: "Leading Technology", LEXM: "Lexmark International", LINK: "Link Computer", LINO: "Linotronic", LITE: "Lite-On", Leaf: "Leaf", Lino: "Linotronic", MAGC: "Mag Computronic", MAGI: "MAG Innovision", MANN: "Mannesmann", MICN: "Micron Technology", MICR: "Microtek", MICV: "Microvitec", MINO: "Minolta", MITS: "Mitsubishi Electronics America", MITs: "Mitsuba", MNLT: "Minolta", MODG: "Modgraph", MONI: "Monitronix", MONS: "Monaco Systems", MORS: "Morse Technology", MOTI: "Motive Systems", MSFT: "Microsoft", MUTO: "MUTOH INDUSTRIES", Mits: "Mitsubishi Electric", NANA: "NANAO", NEC: "NEC", NEXP: "NexPress Solutions", NISS: "Nissei Sangyo America", NKON: "Nikon", NONE: "none", OCE: "Oce Technologies", OCEC: "OceColor", OKI: "Oki", OKID: "Okidata", OKIP: "Okidata", OLIV: "Olivetti", OLYM: "Olympus", ONYX: "Onyx Graphics", OPTI: "Optiquest", PACK: "Packard Bell", PANA: "Matsushita Electric Industrial", PANT: "Pantone", PBN: "Packard Bell", PFU: "PFU", PHIL: "Philips Consumer Electronics", PNTX: "HOYA", POne: "Phase One A/S", PREM: "Premier Computer Innovations", PRIN: "Princeton Graphic Systems", PRIP: "Princeton Publishing Labs", QLUX: "Hong Kong", QMS: "QMS", QPCD: "QPcard AB", QUAD: "QuadLaser", QUME: "Qume", RADI: "Radius", RDDx: "Integrated Color Solutions", RDG: "Roland DG", REDM: "REDMS Group", RELI: "Relisys", RGMS: "Rolf Gierling Multitools", RICO: "Ricoh", RNLD: "Edmund Ronald", ROYA: "Royal", RPC: "Ricoh Printing Systems", RTL: "Royal Information Electronics", SAMP: "Sampo", SAMS: "Samsung", SANT: "Jaime Santana Pomares", SCIT: "Scitex", SCRN: "Dainippon Screen", SDP: "Scitex", SEC: "Samsung", SEIK: "Seiko Instruments", SEIk: "Seikosha", SGUY: "ScanGuy.com", SHAR: "Sharp Laboratories", SICC: "International Color Consortium", SONY: "Sony", SPCL: "SpectraCal", STAR: "Star", STC: "Sampo Technology", Scit: "Scitex", Sdp: "Scitex", Sony: "Sony", TALO: "Talon Technology", TAND: "Tandy", TATU: "Tatung", TAXA: "TAXAN America", TDS: "Tokyo Denshi Sekei", TECO: "TECO Information Systems", TEGR: "Tegra", TEKT: "Tektronix", TI: "Texas Instruments", TMKR: "TypeMaker", TOSB: "Toshiba", TOSH: "Toshiba", TOTK: "TOTOKU ELECTRIC", TRIU: "Triumph", TSBT: "Toshiba", TTX: "TTX Computer Products", TVM: "TVM Professional Monitor", TW: "TW Casper", ULSX: "Ulead Systems", UNIS: "Unisys", UTZF: "Utz Fehlau & Sohn", VARI: "Varityper", VIEW: "Viewsonic", VISL: "Visual communication", VIVO: "Vivo Mobile Communication", WANG: "Wang", WLBR: "Wilbur Imaging", WTG2: "Ware To Go", WYSE: "WYSE Technology", XERX: "Xerox", XRIT: "X-Rite", ZRAN: "Zoran", Zebr: "Zebra Technologies", appl: "Apple Computer", bICC: "basICColor", berg: "bergdesign", ceyd: "Integrated Color Solutions", clsp: "MacDermid ColorSpan", ds: "Dainippon Screen", dupn: "DuPont", ffei: "FujiFilm Electronic Imaging", flux: "FluxData", iris: "Scitex", kart: "Scitex", lcms: "Little CMS", lino: "Linotronic", none: "none", ob4d: "Erdt Systems", obic: "Medigraph", quby: "Qubyx Sarl", scit: "Scitex", scrn: "Dainippon Screen", sdp: "Scitex", siwi: "SIWI GRAFIKA", yxym: "YxyMaster" }, Ct = { scnr: "Scanner", mntr: "Monitor", prtr: "Printer", link: "Device Link", abst: "Abstract", spac: "Color Space Conversion Profile", nmcl: "Named Color", cenc: "ColorEncodingSpace profile", mid: "MultiplexIdentification profile", mlnk: "MultiplexLink profile", mvis: "MultiplexVisualization profile", nkpf: "Nikon Input Device Profile (NON-STANDARD!)" };
  U(B, "icc", [[4, St], [12, Ct], [40, Object.assign({}, St, Ct)], [48, St], [80, St], [64, { 0: "Perceptual", 1: "Relative Colorimetric", 2: "Saturation", 3: "Absolute Colorimetric" }], ["tech", { amd: "Active Matrix Display", crt: "Cathode Ray Tube Display", kpcd: "Photo CD", pmd: "Passive Matrix Display", dcam: "Digital Camera", dcpj: "Digital Cinema Projector", dmpc: "Digital Motion Picture Camera", dsub: "Dye Sublimation Printer", epho: "Electrophotographic Printer", esta: "Electrostatic Printer", flex: "Flexography", fprn: "Film Writer", fscn: "Film Scanner", grav: "Gravure", ijet: "Ink Jet Printer", imgs: "Photo Image Setter", mpfr: "Motion Picture Film Recorder", mpfs: "Motion Picture Film Scanner", offs: "Offset Lithography", pjtv: "Projection Television", rpho: "Photographic Paper Printer", rscn: "Reflective Scanner", silk: "Silkscreen", twax: "Thermal Wax Printer", vidc: "Video Camera", vidm: "Video Monitor" }]]);
  class yt extends re {
    static canHandle(e2, t2, i2) {
      return 237 === e2.getUint8(t2 + 1) && "Photoshop" === e2.getString(t2 + 4, 9) && void 0 !== this.containsIptc8bim(e2, t2, i2);
    }
    static headerLength(e2, t2, i2) {
      let n2, s2 = this.containsIptc8bim(e2, t2, i2);
      if (void 0 !== s2) return n2 = e2.getUint8(t2 + s2 + 7), n2 % 2 != 0 && (n2 += 1), 0 === n2 && (n2 = 4), s2 + 8 + n2;
    }
    static containsIptc8bim(e2, t2, i2) {
      for (let n2 = 0; n2 < i2; n2++) if (this.isIptcSegmentHead(e2, t2 + n2)) return n2;
    }
    static isIptcSegmentHead(e2, t2) {
      return 56 === e2.getUint8(t2) && 943868237 === e2.getUint32(t2) && 1028 === e2.getUint16(t2 + 4);
    }
    parse() {
      let { raw: e2 } = this, t2 = this.chunk.byteLength - 1, i2 = false;
      for (let n2 = 0; n2 < t2; n2++) if (28 === this.chunk.getUint8(n2) && 2 === this.chunk.getUint8(n2 + 1)) {
        i2 = true;
        let t3 = this.chunk.getUint16(n2 + 3), s2 = this.chunk.getUint8(n2 + 2), r2 = this.chunk.getLatin1String(n2 + 5, t3);
        e2.set(s2, this.pluralizeValue(e2.get(s2), r2)), n2 += 4 + t3;
      } else if (i2) break;
      return this.translate(), this.output;
    }
    pluralizeValue(e2, t2) {
      return void 0 !== e2 ? e2 instanceof Array ? (e2.push(t2), e2) : [e2, t2] : t2;
    }
  }
  c(yt, "type", "iptc"), c(yt, "translateValues", false), c(yt, "reviveValues", false), T.set("iptc", yt), U(E, "iptc", [[0, "ApplicationRecordVersion"], [3, "ObjectTypeReference"], [4, "ObjectAttributeReference"], [5, "ObjectName"], [7, "EditStatus"], [8, "EditorialUpdate"], [10, "Urgency"], [12, "SubjectReference"], [15, "Category"], [20, "SupplementalCategories"], [22, "FixtureIdentifier"], [25, "Keywords"], [26, "ContentLocationCode"], [27, "ContentLocationName"], [30, "ReleaseDate"], [35, "ReleaseTime"], [37, "ExpirationDate"], [38, "ExpirationTime"], [40, "SpecialInstructions"], [42, "ActionAdvised"], [45, "ReferenceService"], [47, "ReferenceDate"], [50, "ReferenceNumber"], [55, "DateCreated"], [60, "TimeCreated"], [62, "DigitalCreationDate"], [63, "DigitalCreationTime"], [65, "OriginatingProgram"], [70, "ProgramVersion"], [75, "ObjectCycle"], [80, "Byline"], [85, "BylineTitle"], [90, "City"], [92, "Sublocation"], [95, "State"], [100, "CountryCode"], [101, "Country"], [103, "OriginalTransmissionReference"], [105, "Headline"], [110, "Credit"], [115, "Source"], [116, "CopyrightNotice"], [118, "Contact"], [120, "Caption"], [121, "LocalCaption"], [122, "Writer"], [125, "RasterizedCaption"], [130, "ImageType"], [131, "ImageOrientation"], [135, "LanguageIdentifier"], [150, "AudioType"], [151, "AudioSamplingRate"], [152, "AudioSamplingResolution"], [153, "AudioDuration"], [154, "AudioOutcue"], [184, "JobID"], [185, "MasterDocumentID"], [186, "ShortDocumentID"], [187, "UniqueDocumentID"], [188, "OwnerID"], [200, "ObjectPreviewFileFormat"], [201, "ObjectPreviewFileVersion"], [202, "ObjectPreviewData"], [221, "Prefs"], [225, "ClassifyState"], [228, "SimilarityIndex"], [230, "DocumentNotes"], [231, "DocumentHistory"], [232, "ExifCameraInfo"], [255, "CatalogSets"]]), U(B, "iptc", [[10, { 0: "0 (reserved)", 1: "1 (most urgent)", 2: "2", 3: "3", 4: "4", 5: "5 (normal urgency)", 6: "6", 7: "7", 8: "8 (least urgent)", 9: "9 (user-defined priority)" }], [75, { a: "Morning", b: "Both Morning and Evening", p: "Evening" }], [131, { L: "Landscape", P: "Portrait", S: "Square" }]]);
  async function readExif(url) {
    const data = await tt.parse(url, {
      pick: ["Make", "Model", "ExposureTime", "FNumber", "ISO", "FocalLength", "DateTimeOriginal"]
    });
    if (!data) {
      return null;
    }
    const make = String(data.Make ?? "").trim();
    const model = String(data.Model ?? "").trim();
    const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
    const parts = [];
    const exposure = Number(data.ExposureTime ?? 0);
    if (exposure > 0) {
      parts.push(exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`);
    }
    if (data.FNumber) {
      parts.push(`ƒ/${data.FNumber}`);
    }
    if (data.ISO) {
      parts.push(`ISO ${data.ISO}`);
    }
    if (data.FocalLength) {
      parts.push(`${data.FocalLength}mm`);
    }
    const taken = data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal.toLocaleString() : "";
    if (!camera && parts.length === 0 && !taken) {
      return null;
    }
    return { camera, exposure: parts.join(" · "), taken };
  }
  function formatBytes(bytes) {
    if (bytes <= 0) {
      return "—";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }
  function mountInspector(host, delegate) {
    let current = null;
    let epoch = 0;
    host.classList.add("atme-inspector");
    const render = (item) => {
      const thisEpoch = ++epoch;
      current = item;
      host.textContent = "";
      const header = document.createElement("div");
      header.className = "atme-inspector__header";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "atme-inspector__close";
      close.setAttribute("aria-label", "Close inspector");
      close.textContent = "×";
      close.addEventListener("click", () => delegate.onClose());
      header.appendChild(close);
      host.appendChild(header);
      const preview = document.createElement("div");
      preview.className = "atme-inspector__preview";
      if (item.kind === "image" && (item.thumbnail || item.url)) {
        const img = document.createElement("img");
        img.src = item.thumbnail || item.url;
        img.alt = item.alt;
        preview.appendChild(img);
      } else if (item.kind === "video") {
        const video = document.createElement("video");
        video.src = item.url;
        video.controls = true;
        preview.appendChild(video);
      } else if (item.kind === "audio") {
        const audio = document.createElement("audio");
        audio.src = item.url;
        audio.controls = true;
        preview.appendChild(audio);
      } else {
        const icon = document.createElement("span");
        icon.className = "dashicons dashicons-media-default";
        preview.appendChild(icon);
      }
      host.appendChild(preview);
      const fields = document.createElement("div");
      fields.className = "atme-inspector__fields";
      const addField = (label, value, key, multiline = false) => {
        let saveTimer = 0;
        let lastSaved = value;
        const onInput = (next) => {
          window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => {
            if (!current || next === lastSaved) {
              return;
            }
            void updateMedia(item.id, { [key]: next }).then((fresh) => {
              lastSaved = next;
              if (epoch === thisEpoch) {
                current = fresh;
              }
              delegate.onChanged(fresh);
            }).catch((error) => {
              getShell()?.notify?.({ title: "Could not save", body: error.message, type: "error" });
            });
          }, 800);
        };
        const control = multiline ? textareaControl({ label, value, className: "atme-field__input", onInput }) : textControl({ label, value, className: "atme-field__input", onInput });
        control.classList.add("atme-field");
        fields.appendChild(control);
      };
      addField("Title", item.title, "title");
      if (item.kind === "image") {
        addField("Alt text", item.alt, "alt_text", true);
        if (getShell()?.ai?.ask) {
          const suggest = buttonControl({
            label: "Suggest alt text (AI)",
            className: "atme-button atme-button--small",
            onClick: () => {
              suggest.setAttribute("disabled", "");
              void suggestAltText(item).then((alt) => {
                if (!alt || epoch !== thisEpoch) {
                  return;
                }
                return updateMedia(item.id, { alt_text: alt }).then((fresh) => {
                  getShell()?.showToast?.({ message: "Alt text drafted — give it a read" });
                  delegate.onChanged(fresh);
                  if (epoch === thisEpoch) {
                    render(fresh);
                  }
                });
              }).catch(
                (error) => getShell()?.notify?.({ title: "No suggestion", body: error.message, type: "error" })
              ).finally(() => suggest.removeAttribute("disabled"));
            }
          });
          fields.appendChild(suggest);
        }
      }
      addField("Caption", item.caption, "caption", true);
      host.appendChild(fields);
      const facts = document.createElement("dl");
      facts.className = "atme-inspector__facts";
      const addFact = (term, detail) => {
        const dt2 = document.createElement("dt");
        const dd = document.createElement("dd");
        dt2.textContent = term;
        dd.textContent = detail;
        facts.appendChild(dt2);
        facts.appendChild(dd);
      };
      addFact("Type", item.mime || "—");
      if (item.width > 0) {
        addFact("Dimensions", `${item.width} × ${item.height}`);
      }
      addFact("Uploaded", item.date ? (/* @__PURE__ */ new Date(item.date + "Z")).toLocaleDateString() : "—");
      if (item.bytes > 0) {
        addFact("Size", formatBytes(item.bytes));
      }
      host.appendChild(facts);
      if (item.kind === "image" && "image/svg+xml" !== item.mime) {
        void readExif(item.url).then((exif) => {
          if (epoch !== thisEpoch || !exif) {
            return;
          }
          if (exif.camera) {
            addFact("Camera", exif.camera);
          }
          if (exif.exposure) {
            addFact("Exposure", exif.exposure);
          }
          if (exif.taken) {
            addFact("Taken", exif.taken);
          }
        }).catch(() => void 0);
      }
      if (item.bytes <= 0) {
        void fetchFacts(item.id).then(({ facts: fileFacts }) => {
          if (epoch === thisEpoch && fileFacts.bytes > 0) {
            addFact("Size", formatBytes(fileFacts.bytes));
          }
        }).catch(() => void 0);
      }
      const actions = document.createElement("div");
      actions.className = "atme-inspector__actions";
      const button = (label, onClick, variant) => {
        const el = buttonControl({
          label,
          onClick,
          variant,
          className: `atme-button${variant ? ` atme-button--${variant}` : ""}`
        });
        actions.appendChild(el);
        return el;
      };
      button("Copy URL", () => {
        void navigator.clipboard?.writeText(item.url).then(() => {
          getShell()?.showToast?.({ message: "URL copied" });
        });
      });
      button("Download", () => {
        const link = document.createElement("a");
        link.href = item.url;
        link.download = "";
        link.rel = "noopener";
        link.click();
      });
      if (item.kind === "image") {
        button("↺ Rotate left", () => {
          void rotateMedia(item.id, item.mime, 270).then(() => {
            getShell()?.showToast?.({ message: "Rotated — the old orientation is a version" });
            delegate.onChanged(item);
          }).catch(
            (error) => getShell()?.notify?.({ title: "Could not rotate", body: error.message, type: "error" })
          );
        });
        button("↻ Rotate right", () => {
          void rotateMedia(item.id, item.mime, 90).then(() => {
            getShell()?.showToast?.({ message: "Rotated — the old orientation is a version" });
            delegate.onChanged(item);
          }).catch(
            (error) => getShell()?.notify?.({ title: "Could not rotate", body: error.message, type: "error" })
          );
        });
      }
      button("Regenerate sizes", () => {
        void regenerate(item.id).then(() => getShell()?.showToast?.({ message: "Sizes rebuilt" })).catch(
          (error) => getShell()?.notify?.({ title: "Could not regenerate", body: error.message, type: "error" })
        );
      });
      button(
        "Delete…",
        () => {
          void confirmAndDelete(item).then((deleted) => {
            if (deleted) {
              delegate.onDeleted(item.id);
            }
          });
        },
        "danger"
      );
      host.appendChild(actions);
      if (item.kind === "image") {
        host.appendChild(buildConvertSection(item, delegate));
        host.appendChild(buildDownloadAsSection(item));
        host.appendChild(buildReplaceSection(item, delegate));
      }
      const usageSection = document.createElement("div");
      usageSection.className = "atme-inspector__section";
      const usageTitle = document.createElement("h3");
      usageTitle.textContent = "Used in";
      usageSection.appendChild(usageTitle);
      const usageBody = document.createElement("div");
      usageBody.className = "atme-inspector__usage";
      usageBody.textContent = "Looking…";
      usageSection.appendChild(usageBody);
      host.appendChild(usageSection);
      void fetchUsage(item.id).then((rows) => {
        if (epoch !== thisEpoch) {
          return;
        }
        paintUsage(usageBody, rows);
      }).catch(() => {
        usageBody.textContent = "Could not be determined.";
      });
      const versionsSection = document.createElement("div");
      versionsSection.className = "atme-inspector__section";
      const versionsTitle = document.createElement("h3");
      versionsTitle.textContent = "Versions";
      versionsSection.appendChild(versionsTitle);
      const versionsBody = document.createElement("div");
      versionsBody.className = "atme-inspector__versions";
      versionsSection.appendChild(versionsBody);
      host.appendChild(versionsSection);
      void fetchVersions(item.id).then((versions) => {
        if (epoch !== thisEpoch) {
          return;
        }
        paintVersions(versionsBody, item, versions, delegate);
      }).catch(() => {
        versionsBody.textContent = "";
      });
    };
    const paintUsage = (body, rows) => {
      body.textContent = "";
      if (rows.length === 0) {
        body.appendChild(
          emptyStateEl({ title: "No visible references found", body: "Other posts, plugins or external sites may still use this file.", icon: "dashicons-yes-alt" })
        );
        return;
      }
      for (const row of rows) {
        const link = document.createElement("a");
        link.className = "atme-usage__row";
        link.href = row.editUrl || "#";
        link.textContent = `${row.title || `#${row.postId}`} — ${row.typeLabel}${row.usedAs === "featured" ? " (featured image)" : ""}`;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          const shell = getShell();
          if (shell?.windowManager?.open && row.editUrl) {
            const id = shell.deriveWindowId?.(row.editUrl) ?? `atme-usage-${row.postId}`;
            shell.windowManager.open({ id, baseId: id, url: row.editUrl, title: row.title, icon: "dashicons-edit" });
          } else if (row.editUrl) {
            window.open(row.editUrl, "_blank", "noopener");
          }
        });
        body.appendChild(link);
      }
    };
    const paintVersions = (body, item, versions, versionDelegate) => {
      body.textContent = "";
      if (versions.length === 0) {
        body.appendChild(noticeEl("No earlier versions. Replacing or converting in place stashes one."));
        return;
      }
      for (const version of versions) {
        const row = document.createElement("div");
        row.className = "atme-version__row";
        const label = document.createElement("span");
        label.textContent = `${new Date(version.date).toLocaleString()} · ${version.mime} · ${formatBytes(
          version.bytes
        )}`;
        row.appendChild(label);
        const restore = buttonControl({
          label: "Restore",
          className: "atme-button atme-button--small",
          onClick: () => {
            void rollbackVersion(item.id, version.file).then(() => {
              getShell()?.showToast?.({ message: "Version restored" });
              versionDelegate.onChanged(item);
            }).catch(
              (error) => getShell()?.notify?.({ title: "Could not restore", body: error.message, type: "error" })
            );
          }
        });
        row.appendChild(restore);
        body.appendChild(row);
      }
    };
    const renderEmpty = () => {
      epoch += 1;
      current = null;
      host.textContent = "";
      host.appendChild(
        emptyStateEl({
          title: "Nothing selected",
          body: "Click a tile to see everything about it here.",
          icon: "dashicons-info-outline"
        })
      );
    };
    return {
      show: render,
      showEmpty: renderEmpty,
      destroy: () => {
        epoch += 1;
        host.textContent = "";
        current = null;
      }
    };
  }
  function buildConvertSection(item, delegate) {
    const section = document.createElement("div");
    section.className = "atme-inspector__section";
    const title = document.createElement("h3");
    title.textContent = "Convert";
    section.appendChild(title);
    const encode = getConfig().conversion.encode;
    const currentFormat = item.mime.replace("image/", "").replace("jpg", "jpeg");
    const state = { format: "", quality: 82, replace: false, stripMeta: false };
    const options = ["webp", "avif", "jpeg", "png"].filter((slug) => slug !== currentFormat).map((slug) => ({
      value: slug,
      label: slug.toUpperCase() + (encode[slug] ? "" : " (unavailable here)")
    }));
    state.format = options.find((option) => encode[option.value])?.value ?? options[0]?.value ?? "webp";
    const row = document.createElement("div");
    row.className = "atme-convert";
    row.appendChild(
      selectControl({
        label: "Target format",
        value: state.format,
        options,
        hideLabel: true,
        onChange: (value) => {
          state.format = value;
        }
      })
    );
    section.appendChild(row);
    section.appendChild(
      rangeControl({
        label: "Quality",
        value: state.quality,
        min: 40,
        max: 100,
        onChange: (value) => {
          state.quality = value;
        }
      })
    );
    section.appendChild(
      checkboxControl({
        label: "Strip EXIF and location data (the colour profile stays)",
        onChange: (checked) => {
          state.stripMeta = checked;
        }
      })
    );
    section.appendChild(
      checkboxControl({
        label: "Replace this attachment (a new format changes its URL)",
        onChange: (checked) => {
          state.replace = checked;
        }
      })
    );
    const go = buttonControl({
      label: "Convert",
      variant: "primary",
      className: "atme-button atme-button--primary",
      onClick: () => {
        run();
      }
    });
    const run = () => {
      go.setAttribute("disabled", "");
      void convertMedia(item.id, {
        format: state.format,
        quality: state.quality,
        strip_meta: state.stripMeta,
        replace: state.replace
      }).then((result) => {
        const saved = item.bytes > 0 && result.facts.bytes > 0 ? item.bytes - result.facts.bytes : 0;
        getShell()?.showToast?.({
          message: result.replaced ? `Converted in place${saved > 0 ? ` — ${formatBytes(saved)} saved` : ""}` : "Converted copy created"
        });
        delegate.onChanged(item);
      }).catch((error) => {
        getShell()?.notify?.({ title: "Conversion failed", body: error.message, type: "error" });
      }).finally(() => {
        go.removeAttribute("disabled");
      });
    };
    section.appendChild(go);
    return section;
  }
  function buildReplaceSection(item, delegate) {
    const section = document.createElement("div");
    section.className = "atme-inspector__section";
    const title = document.createElement("h3");
    title.textContent = "Replace file";
    section.appendChild(title);
    section.appendChild(
      noticeEl("The old file becomes a version. Same-format replacements keep the URL. Changing format changes the URL; existing embedded links may need updating.")
    );
    const picker = document.createElement("input");
    picker.type = "file";
    picker.hidden = true;
    const choose = buttonControl({
      label: "Choose replacement…",
      className: "atme-button",
      onClick: () => picker.click()
    });
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) {
        return;
      }
      choose.setAttribute("disabled", "");
      void replaceMedia(item.id, file).then(() => {
        getShell()?.showToast?.({ message: "File replaced" });
        delegate.onChanged(item);
      }).catch((error) => {
        getShell()?.notify?.({ title: "Replace failed", body: error.message, type: "error" });
      }).finally(() => {
        choose.removeAttribute("disabled");
        picker.value = "";
      });
    });
    section.appendChild(choose);
    section.appendChild(picker);
    return section;
  }
  function buildDownloadAsSection(item) {
    const section = document.createElement("div");
    section.className = "atme-inspector__section";
    const title = document.createElement("h3");
    title.textContent = "Download as";
    section.appendChild(title);
    const support = browserEncodeSupport();
    const currentFormat = item.mime.replace("image/", "").replace("jpg", "jpeg");
    const row = document.createElement("div");
    row.className = "atme-inspector__actions";
    for (const format of ["webp", "avif", "jpeg", "png"]) {
      if (format === currentFormat || !support[format]) {
        continue;
      }
      const el = buttonControl({
        label: format.toUpperCase(),
        className: "atme-button atme-button--small",
        onClick: () => {
          el.setAttribute("disabled", "");
          void downloadAs(item, format).then(() => getShell()?.showToast?.({ message: `Downloading as ${format.toUpperCase()}` })).catch(
            (error) => getShell()?.notify?.({ title: "Could not convert", body: error.message, type: "error" })
          ).finally(() => el.removeAttribute("disabled"));
        }
      });
      row.appendChild(el);
    }
    section.appendChild(row);
    return section;
  }
  const DRAG_THRESHOLD_PX = 4;
  const CLICK_GUARD_MS = 500;
  class FallbackDragManager {
    constructor() {
      this.targets = [];
      this.active = null;
      this.lastEndMs = 0;
    }
    start(opts) {
      if (this.active || opts.origin.button !== 0) {
        return null;
      }
      const { payload, origin } = opts;
      const startX = origin.clientX;
      const startY = origin.clientY;
      let lifted = false;
      let finished = false;
      let ghost = null;
      let hovered = null;
      let offsetX = 0;
      let offsetY = 0;
      const cleanup = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        ghost?.remove();
        ghost = null;
        payload.source.classList.remove("atme-is-dragging");
        hovered?.onLeave?.(session);
        hovered = null;
        this.active = null;
        this.lastEndMs = Date.now();
      };
      const session = {
        payload,
        isFinished: () => finished,
        cancel: (reason = "caller") => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();
          opts.onCancel?.(reason);
        }
      };
      const lift = (ev) => {
        lifted = true;
        payload.source.classList.add("atme-is-dragging");
        const rect = payload.source.getBoundingClientRect();
        offsetX = payload.ghost?.offsetX ?? startX - rect.left;
        offsetY = payload.ghost?.offsetY ?? startY - rect.top;
        ghost = payload.ghost?.element ?? payload.source.cloneNode(true);
        ghost.classList.add("atme-drag-ghost");
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        position(ev);
      };
      const position = (ev) => {
        if (ghost) {
          ghost.style.transform = `translate3d(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px, 0)`;
        }
      };
      const onMove = (ev) => {
        if (finished) {
          return;
        }
        if (!lifted) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
            return;
          }
          lift(ev);
        }
        position(ev);
        const next = this.hitTest(ev.clientX, ev.clientY);
        if (next !== hovered) {
          hovered?.onLeave?.(session);
          hovered = next;
          hovered?.onEnter?.(session);
        }
      };
      const onUp = (ev) => {
        if (finished) {
          return;
        }
        if (!lifted) {
          finished = true;
          cleanup();
          opts.onClickOnly?.();
          return;
        }
        const target = hovered;
        finished = true;
        cleanup();
        if (target && target.accept(payload)) {
          opts.onCommit?.(target);
          void target.onDrop(session, { clientX: ev.clientX, clientY: ev.clientY });
          return;
        }
        opts.onCancel?.(target ? "rejected" : "no-target");
      };
      const onCancel = () => session.cancel("pointercancel");
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          session.cancel("escape");
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      this.active = session;
      return session;
    }
    registerDropTarget(target) {
      this.targets = this.targets.filter((t2) => t2.id !== target.id);
      this.targets.push(target);
      return () => {
        this.targets = this.targets.filter((t2) => t2.id !== target.id);
      };
    }
    isDragging() {
      return this.active !== null;
    }
    recentlyEndedDrag(withinMs = CLICK_GUARD_MS) {
      return Date.now() - this.lastEndMs < withinMs;
    }
    /**
     * The registered target the cursor is most specifically over.
     *
     * Depth first, so a target nested inside another wins — that is what makes
     * dropping on a card mean something more specific than dropping in the
     * column that holds it.
     *
     * Ties go to whichever element comes *later* in document order, which for
     * overlapping siblings is the one painted on top and therefore the one the
     * user believes they are aiming at. Without the tie-break, two overlapping
     * siblings resolve by registration order instead, and a small target sitting
     * on top of a large one never receives a drop at all — including when its
     * job was to refuse one, which is how a rejected drop falls through to the
     * surface behind and quietly does something else.
     *
     * The honest limitation: `z-index` can put a shallower, earlier element on
     * top and this will still prefer the later one. The shell's own manager is
     * the answer for anything that layered; this is the fallback for a flat
     * admin page.
     */
    hitTest(x2, y2) {
      let best = null;
      let bestDepth = -1;
      for (const target of this.targets) {
        const rect = target.element.getBoundingClientRect();
        if (x2 < rect.left || x2 > rect.right || y2 < rect.top || y2 > rect.bottom) {
          continue;
        }
        const depth = depthOf(target.element);
        if (depth > bestDepth) {
          best = target;
          bestDepth = depth;
          continue;
        }
        if (depth === bestDepth && best && follows(target.element, best.element)) {
          best = target;
        }
      }
      return best;
    }
  }
  function depthOf(element) {
    let depth = 0;
    let node = element;
    while (node) {
      depth++;
      node = node.parentElement;
    }
    return depth;
  }
  function follows(a2, b2) {
    return (b2.compareDocumentPosition(a2) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }
  let fallback = null;
  function getDragManager() {
    const shell = getShell();
    if (shell?.dragManager) {
      return shell.dragManager;
    }
    if (!fallback) {
      fallback = new FallbackDragManager();
    }
    return fallback;
  }
  const EXPLORER_TYPE = "allterrain-media-explorer/library";
  const MEDIA_TYPE = "media";
  function relations() {
    const os = window.wp?.os;
    return os?.relations ?? null;
  }
  function windowIdOf(element) {
    const host = element.closest("[data-window-id], .os-window");
    if (!host) {
      return null;
    }
    const attribute = host.getAttribute("data-window-id");
    if (attribute) {
      return attribute;
    }
    const id = host.id ?? "";
    return id ? id.replace(/^wp-window-/, "") : null;
  }
  const ATTACH_TIMEOUT_MS = 6e3;
  const ATTACH_POLL_MS = 120;
  function setIdentity(element, ref) {
    const api = relations();
    wanted.set(element, ref);
    if (!api?.set) {
      return;
    }
    const attempt = (deadline) => {
      if (pending$1.get(element) !== token) {
        return;
      }
      const windowId = windowIdOf(element);
      if (!windowId) {
        if (Date.now() < deadline) {
          window.setTimeout(() => attempt(deadline), ATTACH_POLL_MS);
        }
        return;
      }
      try {
        api.set(windowId, ref);
      } catch (error) {
        if (!warned) {
          warned = true;
          console.error("[AllTerrain Media Explorer] The shell refused a window identity.", error, ref);
        }
        pending$1.delete(element);
        return;
      }
      const stuck = !ref || api.get?.(windowId)?.id === ref.id;
      if (stuck || Date.now() >= deadline) {
        pending$1.delete(element);
        return;
      }
      window.setTimeout(() => attempt(deadline), ATTACH_POLL_MS);
    };
    const token = Symbol("atf-identity");
    pending$1.set(element, token);
    attempt(Date.now() + ATTACH_TIMEOUT_MS);
  }
  let warned = false;
  const pending$1 = /* @__PURE__ */ new WeakMap();
  const wanted = /* @__PURE__ */ new Map();
  function reapply() {
    for (const [element, ref] of wanted) {
      if (!element.isConnected) {
        wanted.delete(element);
        continue;
      }
      setIdentity(element, ref);
    }
  }
  if (typeof document !== "undefined") {
    for (const event of ["os-window-content-loaded", "os-window-opened"]) {
      document.addEventListener(event, () => reapply());
    }
  }
  function mediaIdentity(item, usage, adminUrl, root) {
    const links = [];
    const related = [];
    for (const row of usage) {
      if (row.postId <= 0 || !row.type) {
        continue;
      }
      links.push({ type: row.type, id: row.postId, rel: "references" });
      related.push({
        id: `allterrain-media-explorer/used-in-${row.postId}`,
        label: row.title || `#${row.postId}`,
        url: row.editUrl || `${adminUrl}post.php?post=${row.postId}&action=edit`,
        group: "allterrain-media-explorer",
        groupLabel: "Used in",
        icon: "dashicons-admin-links"
      });
    }
    return {
      type: MEDIA_TYPE,
      id: item.id,
      // Rooted at the library when opened from it: the shell draws the
      // child→root spline between the viewer and the explorer window —
      // the visible thread back to where the photo came from.
      ...root ? { root } : {},
      label: item.title || `Media #${item.id}`,
      // The shell caps links at 32 and related at 64; trimming here keeps
      // the excess out of the payload rather than trusting it to discard
      // the tail. Related self-budgets lower so the shell's own comment
      // and term rows survive the cap.
      links: links.slice(0, 32),
      related: related.slice(0, 24),
      previewUrl: item.url || void 0
    };
  }
  function libraryIdentity() {
    return {
      type: EXPLORER_TYPE,
      id: "library",
      label: "Media Library"
    };
  }
  const VIEWER_WINDOW_ID = "atme-viewer";
  const VIEW_TOPIC = "atme.view";
  function openViewer(id) {
    const shell = getShell();
    if (!shell || id <= 0) {
      return;
    }
    shell.openWindow?.(VIEWER_WINDOW_ID, {
      source: "allterrain-media-explorer",
      params: { mediaId: id }
    });
    if (!shell.getWindowConfig?.(VIEWER_WINDOW_ID)?.osApp) {
      shell.broadcast?.(VIEW_TOPIC, { id });
    }
  }
  const REVEAL_TOPIC = "atme.reveal";
  const SMART_VIEWS = [
    { slug: "", label: "All media", icon: "dashicons-format-gallery" },
    { slug: "unattached", label: "Unattached", icon: "dashicons-editor-unlink" },
    { slug: "unfiled", label: "Unfiled", icon: "dashicons-portfolio" },
    { slug: "missing-alt", label: "Missing alt text", icon: "dashicons-warning" },
    { slug: "converted", label: "Converted copies", icon: "dashicons-controls-repeat" },
    { slug: "duplicates", label: "Duplicates", icon: "dashicons-images-alt" }
  ];
  const KINDS = [
    { value: "", label: "All types" },
    { value: "image", label: "Images" },
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
    { value: "application", label: "Documents" }
  ];
  const DEFAULT_QUERY = {
    search: "",
    kind: "",
    folder: 0,
    view: "",
    orderby: "date",
    order: "desc"
  };
  function mountExplorer(root, params = {}) {
    const app = new ExplorerApp(root);
    app.retarget(params);
    app.boot();
    return Object.assign(() => app.destroy(), { retarget: (next) => app.retarget(next) });
  }
  class ExplorerApp {
    constructor(root) {
      this.disposed = false;
      this.booted = false;
      this.target = {};
      this.teardowns = [];
      this.grid = null;
      this.inspector = null;
      this.query = { ...DEFAULT_QUERY };
      this.page = 0;
      this.totalPages = 1;
      this.total = 0;
      this.loading = false;
      this.queryEpoch = 0;
      this.folders = [];
      this.statusEl = null;
      this.sidebarEl = null;
      this.openItemId = 0;
      this.collections = [];
      this.quickLook = null;
      this.wizard = null;
      this.wizardOpen = false;
      this.bulkBar = null;
      this.folderDropOffs = [];
      this.root = root;
    }
    /** Targets this instance, including requests received while components load. */
    retarget(params) {
      this.target = params;
      if (!this.booted || this.disposed) {
        return;
      }
      const id = Number(params.mediaId ?? 0);
      if (Number.isSafeInteger(id) && id > 0) {
        void this.revealItem(id);
      }
      if (params.wizard === true) {
        this.openWizard();
      }
    }
    async boot() {
      await ensureComponents().catch(() => false);
      if (this.disposed) {
        return;
      }
      const loading = this.root.querySelector("[data-atme-loading]");
      const frame = this.root.querySelector("[data-atme-frame]");
      const sidebar = this.root.querySelector("[data-atme-sidebar]");
      const main = this.root.querySelector("[data-atme-main]");
      const inspectorHost = this.root.querySelector("[data-atme-inspector]");
      if (!frame || !sidebar || !main || !inspectorHost) {
        return;
      }
      loading?.setAttribute("hidden", "");
      frame.removeAttribute("hidden");
      this.sidebarEl = sidebar;
      const toolbar = document.createElement("div");
      toolbar.className = "atme-toolbar";
      main.appendChild(toolbar);
      this.buildToolbar(toolbar);
      const gridHost = document.createElement("div");
      gridHost.className = "atme-gridhost";
      main.appendChild(gridHost);
      const status = document.createElement("div");
      status.className = "atme-status";
      main.appendChild(status);
      this.statusEl = status;
      this.grid = new MediaGrid(gridHost, getDragManager(), {
        // Double-click / Enter is "look at it" — the viewer window.
        // The inspector stays one ⓘ (or `i`) away.
        onOpen: (item) => openViewer(item.id),
        onSelection: (ids) => this.onSelection(ids),
        onNeedMore: () => void this.loadMore()
      });
      this.inspector = mountInspector(inspectorHost, {
        onChanged: (item) => this.grid?.patchItems([item]),
        onDeleted: (id) => {
          this.grid?.removeItems([id]);
          this.total = Math.max(0, this.total - 1);
          this.openItemId = 0;
          this.inspector?.showEmpty();
          this.paintStatus();
        },
        onClose: () => this.closeInspector()
      });
      inspectorHost.removeAttribute("hidden");
      this.inspector.showEmpty();
      this.wireUploadDrop(frame);
      this.wireGridDrops(gridHost);
      this.wireQuickLook(main, gridHost);
      this.wizard = mountWizard(
        main,
        () => {
          void this.runQuery();
          void this.refreshFolders();
        },
        () => {
          this.wizardOpen = false;
          this.paintSidebar();
        }
      );
      this.announceIdentity(0);
      this.teardowns.push(
        onMediaChanged((ids) => void this.onExternalChange(ids))
      );
      const shell = getShell();
      if (shell?.subscribe) {
        this.teardowns.push(
          shell.subscribe(REVEAL_TOPIC, (payload) => {
            const id = Number(payload?.id);
            if (id > 0) {
              void this.revealItem(id);
            }
          })
        );
      }
      if (shell?.subscribe) {
        this.teardowns.push(shell.subscribe("atme.wizard", () => this.openWizard()));
      }
      this.booted = true;
      this.retarget(this.target);
      await Promise.all([this.runQuery(), this.refreshFolders(), this.refreshCollections()]);
    }
    /**
     * Spacebar opens Quick Look on the selection; arrows walk from there.
     */
    /** ⓘ / `i`: hides or restores the always-on info panel. */
    toggleInspectorForSelection() {
      const host = this.root.querySelector("[data-atme-inspector]");
      if (host && !host.hasAttribute("hidden")) {
        this.closeInspector();
        return;
      }
      host?.removeAttribute("hidden");
      const selected = this.grid?.selectedItems() ?? [];
      if (selected[0]) {
        this.openItem(selected[0]);
      } else {
        this.inspector?.showEmpty();
      }
    }
    wireQuickLook(main, gridHost) {
      this.quickLook = mountQuickLook(main, (direction) => {
        const items = this.grid?.getItems() ?? [];
        const selected = this.grid?.selectedIds() ?? [];
        const currentId = selected[0] ?? 0;
        const index = items.findIndex((item) => item.id === currentId);
        const next = items[index + direction];
        if (next) {
          this.grid?.reveal(next.id);
        }
        return next ?? null;
      });
      gridHost.addEventListener("keydown", (event) => {
        if (("i" === event.key || "I" === event.key) && !this.quickLook?.isOpen()) {
          event.preventDefault();
          this.toggleInspectorForSelection();
          return;
        }
        if (event.key !== " " || this.quickLook?.isOpen()) {
          return;
        }
        const selected = this.grid?.selectedItems() ?? [];
        if (selected.length > 0) {
          event.preventDefault();
          this.quickLook?.open(selected[0]);
        }
      });
    }
    /**
     * Tiles dragged in from WP Explorer or the wallpaper file into the
     * current folder — the drop that makes a folder feel like a place.
     */
    wireGridDrops(gridHost) {
      const off = getDragManager().registerDropTarget({
        id: "allterrain-media-explorer/grid",
        element: gridHost,
        accept: (payload) => {
          if (!isDesktopPayload(payload) || gridHost.contains(payload.source)) {
            return false;
          }
          return entitiesIn(payload).some((entity) => entity.kind === "attachment");
        },
        acceptLabel: this.query.folder > 0 ? "File here" : "Reveal in explorer",
        onDrop: (session) => {
          const ids = entitiesIn(session.payload).filter((entity) => entity.kind === "attachment").map((entity) => Number(entity.ref)).filter((id) => id > 0);
          if (ids.length === 0) {
            return;
          }
          if (this.query.folder > 0) {
            void fileIntoFolder(ids, this.query.folder).then(() => {
              getShell()?.showToast?.({
                message: `Filed ${ids.length} item${ids.length === 1 ? "" : "s"}`
              });
              void this.runQuery();
              void this.refreshFolders();
            });
          } else {
            void this.revealItem(ids[0]);
          }
        }
      });
      this.teardowns.push(off);
    }
    /* ------------------------------------------------------------------ *
     * Toolbar and sidebar.
     * ------------------------------------------------------------------ */
    buildToolbar(toolbar) {
      let debounce = 0;
      const search = textControl({
        label: "Search media",
        placeholder: "Search media…",
        type: "search",
        className: "atme-toolbar__search",
        hideLabel: true,
        onInput: (value) => {
          window.clearTimeout(debounce);
          debounce = window.setTimeout(() => {
            this.query.search = value.trim();
            void this.runQuery();
          }, 250);
        }
      });
      search.classList.add("atme-toolbar__search");
      toolbar.appendChild(search);
      toolbar.appendChild(
        selectControl({
          label: "Filter by type",
          value: this.query.kind,
          options: KINDS,
          className: "atme-toolbar__kind",
          hideLabel: true,
          onChange: (value) => {
            this.query.kind = value;
            void this.runQuery();
          }
        })
      );
      toolbar.appendChild(
        selectControl({
          label: "Sort",
          value: `${this.query.orderby}:${this.query.order}`,
          options: [
            { value: "date:desc", label: "Newest first" },
            { value: "date:asc", label: "Oldest first" },
            { value: "title:asc", label: "Name A–Z" },
            { value: "title:desc", label: "Name Z–A" }
          ],
          className: "atme-toolbar__sort",
          hideLabel: true,
          onChange: (value) => {
            const [orderby, order] = value.split(":");
            this.query.orderby = orderby;
            this.query.order = order;
            void this.runQuery();
          }
        })
      );
      let layout = "grid";
      const layoutToggle = buttonControl({
        label: "List view",
        className: "atme-button",
        onClick: () => {
          layout = "grid" === layout ? "list" : "grid";
          this.grid?.setLayout(layout);
          layoutToggle.textContent = "grid" === layout ? "List view" : "Grid view";
        }
      });
      toolbar.appendChild(layoutToggle);
      toolbar.appendChild(
        buttonControl({
          label: "ⓘ Info",
          className: "atme-button",
          onClick: () => this.toggleInspectorForSelection()
        })
      );
      const spacer = document.createElement("div");
      spacer.className = "atme-toolbar__spacer";
      toolbar.appendChild(spacer);
      if (getConfig().canUpload) {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.multiple = true;
        picker.hidden = true;
        picker.addEventListener("change", () => {
          if (picker.files?.length) {
            void this.uploadFiles(Array.from(picker.files));
            picker.value = "";
          }
        });
        toolbar.appendChild(
          buttonControl({
            label: "Upload",
            variant: "primary",
            className: "atme-button atme-button--primary",
            onClick: () => picker.click()
          })
        );
        toolbar.appendChild(picker);
      }
    }
    /**
     * The wizard behaves like a sidebar tab: opening it marks its row
     * active, and choosing any other row closes it and returns the library.
     */
    openWizard() {
      this.wizardOpen = true;
      this.wizard?.open();
      this.paintSidebar();
    }
    leaveWizard() {
      if (this.wizardOpen) {
        this.wizard?.close();
      }
    }
    paintSidebar() {
      const sidebar = this.sidebarEl;
      if (!sidebar) {
        return;
      }
      for (const off of this.folderDropOffs.splice(0)) {
        off();
      }
      sidebar.textContent = "";
      const views = document.createElement("div");
      views.className = "atme-side__group";
      const viewsTitle = document.createElement("div");
      viewsTitle.className = "atme-side__title";
      viewsTitle.textContent = "Library";
      views.appendChild(viewsTitle);
      for (const view of SMART_VIEWS) {
        views.appendChild(
          this.sideRow(
            view.label,
            view.icon,
            !this.wizardOpen && this.query.view === view.slug && this.query.folder === 0,
            () => {
              this.leaveWizard();
              this.query.view = view.slug;
              this.query.folder = 0;
              void this.runQuery();
              this.paintSidebar();
            }
          )
        );
      }
      sidebar.appendChild(views);
      const foldersGroup = document.createElement("div");
      foldersGroup.className = "atme-side__group";
      const foldersTitle = document.createElement("div");
      foldersTitle.className = "atme-side__title";
      foldersTitle.textContent = "Folders";
      foldersGroup.appendChild(foldersTitle);
      const roots = this.folders.filter((folder) => folder.parent === 0);
      const paintLevel = (level, depth) => {
        for (const folder of level) {
          const row = this.sideRow(
            folder.name,
            "dashicons-category",
            !this.wizardOpen && this.query.folder === folder.id,
            () => {
              this.leaveWizard();
              this.query.folder = folder.id;
              this.query.view = "";
              void this.runQuery();
              this.paintSidebar();
            },
            folder.count
          );
          row.style.paddingInlineStart = `${8 + depth * 16}px`;
          foldersGroup.appendChild(row);
          this.folderDropOffs.push(
            getDragManager().registerDropTarget({
              id: `allterrain-media-explorer/folder-${folder.id}`,
              element: row,
              accept: (payload) => {
                if (payload.type === "shortcut" || payload.type === "desktop-file") {
                  return entitiesIn(payload).some((entity) => entity.kind === "attachment");
                }
                return false;
              },
              acceptLabel: `File into ${folder.name}`,
              onEnter: () => row.classList.add("is-drop-target"),
              onLeave: () => row.classList.remove("is-drop-target"),
              onDrop: (session) => {
                row.classList.remove("is-drop-target");
                const ids = entitiesIn(session.payload).filter((entity) => entity.kind === "attachment").map((entity) => Number(entity.ref)).filter((id) => id > 0);
                if (ids.length === 0) {
                  return;
                }
                void fileIntoFolder(ids, folder.id).then(() => {
                  getShell()?.showToast?.({
                    message: `Filed ${ids.length} item${ids.length === 1 ? "" : "s"} into ${folder.name}`
                  });
                  void this.refreshFolders();
                  if (this.query.folder > 0 || this.query.view === "unfiled") {
                    void this.runQuery();
                  }
                });
              }
            })
          );
          paintLevel(this.folders.filter((child) => child.parent === folder.id), depth + 1);
        }
      };
      paintLevel(roots, 0);
      const newFolder = buttonControl({
        label: "+ New folder",
        className: "atme-side__row",
        onClick: () => {
          void this.promptNewFolder();
        }
      });
      newFolder.classList.add("atme-side__new");
      foldersGroup.appendChild(newFolder);
      sidebar.appendChild(foldersGroup);
      const collectionsGroup = document.createElement("div");
      collectionsGroup.className = "atme-side__group";
      const collectionsTitle = document.createElement("div");
      collectionsTitle.className = "atme-side__title";
      collectionsTitle.textContent = "Collections";
      collectionsGroup.appendChild(collectionsTitle);
      for (const collection of this.collections) {
        const row = this.sideRow(collection.title, "dashicons-star-filled", false, () => {
          this.leaveWizard();
          this.query = { ...DEFAULT_QUERY, ...collection.query };
          void this.runQuery();
          this.paintSidebar();
        });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const shell = getShell();
          const remove = () => void deleteCollection(collection.id).then(() => void this.refreshCollections());
          if (shell?.confirm) {
            void shell.confirm({
              title: "Remove collection",
              message: `Remove “${collection.title}”? The media it lists is untouched.`,
              confirmLabel: "Remove",
              danger: true
            }).then((yes) => yes && remove());
          } else {
            remove();
          }
        });
        collectionsGroup.appendChild(row);
      }
      const saveCollection = buttonControl({
        label: "+ Save current view",
        className: "atme-side__row",
        onClick: () => {
          void this.promptSaveCollection();
        }
      });
      saveCollection.classList.add("atme-side__new");
      collectionsGroup.appendChild(saveCollection);
      sidebar.appendChild(collectionsGroup);
      const toolsGroup = document.createElement("div");
      toolsGroup.className = "atme-side__group";
      const toolsTitle = document.createElement("div");
      toolsTitle.className = "atme-side__title";
      toolsTitle.textContent = "Tools";
      toolsGroup.appendChild(toolsTitle);
      toolsGroup.appendChild(
        this.sideRow("Optimization Wizard", "dashicons-superhero", this.wizardOpen, () => this.openWizard())
      );
      sidebar.appendChild(toolsGroup);
    }
    async promptNewFolder() {
      const name = window.prompt("Folder name");
      if (!name || !name.trim()) {
        return;
      }
      try {
        const created = await createFolder(name.trim(), this.query.folder);
        await this.refreshFolders();
        this.query.folder = created.id;
        this.query.view = "";
        this.paintSidebar();
        await this.runQuery();
      } catch (error) {
        getShell()?.notify?.({
          title: "Could not create the folder",
          body: error instanceof Error ? error.message : "",
          type: "error"
        });
      }
    }
    async promptSaveCollection() {
      const title = window.prompt("Collection name", this.query.search || "My collection");
      if (!title || !title.trim()) {
        return;
      }
      try {
        await createCollection(title.trim(), { ...this.query });
        await this.refreshCollections();
      } catch (error) {
        getShell()?.notify?.({
          title: "Could not save the collection",
          body: error instanceof Error ? error.message : "",
          type: "error"
        });
      }
    }
    async refreshCollections() {
      try {
        this.collections = await fetchCollections();
      } catch {
        this.collections = [];
      }
      this.paintSidebar();
    }
    sideRow(label, icon, active, onClick, count) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "atme-side__row" + (active ? " is-active" : "");
      const iconEl = document.createElement("span");
      iconEl.className = `dashicons ${icon}`;
      row.appendChild(iconEl);
      const labelEl = document.createElement("span");
      labelEl.className = "atme-side__label";
      labelEl.textContent = label;
      row.appendChild(labelEl);
      if (typeof count === "number" && count > 0) {
        const countEl = document.createElement("span");
        countEl.className = "atme-side__count";
        countEl.textContent = String(count);
        row.appendChild(countEl);
      }
      row.addEventListener("click", onClick);
      return row;
    }
    /* ------------------------------------------------------------------ *
     * Data.
     * ------------------------------------------------------------------ */
    async runQuery() {
      const epoch = ++this.queryEpoch;
      this.loading = true;
      this.page = 0;
      this.paintStatus("Loading…");
      if ("duplicates" === this.query.view) {
        await this.runDuplicatesQuery(epoch);
        return;
      }
      try {
        const result = await fetchMedia(this.query, 1);
        if (epoch !== this.queryEpoch) {
          return;
        }
        this.page = 1;
        this.totalPages = result.totalPages;
        this.total = result.total;
        this.grid?.setItems(result.items);
      } catch (error) {
        this.paintStatus(error instanceof Error ? error.message : "The library could not be loaded.");
        return;
      } finally {
        this.loading = false;
      }
      this.paintStatus();
    }
    /**
     * The duplicates view: hash groups resolved to items, group order kept
     * so twins sit side by side.
     */
    async runDuplicatesQuery(epoch) {
      try {
        const { hashed, groups } = await fetchDuplicates();
        if (epoch !== this.queryEpoch) {
          return;
        }
        const ids = groups.flatMap((group) => group.ids).slice(0, 100);
        const items = await fetchMediaByIds(ids);
        if (epoch !== this.queryEpoch) {
          return;
        }
        this.page = 1;
        this.totalPages = 1;
        this.total = items.length;
        this.grid?.setItems(items);
        this.paintStatus(
          items.length > 0 ? `${groups.length} duplicate group${groups.length === 1 ? "" : "s"} · ${hashed} files checked so far — run the wizard scan to check the rest` : `No duplicates among the ${hashed} files checked so far — run the wizard scan to check the rest`
        );
      } catch (error) {
        this.paintStatus(error instanceof Error ? error.message : "Duplicates could not be loaded.");
      } finally {
        this.loading = false;
      }
    }
    async loadMore() {
      if (this.loading || this.page >= this.totalPages) {
        return;
      }
      const epoch = this.queryEpoch;
      this.loading = true;
      try {
        const result = await fetchMedia(this.query, this.page + 1);
        if (epoch !== this.queryEpoch) {
          return;
        }
        this.page += 1;
        this.totalPages = result.totalPages;
        this.total = result.total;
        this.grid?.appendItems(result.items);
      } finally {
        this.loading = false;
      }
      this.paintStatus();
    }
    async refreshFolders() {
      try {
        this.folders = await fetchFolders();
      } catch {
        this.folders = [];
      }
      this.paintSidebar();
    }
    /** Changes announced by other windows: refetch just those rows. */
    async onExternalChange(ids) {
      if (ids.length === 0) {
        void this.runQuery();
        return;
      }
      const shown = new Set(this.grid?.getItems().map((item) => item.id) ?? []);
      const relevant = ids.filter((id) => shown.has(id));
      const patched = [];
      const gone = [];
      await Promise.all(
        relevant.map(async (id) => {
          try {
            patched.push(await fetchMediaItem(id));
          } catch {
            gone.push(id);
          }
        })
      );
      if (patched.length) {
        this.grid?.patchItems(patched);
        if (this.openItemId && patched.some((item) => item.id === this.openItemId)) {
          const fresh = patched.find((item) => item.id === this.openItemId);
          if (fresh) {
            this.inspector?.show(fresh);
          }
        }
      }
      if (gone.length) {
        this.grid?.removeItems(gone);
      }
    }
    /* ------------------------------------------------------------------ *
     * Uploads.
     * ------------------------------------------------------------------ */
    /**
     * OS files dropped on the window upload into the current folder.
     *
     * Native HTML5 drop — the one place it belongs, because the drag starts
     * in Finder where the shell's pointer pipeline cannot see it.
     */
    wireUploadDrop(frame) {
      const over = (event) => {
        if (event.dataTransfer?.types.includes("Files")) {
          event.preventDefault();
          frame.classList.add("is-drop-ready");
        }
      };
      const leave = () => frame.classList.remove("is-drop-ready");
      const drop = (event) => {
        if (!event.dataTransfer?.files.length) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        leave();
        void this.uploadFiles(Array.from(event.dataTransfer.files));
      };
      const paste = (event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          void this.uploadFiles(files);
        }
      };
      frame.addEventListener("dragover", over);
      frame.addEventListener("dragleave", leave);
      frame.addEventListener("drop", drop);
      frame.addEventListener("paste", paste);
      this.teardowns.push(() => {
        frame.removeEventListener("dragover", over);
        frame.removeEventListener("dragleave", leave);
        frame.removeEventListener("drop", drop);
        frame.removeEventListener("paste", paste);
      });
    }
    async uploadFiles(files) {
      const shell = getShell();
      let done = 0;
      let failed = 0;
      this.paintStatus(`Uploading 0/${files.length}…`);
      for (const file of files) {
        try {
          const item = await uploadMedia(file, this.query.folder);
          done += 1;
          this.grid?.appendItems([item]);
        } catch (error) {
          failed += 1;
          shell?.notify?.({
            title: "Upload failed",
            body: `${file.name}: ${error instanceof Error ? error.message : "unknown error"}`,
            type: "error"
          });
        }
        this.paintStatus(`Uploading ${done + failed}/${files.length}…`);
      }
      this.total += done;
      this.paintStatus();
      if (done > 0) {
        void this.refreshFolders();
        void this.runQuery();
      }
    }
    /* ------------------------------------------------------------------ *
     * Inspector, selection, reveal.
     * ------------------------------------------------------------------ */
    onSelection(ids) {
      this.paintStatus();
      this.paintBulkBar(ids);
      if (this.root.querySelector("[data-atme-inspector]")?.hasAttribute("hidden")) {
        return;
      }
      if (ids.length >= 1) {
        const item = this.grid?.getItems().find((candidate) => candidate.id === ids[0]);
        if (item) {
          this.openItem(item);
        }
      } else {
        this.openItemId = 0;
        this.inspector?.showEmpty();
      }
    }
    openItem(item) {
      this.openItemId = item.id;
      this.inspector?.show(item);
      this.root.querySelector("[data-atme-inspector]")?.removeAttribute("hidden");
    }
    closeInspector() {
      this.openItemId = 0;
      this.root.querySelector("[data-atme-inspector]")?.setAttribute("hidden", "");
    }
    async revealItem(id) {
      if (!this.grid) {
        return;
      }
      if (!this.grid.getItems().some((item2) => item2.id === id)) {
        this.query = { ...DEFAULT_QUERY };
        await this.runQuery();
      }
      this.grid.reveal(id);
      const item = this.grid.getItems().find((candidate) => candidate.id === id);
      if (item) {
        this.openItem(item);
      }
    }
    /**
     * Declares what this window is, for the relations engine.
     *
     * Always the library root — never the item under inspection. The Media
     * Viewer declares each open photo as a *child* of this root, which is
     * what makes the shell draw the curved tie from a viewer window back to
     * the explorer it came from. If the explorer instead re-declared itself
     * as the inspected item, the two windows would be one subject and the
     * desktop would have no edge to draw.
     */
    announceIdentity(itemId) {
      setIdentity(this.root, libraryIdentity());
    }
    /**
     * The bulk bar: appears over the status bar when several tiles are
     * selected, carrying the verbs that make sense for a set.
     */
    paintBulkBar(ids) {
      if (ids.length < 2) {
        this.bulkBar?.remove();
        this.bulkBar = null;
        return;
      }
      if (!this.bulkBar) {
        this.bulkBar = document.createElement("div");
        this.bulkBar.className = "atme-bulkbar";
        this.statusEl?.before(this.bulkBar);
      }
      const bar = this.bulkBar;
      bar.textContent = "";
      const label = document.createElement("span");
      label.className = "atme-bulkbar__label";
      label.textContent = `${ids.length} selected`;
      bar.appendChild(label);
      const encode = getConfig().conversion.encode;
      for (const format of ["webp", "avif"]) {
        if (!encode[format]) {
          continue;
        }
        bar.appendChild(
          buttonControl({
            label: `Convert to ${format.toUpperCase()}`,
            className: "atme-button atme-button--small",
            onClick: () => void this.bulkConvert(ids, format)
          })
        );
      }
      if (this.folders.length > 0) {
        bar.appendChild(
          selectControl({
            label: "File into folder",
            value: "",
            options: [
              { value: "", label: "File into…" },
              ...this.folders.map((folder) => ({ value: String(folder.id), label: folder.name }))
            ],
            hideLabel: true,
            onChange: (value) => {
              const folder = Number(value);
              if (folder > 0) {
                void fileIntoFolder(ids, folder).then(() => {
                  getShell()?.showToast?.({ message: `Filed ${ids.length} items` });
                  void this.refreshFolders();
                });
              }
            }
          })
        );
      }
      bar.appendChild(
        buttonControl({
          label: "Delete…",
          variant: "danger",
          className: "atme-button atme-button--small atme-button--danger",
          onClick: () => void this.bulkDelete(ids)
        })
      );
    }
    /**
     * Converts a selection, one file at a time, as copies.
     *
     * Sequential on purpose: a parallel burst of Imagick decodes is how a
     * shared host runs out of memory mid-batch.
     */
    async bulkConvert(ids, format) {
      let done = 0;
      let failed = 0;
      for (const id of ids) {
        this.paintStatus(`Converting ${done + failed + 1}/${ids.length} to ${format.toUpperCase()}…`);
        try {
          await convertMedia(id, { format });
          done += 1;
        } catch {
          failed += 1;
        }
      }
      getShell()?.showToast?.({
        message: `Converted ${done} of ${ids.length}${failed ? ` — ${failed} failed` : ""}`
      });
      void this.runQuery();
    }
    async bulkDelete(ids) {
      const shell = getShell();
      const message = `Delete ${ids.length} items permanently? There is no trash for media, and anything using them will be left empty.`;
      const confirmed = shell?.confirm ? await shell.confirm({ title: "Delete media", message, confirmLabel: "Delete all", danger: true }) : (
        // eslint-disable-next-line no-alert
        window.confirm(message)
      );
      if (!confirmed) {
        return;
      }
      let done = 0;
      for (const id of ids) {
        this.paintStatus(`Deleting ${done + 1}/${ids.length}…`);
        try {
          await deleteMedia(id, true);
          this.grid?.removeItems([id]);
          done += 1;
        } catch {
        }
      }
      this.total = Math.max(0, this.total - done);
      this.paintBulkBar([]);
      this.paintStatus();
      void this.refreshFolders();
    }
    /* ------------------------------------------------------------------ *
     * Status bar.
     * ------------------------------------------------------------------ */
    paintStatus(message) {
      if (!this.statusEl) {
        return;
      }
      if (message) {
        this.statusEl.textContent = message;
        return;
      }
      const selected = this.grid?.selectedIds().length ?? 0;
      const parts = [`${this.total} item${this.total === 1 ? "" : "s"}`];
      if (selected > 0) {
        parts.push(`${selected} selected`);
      }
      this.statusEl.textContent = parts.join(" · ");
    }
    destroy() {
      this.disposed = true;
      this.queryEpoch++;
      for (const teardown of this.teardowns.splice(0)) {
        teardown();
      }
      for (const off of this.folderDropOffs.splice(0)) {
        off();
      }
      this.quickLook?.destroy();
      this.quickLook = null;
      this.wizard?.destroy();
      this.wizard = null;
      this.bulkBar?.remove();
      this.bulkBar = null;
      this.grid?.destroy();
      this.grid = null;
      this.inspector?.destroy();
      this.inspector = null;
    }
  }
  async function confirmAndDelete(item) {
    const shell = getShell();
    const usage = await fetchUsage(item.id).catch(() => []);
    const message = usage.length > 0 ? `“${item.title || item.id}” is used in ${usage.length} place${usage.length === 1 ? "" : "s"}: ${usage.slice(0, 3).map((row) => row.title).join(", ")}${usage.length > 3 ? "…" : ""}. Deleting it will leave those spots empty.` : `Delete “${item.title || item.id}” permanently? There is no trash for media.`;
    const confirmed = shell?.confirm ? await shell.confirm({ title: "Delete media", message, confirmLabel: "Delete", danger: true }) : (
      // eslint-disable-next-line no-alert
      window.confirm(message)
    );
    if (!confirmed) {
      return false;
    }
    await deleteMedia(item.id);
    return true;
  }
  const ZOOM_STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  function nextZoomStop(scale, direction) {
    if (direction === 1) {
      return ZOOM_STOPS.find((stop) => stop > scale + 1e-3) ?? ZOOM_STOPS[ZOOM_STOPS.length - 1];
    }
    return [...ZOOM_STOPS].reverse().find((stop) => stop < scale - 1e-3) ?? ZOOM_STOPS[0];
  }
  function fitScale(mediaW, mediaH, stageW, stageH) {
    if (mediaW <= 0 || mediaH <= 0 || stageW <= 0 || stageH <= 0) {
      return 1;
    }
    return Math.min(1, stageW / mediaW, stageH / mediaH);
  }
  function mountViewer(root, params = {}) {
    const app = new ViewerApp(root);
    const teardowns = [() => app.destroy()];
    const retarget = (next) => {
      const id = Number(next.mediaId ?? 0);
      if (Number.isSafeInteger(id) && id > 0) {
        void app.show(id);
      }
    };
    retarget(params);
    const shell = getShell();
    if (shell?.subscribe) {
      teardowns.push(
        shell.subscribe(VIEW_TOPIC, (payload) => {
          const id = Number(payload?.id);
          if (id > 0) {
            void app.show(id);
          }
        })
      );
    }
    teardowns.push(
      onMediaChanged((ids) => {
        if (app.currentId() > 0 && ids.includes(app.currentId())) {
          void app.show(app.currentId(), true);
        }
      })
    );
    return Object.assign(() => {
      for (const teardown of teardowns.splice(0)) {
        teardown();
      }
    }, { retarget });
  }
  class ViewerApp {
    constructor(root) {
      this.inspector = null;
      this.item = null;
      this.neighbors = { prev: null, next: null };
      this.epoch = 0;
      this.zoom = "fit";
      this.panX = 0;
      this.panY = 0;
      this.mediaW = 0;
      this.mediaH = 0;
      this.mediaEl = null;
      this.zoomLabel = null;
      this.drawerAuto = true;
      this.navPrev = null;
      this.navNext = null;
      this.resizeObserver = null;
      this.keyHandler = null;
      this.root = root;
      root.classList.add("atme-viewer");
      this.toolbar = document.createElement("div");
      this.toolbar.className = "atme-viewer__toolbar";
      this.stage = document.createElement("div");
      this.stage.className = "atme-viewer__stage";
      this.caption = document.createElement("div");
      this.caption.className = "atme-viewer__caption";
      this.drawer = document.createElement("aside");
      this.drawer.className = "atme-viewer__drawer";
      this.drawer.hidden = true;
      const main = document.createElement("div");
      main.className = "atme-viewer__main";
      main.appendChild(this.toolbar);
      main.appendChild(this.stage);
      main.appendChild(this.caption);
      root.appendChild(main);
      root.appendChild(this.drawer);
      this.buildToolbar();
      this.buildStageNav();
      this.wireStage();
      this.wireKeyboard();
      this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.applyZoom()) : null;
      this.resizeObserver?.observe(this.stage);
    }
    currentId() {
      return this.item?.id ?? 0;
    }
    /* ------------------------------------------------------------------ *
     * Loading and painting.
     * ------------------------------------------------------------------ */
    async show(id, keepZoom = false) {
      const thisEpoch = ++this.epoch;
      try {
        const item = await fetchMediaItem(id);
        if (thisEpoch !== this.epoch) {
          return;
        }
        this.item = item;
        if (!keepZoom) {
          this.zoom = "fit";
          this.panX = 0;
          this.panY = 0;
        }
        this.paintStage();
        this.paintCaption();
        this.announce();
        if (this.drawerAuto && this.drawer.hidden) {
          this.toggleDrawer();
        }
        this.root.focus({ preventScroll: true });
        if (!this.drawer.hidden) {
          this.inspector?.show(item);
        }
        getShell()?.windowManager?.getById?.(VIEWER_WINDOW_ID)?.setTitle?.(
          item.title || `Media #${item.id}`
        );
        this.neighbors = { prev: null, next: null };
        this.paintNav();
        void fetchNeighbors(item).then((neighbors) => {
          if (thisEpoch === this.epoch) {
            this.neighbors = neighbors;
            this.paintNav();
          }
        });
      } catch {
        if (thisEpoch === this.epoch) {
          this.stage.textContent = "";
          const gone = document.createElement("div");
          gone.className = "atme-viewer__gone";
          gone.textContent = "This media item is gone.";
          this.stage.appendChild(gone);
        }
      }
    }
    paintStage() {
      const item = this.item;
      if (!item) {
        return;
      }
      this.stage.querySelectorAll(".atme-viewer__media, .atme-viewer__gone").forEach((el) => el.remove());
      this.mediaEl = null;
      this.mediaW = 0;
      this.mediaH = 0;
      if ("image" === item.kind) {
        const img = document.createElement("img");
        img.className = "atme-viewer__media";
        img.src = item.url;
        img.alt = item.alt;
        img.draggable = false;
        img.addEventListener("load", () => {
          this.mediaW = img.naturalWidth;
          this.mediaH = img.naturalHeight;
          this.applyZoom();
          this.paintCaption();
        });
        this.stage.appendChild(img);
        this.mediaEl = img;
      } else if ("video" === item.kind) {
        const video = document.createElement("video");
        video.className = "atme-viewer__media atme-viewer__media--intrinsic";
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        this.stage.appendChild(video);
        this.mediaEl = video;
      } else if ("audio" === item.kind) {
        const audio = document.createElement("audio");
        audio.className = "atme-viewer__media atme-viewer__media--intrinsic";
        audio.src = item.url;
        audio.controls = true;
        this.stage.appendChild(audio);
        this.mediaEl = audio;
      } else if ("application/pdf" === item.mime) {
        const frame = document.createElement("iframe");
        frame.className = "atme-viewer__media atme-viewer__media--frame";
        frame.src = item.url;
        frame.title = item.title;
        this.stage.appendChild(frame);
        this.mediaEl = frame;
      } else {
        const chip = document.createElement("div");
        chip.className = "atme-viewer__media atme-viewer__media--intrinsic atme-viewer__filechip";
        const icon = document.createElement("span");
        icon.className = "dashicons dashicons-media-default";
        chip.appendChild(icon);
        const name = document.createElement("span");
        name.textContent = item.url.split("/").pop() ?? item.title;
        chip.appendChild(name);
        this.stage.appendChild(chip);
        this.mediaEl = chip;
      }
      this.applyZoom();
    }
    /** Applies the current zoom/pan to an image; other kinds size naturally. */
    applyZoom() {
      const img = this.mediaEl;
      if (!img || !this.item || "image" !== this.item.kind || this.mediaW === 0) {
        this.zoomLabel && (this.zoomLabel.textContent = "");
        return;
      }
      const stageW = this.stage.clientWidth - 24;
      const stageH = this.stage.clientHeight - 24;
      const scale = "fit" === this.zoom ? fitScale(this.mediaW, this.mediaH, stageW, stageH) : this.zoom;
      if ("fit" === this.zoom) {
        this.panX = 0;
        this.panY = 0;
      }
      img.style.width = `${this.mediaW * scale}px`;
      img.style.height = `${this.mediaH * scale}px`;
      img.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
      img.classList.toggle("is-pannable", "fit" !== this.zoom);
      if (this.zoomLabel) {
        this.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      }
    }
    currentScale() {
      if ("fit" !== this.zoom) {
        return this.zoom;
      }
      return fitScale(this.mediaW, this.mediaH, this.stage.clientWidth - 24, this.stage.clientHeight - 24);
    }
    paintCaption() {
      const item = this.item;
      if (!item) {
        this.caption.textContent = "";
        return;
      }
      const parts = [item.title || `#${item.id}`];
      if (this.mediaW > 0) {
        parts.push(`${this.mediaW} × ${this.mediaH}`);
      }
      parts.push(item.mime);
      this.caption.textContent = parts.join("  ·  ");
    }
    /** The viewer window joins the photo's relations group. */
    announce() {
      const item = this.item;
      if (!item) {
        return;
      }
      const libraryRoot = { type: EXPLORER_TYPE, id: "library" };
      fetchUsage(item.id).then((usage) => {
        if (this.item?.id === item.id) {
          setIdentity(this.root, mediaIdentity(item, usage, getConfig().adminUrl, libraryRoot));
        }
      }).catch(() => setIdentity(this.root, mediaIdentity(item, [], getConfig().adminUrl, libraryRoot)));
    }
    /* ------------------------------------------------------------------ *
     * Chrome.
     * ------------------------------------------------------------------ */
    buildToolbar() {
      const zoomOut = buttonControl({
        label: "−",
        className: "atme-button atme-button--small",
        onClick: () => this.setZoom(nextZoomStop(this.currentScale(), -1))
      });
      const zoomIn = buttonControl({
        label: "+",
        className: "atme-button atme-button--small",
        onClick: () => this.setZoom(nextZoomStop(this.currentScale(), 1))
      });
      const fit = buttonControl({
        label: "Fit",
        className: "atme-button atme-button--small",
        onClick: () => this.setZoom("fit")
      });
      const oneToOne = buttonControl({
        label: "1:1",
        className: "atme-button atme-button--small",
        onClick: () => this.setZoom(1)
      });
      this.zoomLabel = document.createElement("span");
      this.zoomLabel.className = "atme-viewer__zoomlabel";
      const spacer = document.createElement("div");
      spacer.className = "atme-viewer__spacer";
      const info = buttonControl({
        label: "ⓘ Info",
        className: "atme-button atme-button--small",
        onClick: () => this.toggleDrawer()
      });
      const openLibrary = buttonControl({
        label: "Show in library",
        className: "atme-button atme-button--small",
        onClick: () => {
          const shell = getShell();
          const id = this.item?.id ?? 0;
          if (id > 0) {
            shell?.openWindow?.("allterrain-media-explorer", { source: "atme-viewer", params: { mediaId: id } });
            if (!shell?.getWindowConfig?.("allterrain-media-explorer")?.osApp) {
              shell?.broadcast?.("atme.reveal", { id });
            }
          }
        }
      });
      for (const el of [zoomOut, this.zoomLabel, zoomIn, fit, oneToOne, spacer, openLibrary, info]) {
        this.toolbar.appendChild(el);
      }
    }
    buildStageNav() {
      const make = (direction) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `atme-viewer__nav atme-viewer__nav--${direction === -1 ? "prev" : "next"}`;
        button.setAttribute("aria-label", direction === -1 ? "Newer item" : "Older item");
        button.textContent = direction === -1 ? "‹" : "›";
        button.addEventListener("click", () => this.step(direction));
        this.stage.appendChild(button);
        return button;
      };
      this.navPrev = make(-1);
      this.navNext = make(1);
      this.paintNav();
    }
    paintNav() {
      this.navPrev?.toggleAttribute("hidden", !this.neighbors.prev);
      this.navNext?.toggleAttribute("hidden", !this.neighbors.next);
    }
    step(direction) {
      const target = direction === -1 ? this.neighbors.prev : this.neighbors.next;
      if (target) {
        void this.show(target.id);
      }
    }
    setZoom(zoom) {
      this.zoom = zoom;
      this.applyZoom();
    }
    toggleDrawer() {
      if (this.drawer.hidden) {
        if (!this.inspector) {
          this.inspector = mountInspector(this.drawer, {
            onChanged: () => {
              if (this.item) {
                void this.show(this.item.id, true);
              }
            },
            onDeleted: () => {
              const next = this.neighbors.next ?? this.neighbors.prev;
              if (next) {
                void this.show(next.id);
              } else {
                this.stage.textContent = "";
                this.caption.textContent = "";
              }
              this.drawer.hidden = true;
            },
            onClose: () => {
              this.drawer.hidden = true;
            }
          });
        }
        this.drawer.hidden = false;
        if (this.item) {
          this.inspector.show(this.item);
        }
      } else {
        this.drawer.hidden = true;
        this.drawerAuto = false;
      }
    }
    /* ------------------------------------------------------------------ *
     * Input.
     * ------------------------------------------------------------------ */
    wireStage() {
      this.stage.addEventListener(
        "wheel",
        (event) => {
          if (!this.item || "image" !== this.item.kind || this.mediaW === 0) {
            return;
          }
          event.preventDefault();
          const before = this.currentScale();
          const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 2e-3));
          const scale = Math.min(8, Math.max(0.05, before * factor));
          this.zoom = scale;
          this.applyZoom();
        },
        { passive: false }
      );
      let panning = false;
      let startX = 0;
      let startY = 0;
      let originX = 0;
      let originY = 0;
      this.stage.addEventListener("pointerdown", (event) => {
        this.root.focus({ preventScroll: true });
        if ("fit" === this.zoom || !this.mediaEl || event.button !== 0) {
          return;
        }
        panning = true;
        startX = event.clientX;
        startY = event.clientY;
        originX = this.panX;
        originY = this.panY;
        this.stage.setPointerCapture(event.pointerId);
      });
      this.stage.addEventListener("pointermove", (event) => {
        if (panning) {
          this.panX = originX + (event.clientX - startX);
          this.panY = originY + (event.clientY - startY);
          this.applyZoom();
        }
      });
      const endPan = () => {
        panning = false;
      };
      this.stage.addEventListener("pointerup", endPan);
      this.stage.addEventListener("pointercancel", endPan);
      this.stage.addEventListener("dblclick", (event) => {
        if (event.target.closest(".atme-viewer__nav")) {
          return;
        }
        this.setZoom("fit" === this.zoom ? 1 : "fit");
      });
    }
    wireKeyboard() {
      this.root.tabIndex = 0;
      this.keyHandler = (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
          return;
        }
        const target = event.target;
        if (!target || !this.root.contains(target)) {
          return;
        }
        if (target.closest(".atme-viewer__drawer")) {
          return;
        }
        const claim = () => {
          event.preventDefault();
          event.stopPropagation();
        };
        switch (event.key) {
          case "ArrowLeft":
            claim();
            this.step(-1);
            break;
          case "ArrowRight":
            claim();
            this.step(1);
            break;
          case "ArrowUp":
          case "ArrowDown":
            claim();
            break;
          case "+":
          case "=":
            claim();
            this.setZoom(nextZoomStop(this.currentScale(), 1));
            break;
          case "-":
            claim();
            this.setZoom(nextZoomStop(this.currentScale(), -1));
            break;
          case "0":
            claim();
            this.setZoom("fit");
            break;
          case "1":
            claim();
            this.setZoom(1);
            break;
          case "i":
          case "I":
            claim();
            this.toggleDrawer();
            break;
        }
      };
      window.addEventListener("keydown", this.keyHandler, true);
    }
    destroy() {
      this.epoch++;
      if (this.keyHandler) {
        window.removeEventListener("keydown", this.keyHandler, true);
        this.keyHandler = null;
      }
      this.resizeObserver?.disconnect();
      this.inspector?.destroy();
      this.inspector = null;
      this.root.textContent = "";
    }
  }
  const MOUNTED = "atmeMounted";
  function mountOnce(root, params = {}) {
    if (root.dataset[MOUNTED] === "1") {
      return () => void 0;
    }
    root.dataset[MOUNTED] = "1";
    const teardown = mountExplorer(root, params);
    return () => {
      delete root.dataset[MOUNTED];
      teardown();
    };
  }
  function registerNativeWindow() {
    if (getShell()?.getWindowConfig?.("allterrain-media-explorer")?.osApp) {
      return;
    }
    const w2 = window;
    w2.openStationNativeWindows = w2.openStationNativeWindows ?? {};
    w2.openStationNativeWindows["allterrain-media-explorer"] = (body, ctx) => {
      const root = body.querySelector("[data-atme-root]") ?? body;
      return mountOnce(root, ctx?.params);
    };
    w2.openStationNativeWindows["atme-viewer"] = (body, ctx) => {
      const root = body.querySelector("[data-atme-viewer-root]") ?? body;
      return mountViewer(root, ctx?.params ?? {});
    };
  }
  registerNativeWindow();
  const pending = window;
  (pending.openStationAppsPending ?? (pending.openStationAppsPending = [])).push(({ defineApp, html }) => {
    for (const id of ["allterrain-media-explorer", "atme-viewer"]) {
      const ui = (ctx) => ctx.ui(() => ({
        app: null,
        revision: -1
      }));
      defineApp(id, {
        placeholder: () => ({}),
        // The media canvas owns its children; same-template renders keep them.
        view: () => html`<div class="atme-app-host" os-preserve></div>`,
        mounted: (ctx) => {
          const host = ctx.root.querySelector(".atme-app-host");
          const params = ctx.loading ? {} : ctx.state;
          if (id === "atme-viewer") {
            host.classList.add("atme-viewer");
            ui(ctx).app = mountViewer(host, params);
          } else {
            host.classList.add("atme");
            host.innerHTML = '<div class="atme__frame" data-atme-frame><aside class="atme__sidebar" data-atme-sidebar></aside><main class="atme__main" data-atme-main></main><aside class="atme__inspector" data-atme-inspector hidden></aside></div>';
            ui(ctx).app = mountExplorer(host, params);
          }
          ui(ctx).revision = ctx.loading ? -1 : ctx.state.revision;
          return () => {
            ui(ctx).app?.();
            ui(ctx).app = null;
          };
        },
        updated: (ctx) => {
          const local = ui(ctx);
          if (!ctx.loading && local.app && local.revision !== ctx.state.revision) {
            local.revision = ctx.state.revision;
            local.app.retarget(ctx.state);
          }
        }
      });
    }
  });
})();
