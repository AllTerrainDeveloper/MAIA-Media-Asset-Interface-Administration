(function() {
  "use strict";
  `allterrain-media-explorer/${Math.random().toString(36).slice(2, 10)}`;
  function getShell() {
    const wp = window.wp;
    return wp?.os ?? null;
  }
  const VIEWER_WINDOW_ID = "atme-viewer";
  const VIEW_TOPIC = "atme.view";
  function openViewer(id) {
    const shell2 = getShell();
    if (!shell2 || id <= 0) {
      return;
    }
    shell2.openWindow?.(VIEWER_WINDOW_ID, {
      source: "allterrain-media-explorer",
      params: { mediaId: id }
    });
    if (!shell2.getWindowConfig?.(VIEWER_WINDOW_ID)?.osApp) {
      shell2.broadcast?.(VIEW_TOPIC, { id });
    }
  }
  const WINDOW_ID = "allterrain-media-explorer";
  function openAndReveal(id) {
    const shell2 = getShell();
    if (!shell2) {
      return;
    }
    shell2.openWindow?.(WINDOW_ID, { source: "allterrain-media-explorer", params: { mediaId: id } });
    if (id > 0 && !shell2.getWindowConfig?.(WINDOW_ID)?.osApp) {
      shell2.broadcast?.("atme.reveal", { id });
    }
  }
  function registerFileOpener() {
    const shell2 = getShell();
    shell2?.files?.registerOpener?.({
      id: "atme-viewer",
      label: "MAIA Viewer",
      types: ["attachment"],
      sort: 5,
      // Deliberately NOT default-flagged: the "(default)" suffix in the
      // Preferences dropdown marks the opener WordPress ships, and that
      // honour stays with the stock media editor. MAIA becomes the
      // *effective* opener through the association below — the same
      // mechanism a user's own pick uses, shown as the selected row.
      isDefault: false,
      handler: {
        kind: "js",
        open: (file) => openViewer(Number(file.ref()))
      }
    });
    const hooks = window.wp?.hooks;
    hooks?.addFilter("os.files.resolve-opener", "allterrain-media-explorer", (resolved, type) => {
      if ("attachment" !== type) {
        return resolved;
      }
      const stored = getShell()?.files?.getUserAssociations?.() ?? {};
      if (stored["attachment"]) {
        return resolved;
      }
      return getShell()?.files?.getOpener?.("atme-viewer") ?? resolved;
    });
  }
  function registerIconDropHandler() {
    const files = getShell()?.files;
    if (!files?.registerTilePayloadHandler) {
      return;
    }
    const isOurIcon = (ctx) => ctx?.placement?.file?.ref === WINDOW_ID;
    files.registerTilePayloadHandler("shortcut", {
      appliesTo: isOurIcon,
      accept: (data) => data?.kind === "attachment",
      acceptLabel: "Reveal in MAIA",
      onDrop: (session) => openAndReveal(Number(session.payload.data?.ref ?? 0))
    });
    files.registerTilePayloadHandler("desktop-file", {
      appliesTo: isOurIcon,
      accept: (data) => {
        const placement = data?.placement;
        return placement?.file?.type === "attachment";
      },
      acceptLabel: "Reveal in MAIA",
      onDrop: (session) => {
        const placement = session.payload.data?.placement;
        openAndReveal(Number(placement?.file?.ref ?? 0));
      }
    });
  }
  function registerCommands() {
    const shell2 = getShell();
    if (!shell2?.registerCommand) {
      return;
    }
    shell2.registerCommand({
      slug: "allterrain-media-explorer",
      label: "MAIA: open the media library",
      description: "Browse, organize and convert everything in the media library.",
      icon: "dashicons-format-gallery",
      run: () => {
        openAndReveal(0);
        return "Opening MAIA…";
      }
    });
    shell2.registerCommand({
      slug: "allterrain-media-explorer-wizard",
      label: "MAIA: start the optimization wizard",
      description: "Scan the library for oversized images, legacy formats, missing alt text and duplicates.",
      icon: "dashicons-superhero",
      run: () => {
        getShell()?.openWindow?.(WINDOW_ID, { params: { wizard: true } });
        if (!getShell()?.getWindowConfig?.(WINDOW_ID)?.osApp) {
          getShell()?.broadcast?.("atme.wizard", {});
        }
        return "Opening the optimization wizard…";
      }
    });
  }
  function wireExplorerAction() {
    const hooks = window.wp?.hooks;
    if (!hooks) {
      return;
    }
    hooks.addFilter("os.my-wordpress.preview-actions", "allterrain-media-explorer", (actions) => {
      if (!Array.isArray(actions)) {
        return actions;
      }
      return actions.map(
        (action) => action?.id === "atme-reveal" ? {
          ...action,
          onSelect: (context) => openAndReveal(Number(context?.mediaId ?? context?.postId ?? 0))
        } : action
      );
    });
  }
  function boot() {
    registerFileOpener();
    registerIconDropHandler();
    registerCommands();
    wireExplorerAction();
  }
  const shell = getShell();
  if (shell?.ready) {
    shell.ready(boot);
  } else {
    document.addEventListener("os-init", boot, { once: true });
  }
})();
