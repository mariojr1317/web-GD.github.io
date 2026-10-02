/**
 * WebGeode compatibility layer
 * 
 * This is a browser-side Geode-inspired API for Web Dashers.
 * It does NOT load native .geode binaries. It provides a stable
 * mod interface so Web Dashers can expose hooks/settings/events
 * without coupling mods to the internal Phaser implementation.
 */
(() => {
  "use strict";

  const mods = new Map();
  const hooks = new Map();
  const events = new Map();
  const settings = new Map();

  const list = (map, key) => {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  };


  const decodeText = bytes => new TextDecoder().decode(bytes);

  const readU16 = (v, o) => v.getUint16(o, true);
  const readU32 = (v, o) => v.getUint32(o, true);

  async function unzipGeode(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (readU32(view, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Invalid .geode: ZIP directory not found");

    const count = readU16(view, eocd + 10);
    const centralOffset = readU32(view, eocd + 16);
    let offset = centralOffset;
    const files = new Map();

    for (let i = 0; i < count; i++) {
      if (readU32(view, offset) !== 0x02014b50) throw new Error("Invalid .geode: bad ZIP entry");
      const method = readU16(view, offset + 10);
      const compressedSize = readU32(view, offset + 20);
      const nameLength = readU16(view, offset + 28);
      const extraLength = readU16(view, offset + 30);
      const commentLength = readU16(view, offset + 32);
      const localOffset = readU32(view, offset + 42);
      const name = decodeText(bytes.subarray(offset + 46, offset + 46 + nameLength));

      const localNameLength = readU16(view, localOffset + 26);
      const localExtraLength = readU16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      let data;
      if (method === 0) {
        data = compressed;
      } else if (method === 8) {
        if (typeof DecompressionStream !== "function") {
          throw new Error("This browser does not support ZIP/DEFLATE decompression");
        }
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        throw new Error(`Unsupported ZIP compression method: ${method}`);
      }
      files.set(name, data);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  async function importGeodeFile(file, api) {
    if (!(file instanceof File)) throw new TypeError("WebGeode.importGeode requires a .geode file");
    if (!file.name.toLowerCase().endsWith(".geode")) throw new Error("Only .geode files are supported");

    const files = await unzipGeode(await file.arrayBuffer());
    const manifestBytes = files.get("mod.json") || files.get("mod.jsonc");
    if (!manifestBytes) throw new Error("This .geode does not contain mod.json");

    let manifest;
    try {
      manifest = JSON.parse(decodeText(manifestBytes).replace(/\/\/.*$/gm, ""));
    } catch {
      throw new Error("The .geode mod.json could not be parsed");
    }

    const id = manifest.id || manifest.gd?.id || manifest.name;
    if (!id) throw new Error("mod.json does not define a mod id");

    const nativeFiles = [...files.keys()].filter(name => /\.(dll|so|dylib|exe)$/i.test(name));
    const scriptCandidates = [
      manifest.entrypoint,
      manifest.main,
      "scripts/main.js",
      "scripts/mod.js",
      "mod.js"
    ].filter(Boolean);
    const entry = scriptCandidates.find(name => files.has(name));

    const mod = api.registerMod({
      id: String(id),
      name: manifest.name || String(id),
      version: manifest.version || "0.0.0",
      author: manifest.author || manifest.developer || "Unknown"
    });

    mod.package = {
      fileName: file.name,
      files: [...files.keys()],
      manifest,
      nativeOnly: !entry,
      nativeFiles
    };

    if (entry) {
      const source = decodeText(files.get(entry));
      const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      try {
        await import(blobUrl);
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      }
      mod.package.entrypoint = entry;
      mod.package.loaded = true;
    } else {
      mod.package.loaded = false;
      mod.package.reason = nativeFiles.length
        ? "Native code is not executable in the browser"
        : "No JavaScript/WebAssembly entrypoint was found";
    }

    api.emit("mod.imported", mod);
    return mod;
  }
\n  const api = {
    version: "0.2.0-web",\n\n    async importGeode(file) { return importGeodeFile(file, api); },

    registerMod(mod) {
      if (!mod || typeof mod.id !== "string" || !mod.id.trim()) {
        throw new TypeError("WebGeode.registerMod requires a mod id");
      }
      if (mods.has(mod.id)) {
        throw new Error(`WebGeode mod already registered: ${mod.id}`);
      }

      const instance = {
        id: mod.id,
        name: mod.name || mod.id,
        version: mod.version || "0.0.0",
        author: mod.author || "Unknown",
        enabled: mod.enabled !== false
      };

      mods.set(instance.id, instance);

      if (typeof mod.onLoad === "function") {
        try {
          mod.onLoad(api);
        } catch (error) {
          console.error(`[WebGeode] Failed to load mod ${instance.id}`, error);
        }
      }

      api.emit("mod.loaded", instance);
      return instance;
    },

    getMod(id) {
      return mods.get(id) || null;
    },

    getMods() {
      return [...mods.values()];
    },

    on(event, callback) {
      if (typeof callback !== "function") {
        throw new TypeError("WebGeode.on requires a function");
      }
      const listeners = list(events, event);
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index !== -1) listeners.splice(index, 1);
      };
    },

    emit(event, payload) {
      const listeners = events.get(event);
      if (!listeners) return;
      for (const callback of [...listeners]) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[WebGeode] Event error: ${event}`, error);
        }
      }
    },

    hook(name, callback, priority = 0) {
      if (typeof callback !== "function") {
        throw new TypeError("WebGeode.hook requires a function");
      }
      const entries = list(hooks, name);
      const entry = { callback, priority: Number(priority) || 0 };
      entries.push(entry);
      entries.sort((a, b) => b.priority - a.priority);

      return () => {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      };
    },

    runHook(name, payload) {
      const entries = hooks.get(name);
      if (!entries) return payload;

      let value = payload;
      for (const entry of [...entries]) {
        try {
          const result = entry.callback(value);
          if (result !== undefined) value = result;
        } catch (error) {
          console.error(`[WebGeode] Hook error: ${name}`, error);
        }
      }
      return value;
    },

    defineSetting(id, definition) {
      if (!id || settings.has(id)) return false;
      settings.set(id, {
        type: definition?.type || "boolean",
        default: definition?.default,
        value: definition?.default,
        name: definition?.name || id,
        description: definition?.description || ""
      });
      return true;
    },

    getSetting(id) {
      const setting = settings.get(id);
      return setting ? setting.value : undefined;
    },

    setSetting(id, value) {
      const setting = settings.get(id);
      if (!setting) return false;
      const oldValue = setting.value;
      setting.value = value;
      api.emit("setting.changed", { id, oldValue, value });
      return true;
    },

    getSettings() {
      return [...settings.entries()].map(([id, value]) => ({ id, ...value }));
    }
  };

  Object.defineProperty(window, "WebGeode", {
    value: Object.freeze(api),
    writable: false,
    configurable: false
  });

  window.dispatchEvent(new CustomEvent("webgeode:ready", {
    detail: { version: api.version }
  }));
})();
