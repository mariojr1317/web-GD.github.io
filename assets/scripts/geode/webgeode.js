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

  const api = {
    version: "0.1.0-web",

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
