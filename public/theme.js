(() => {
  "use strict";

  const backgroundKey = "nutc-portal-background-v1";
  const paletteKey = "nutc-portal-palette-v1";
  const colorSchemeKey = "nutc-portal-color-scheme-v1";
  const colorfulnessKey = "nutc-portal-theme-colorfulness-v1";
  const brightnessKey = "nutc-portal-theme-brightness-v1";
  const defaults = ["#f0a8c8", "#e8b86d", "#51314a", "#f07178", "#151018"];
  const defaultSettings = {
    colorScheme: "tonalSpot",
    colorfulness: 1,
    brightness: 1,
  };
  const colorSchemes = {
    content: { name: "Content", chroma: 1, hueOffsets: [0, 0, 0] },
    expressive: { name: "Expressive", chroma: 1.15, hueOffsets: [0, 75, 35] },
    fidelity: { name: "Fidelity", chroma: 1.05, hueOffsets: [0, 0, 0] },
    monochrome: { name: "Monochrome", chroma: 0, hueOffsets: [0, 0, 0] },
    neutral: { name: "Neutral", chroma: 0.16, hueOffsets: [0, 0, 0], chromaLimit: 0.035 },
    tonalSpot: { name: "Tonal Spot", chroma: 0.72, hueOffsets: [0, 0, 0], chromaLimit: 0.14 },
    vibrant: { name: "Vibrant", chroma: 1.5, hueOffsets: [0, 0, 0], chromaFloor: 0.12 },
    rainbow: { name: "Rainbow", chroma: 1.2, hueOffsets: [0, 110, 220], chromaFloor: 0.1 },
    fruitSalad: { name: "Fruit Salad", chroma: 1.25, hueOffsets: [-50, 50, 0], chromaFloor: 0.09 },
  };
  let currentSourcePalette = [...defaults];
  let currentPalette = [...defaults];
  let currentBackground = "";
  let currentSettings = { ...defaultSettings };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function hexToRgb(hex) {
    const value = String(hex || "").replace("#", "");
    const normalized =
      value.length === 3
        ? value.split("").map((char) => char + char).join("")
        : value.padEnd(6, "0").slice(0, 6);

    return {
      r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
      g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
      b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
    };
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((value) =>
          Math.round(clamp(Number(value) || 0, 0, 255))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }

  function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function srgbToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  }

  function rgbToOklab(r, g, b) {
    const red = srgbToLinear(r);
    const green = srgbToLinear(g);
    const blue = srgbToLinear(b);
    const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
    const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
    const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);
    const lightness =
      0.2104542553 * lRoot +
      0.793617785 * mRoot -
      0.0040720468 * sRoot;
    const a =
      1.9779984951 * lRoot -
      2.428592205 * mRoot +
      0.4505937099 * sRoot;
    const labB =
      0.0259040371 * lRoot +
      0.7827717662 * mRoot -
      0.808675766 * sRoot;
    const chroma = Math.hypot(a, labB);
    const hue = (Math.atan2(labB, a) * 180) / Math.PI;

    return {
      lightness,
      a,
      b: labB,
      chroma,
      hue: (hue + 360) % 360,
    };
  }

  function linearToSrgb(channel) {
    const value =
      channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055;
    return clamp(value * 255, 0, 255);
  }

  function oklchToHex(lightness, chroma, hue) {
    const radians = (hue * Math.PI) / 180;
    const a = chroma * Math.cos(radians);
    const labB = chroma * Math.sin(radians);
    const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * labB;
    const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * labB;
    const sRoot = lightness - 0.0894841775 * a - 1.291485548 * labB;
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;

    return rgbToHex(
      linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    );
  }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (
      0.2126 * srgbToLinear(r) +
      0.7152 * srgbToLinear(g) +
      0.0722 * srgbToLinear(b)
    );
  }

  function contrastRatio(first, second) {
    const a = relativeLuminance(first);
    const b = relativeLuminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function readableText(background) {
    return contrastRatio("#17121b", background) >= 4.5
      ? "#17121b"
      : "#fff8fc";
  }

  function ensureColorContrast(
    color,
    background = "#17121b",
    minimumRatio = 4.5,
  ) {
    if (contrastRatio(color, background) >= minimumRatio) return color;

    const { r, g, b } = hexToRgb(color);
    const lab = rgbToOklab(r, g, b);

    for (
      let lightness = lab.lightness + 0.015;
      lightness <= 0.94;
      lightness += 0.015
    ) {
      const candidate = oklchToHex(lightness, lab.chroma, lab.hue);
      if (contrastRatio(candidate, background) >= minimumRatio) {
        return candidate;
      }
    }

    return color;
  }

  function colorDistance(first, second) {
    return Math.hypot(
      first.lightness - second.lightness,
      first.a - second.a,
      first.b - second.b,
    );
  }

  function hueDistance(first, second) {
    const difference = Math.abs(first - second);
    return Math.min(difference, 360 - difference);
  }

  function mix(first, second, amount) {
    const a = hexToRgb(first);
    const b = hexToRgb(second);
    return rgbToHex(
      a.r * (1 - amount) + b.r * amount,
      a.g * (1 - amount) + b.g * amount,
      a.b * (1 - amount) + b.b * amount,
    );
  }

  function normalizeColorScheme(value) {
    return Object.hasOwn(colorSchemes, value)
      ? value
      : defaultSettings.colorScheme;
  }

  function normalizeThemeFactor(value) {
    return clamp(Number(value) || 1, 0.5, 1.5);
  }

  function normalizeSettings(settings = {}) {
    return {
      colorScheme: normalizeColorScheme(settings.colorScheme),
      colorfulness: normalizeThemeFactor(settings.colorfulness),
      brightness: normalizeThemeFactor(settings.brightness),
    };
  }

  function paletteForScheme(
    source,
    settings = currentSettings,
  ) {
    const normalized = normalizeSettings(settings);
    const mode = colorSchemes[normalized.colorScheme];
    const palette =
      Array.isArray(source) && source.length >= 5 ? source : defaults;
    const chromaFactor = normalized.colorfulness;
    const lightnessOffset = (normalized.brightness - 1) * 0.18;

    const generated = palette.map((color, index) => {
      if (index === 3) return color;

      const { r, g, b } = hexToRgb(color);
      const lab = rgbToOklab(r, g, b);
      const roleIndex = Math.min(index, 2);
      const hue =
        (lab.hue + mode.hueOffsets[roleIndex] + 360) % 360;
      let chroma = lab.chroma * mode.chroma * chromaFactor;

      if (mode.chromaFloor && lab.chroma >= 0.025) {
        chroma = Math.max(
          chroma,
          mode.chromaFloor * chromaFactor,
        );
      }

      if (mode.chromaLimit !== undefined) {
        chroma = Math.min(
          chroma,
          mode.chromaLimit * chromaFactor,
        );
      }

      if (index === 4) chroma *= 0.55;

      return oklchToHex(
        clamp(lab.lightness + lightnessOffset, 0.2, 0.94),
        chroma,
        hue,
      );
    });

    generated[0] = ensureColorContrast(
      generated[0],
      "#1a141f",
      4.5,
    );
    generated[1] = ensureColorContrast(generated[1]);
    return generated;
  }

  function extractPalette(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const size = 96;
        const scale = Math.min(1, size / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pixels = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const buckets = new Map();
        let sampledPixels = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];
          if (a < 160) continue;

          const key = `${Math.floor(r / 24)},${Math.floor(g / 24)},${Math.floor(
            b / 24,
          )}`;
          const current = buckets.get(key) || {
            r: 0,
            g: 0,
            b: 0,
            count: 0,
          };

          current.r += r;
          current.g += g;
          current.b += b;
          current.count += 1;
          buckets.set(key, current);
          sampledPixels += 1;
        }

        if (!sampledPixels || !buckets.size) {
          resolve([...defaults]);
          return;
        }

        const candidates = [...buckets.values()]
          .map((bucket) => {
            const r = bucket.r / bucket.count;
            const g = bucket.g / bucket.count;
            const b = bucket.b / bucket.count;

            return {
              color: rgbToHex(r, g, b),
              population: bucket.count / sampledPixels,
              ...rgbToOklab(r, g, b),
            };
          })
          .filter((candidate) => candidate.population >= 0.0005)
          .sort((first, second) => second.population - first.population);

        const chromatic = candidates.filter(
          (candidate) =>
            candidate.chroma >= 0.035 &&
            candidate.lightness >= 0.18 &&
            candidate.lightness <= 0.93,
        );

        function choose(
          pool,
          score,
          selected = [],
          minimumDistance = 0.085,
        ) {
          return pool
            .filter((candidate) =>
              selected.every(
                (color) =>
                  colorDistance(candidate, color) >= minimumDistance,
              ),
            )
            .map((candidate) => ({
              candidate,
              score: score(candidate),
            }))
            .sort((first, second) => second.score - first.score)[0]?.candidate;
        }

        let primary = choose(
          chromatic.filter(
            (candidate) =>
              candidate.lightness >= 0.4 &&
              candidate.lightness <= 0.86,
          ),
          (candidate) => {
            const lightnessFit =
              1 - Math.min(0.6, Math.abs(candidate.lightness - 0.66));
            return (
              candidate.chroma ** 1.45 *
              candidate.population ** 0.22 *
              lightnessFit
            );
          },
        );

        if (!primary) {
          primary = choose(
            candidates.filter(
              (candidate) =>
                candidate.lightness >= 0.3 &&
                candidate.lightness <= 0.88,
            ),
            (candidate) =>
              candidate.population * (0.25 + candidate.chroma),
          );
        }

        let accent =
          primary &&
          choose(
            chromatic.filter(
              (candidate) =>
                candidate.lightness >= 0.3 &&
                candidate.lightness <= 0.9,
            ),
            (candidate) => {
              const separation =
                0.25 +
                1.5 *
                  Math.min(
                    1,
                    hueDistance(candidate.hue, primary.hue) / 90,
                  );
              const brightnessFit =
                1 -
                Math.min(0.55, Math.abs(candidate.lightness - 0.7));
              return (
                candidate.chroma ** 1.15 *
                candidate.population ** 0.14 *
                separation *
                brightnessFit
              );
            },
            [primary],
            0.1,
          );

        let secondary =
          primary &&
          choose(
            chromatic.filter(
              (candidate) =>
                candidate.lightness >= 0.2 &&
                candidate.lightness <= 0.58,
            ),
            (candidate) =>
              (0.2 + candidate.chroma) *
              candidate.population ** 0.38 *
              (1.1 - candidate.lightness),
            [primary, ...(accent ? [accent] : [])],
            0.075,
          );

        const primaryColor = primary?.color || defaults[0];
        const primaryLab =
          primary ||
          rgbToOklab(...Object.values(hexToRgb(primaryColor)));

        if (!accent) {
          accent = {
            color: defaults[1],
            ...rgbToOklab(...Object.values(hexToRgb(defaults[1]))),
          };
        }

        if (!secondary) {
          const derived = mix(
            primaryColor,
            "#17121b",
            primaryLab.lightness < 0.52 ? 0.35 : 0.62,
          );
          secondary = {
            color: derived,
            ...rgbToOklab(...Object.values(hexToRgb(derived))),
          };
        }

        const neutral = choose(
          candidates.filter(
            (candidate) =>
              candidate.lightness >= 0.72 &&
              candidate.lightness <= 0.96,
          ),
          (candidate) =>
            candidate.population * (1.1 - Math.min(candidate.chroma, 0.3)),
          [primaryLab, accent, secondary],
          0.06,
        );

        resolve([
          primaryColor,
          accent.color,
          secondary.color,
          defaults[3],
          neutral?.color || defaults[4],
        ]);
      };

      image.onerror = () => resolve([...defaults]);
      image.src = dataUrl;
    });
  }

  function prepareBackground(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();

      image.onload = () => {
        const maxSize = 1280;
        const scale = Math.min(
          1,
          maxSize / Math.max(image.width, image.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };

      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  function readStored(key, fallback = "") {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      // Theme persistence is best effort.
    }
  }

  function applyBackdrop(background) {
    const backdrop = document.getElementById("portalBackdrop");
    if (!backdrop) return;

    if (background) {
      backdrop.style.backgroundImage =
        'linear-gradient(180deg, rgba(12,10,14,.68), rgba(12,10,14,.88)), radial-gradient(ellipse 80% 60% at 50% 0%, rgba(240,168,200,.14), transparent 56%), url("' +
        background.replace(/"/g, "%22") +
        '")';
    } else {
      backdrop.style.backgroundImage =
        "radial-gradient(ellipse 72% 48% at 12% -6%, rgba(240,168,200,.16), transparent 66%), radial-gradient(ellipse 54% 44% at 88% 4%, rgba(232,184,109,.09), transparent 68%), linear-gradient(180deg, #17121b 0%, #100d13 58%, #09080a 100%)";
    }
  }

  function applyPalette(source) {
    currentSourcePalette =
      Array.isArray(source) && source.length >= 5
        ? [...source]
        : [...defaults];
    currentPalette = paletteForScheme(
      currentSourcePalette,
      currentSettings,
    );

    const [primary, accent, secondary, danger, neutral] = currentPalette;
    const root = document.documentElement;
    const controlBg = primary || defaults[0];
    const controlHover = accent || secondary || defaults[1];

    root.style.setProperty("--foreground", "#f7f1f6");
    root.style.setProperty("--muted", "rgba(247,241,246,.56)");
    root.style.setProperty("--faint", "rgba(247,241,246,.38)");
    root.style.setProperty("--primary", controlBg);
    root.style.setProperty("--accent", accent || defaults[1]);
    root.style.setProperty("--secondary", secondary || defaults[2]);
    root.style.setProperty("--danger", danger || defaults[3]);
    root.style.setProperty("--neutral", neutral || defaults[4]);
    root.style.setProperty("--primary-soft", hexToRgba(controlBg, 0.14));
    root.style.setProperty("--primary-ring", hexToRgba(controlBg, 0.42));
    root.style.setProperty("--control-bg", controlBg);
    root.style.setProperty("--control-border", hexToRgba(controlBg, 0.72));
    root.style.setProperty("--control-text", readableText(controlBg));
    root.style.setProperty("--control-hover-bg", controlHover);
    root.style.setProperty(
      "--control-hover-border",
      hexToRgba(controlHover, 0.78),
    );
    root.style.setProperty(
      "--control-hover-text",
      readableText(controlHover),
    );

    window.dispatchEvent(
      new CustomEvent("nutc-theme-change", {
        detail: {
          palette: [...currentPalette],
          settings: { ...currentSettings },
        },
      }),
    );
  }

  function readThemeSettings() {
    return normalizeSettings({
      colorScheme: readStored(
        colorSchemeKey,
        defaultSettings.colorScheme,
      ),
      colorfulness: readStored(
        colorfulnessKey,
        String(defaultSettings.colorfulness),
      ),
      brightness: readStored(
        brightnessKey,
        String(defaultSettings.brightness),
      ),
    });
  }

  function saveThemeSettings(settings) {
    store(colorSchemeKey, settings.colorScheme);
    store(colorfulnessKey, String(settings.colorfulness));
    store(brightnessKey, String(settings.brightness));
  }

  async function fetchServerPreferences() {
    const response = await fetch("/api/preferences", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load server preferences (${response.status}).`,
      );
    }

    return response.json();
  }

  async function saveServerBackground(backgroundDataUrl) {
    const response = await fetch("/api/preferences/background", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ backgroundDataUrl }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
          `Unable to save background on the server (${response.status}).`,
      );
    }

    return data;
  }

  function previewSettings(settings) {
    return paletteForScheme(
      currentSourcePalette,
      normalizeSettings(settings),
    );
  }

  function applySettings(settings) {
    currentSettings = normalizeSettings(settings);
    saveThemeSettings(currentSettings);
    applyPalette(currentSourcePalette);
    return {
      settings: { ...currentSettings },
      palette: [...currentPalette],
    };
  }

  async function setBackgroundFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) {
      throw new Error("Please choose an image file.");
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Unable to read the image."));
      reader.readAsDataURL(file);
    });

    const prepared = await prepareBackground(dataUrl);
    const extracted = await extractPalette(prepared);
    const saved = await saveServerBackground(prepared);

    currentBackground =
      saved?.appearance?.backgroundUrl || prepared;

    // Remove the old browser-local image once it has been persisted server-side.
    store(backgroundKey, "");
    store(paletteKey, JSON.stringify(extracted));
    applyBackdrop(currentBackground);
    applyPalette(extracted);

    return {
      background: currentBackground,
      palette: [...currentPalette],
    };
  }

  async function clearBackground() {
    await saveServerBackground("");

    currentBackground = "";
    store(backgroundKey, "");
    store(paletteKey, "");
    applyBackdrop("");
    applyPalette(defaults);
  }

  async function init() {
    currentSettings = readThemeSettings();
    let source = defaults;
    let loadedFromServer = false;

    try {
      const preferences = await fetchServerPreferences();
      const appearance = preferences?.appearance || {};
      const legacyBackground = readStored(backgroundKey, "");

      if (!appearance.initialized && legacyBackground) {
        const migrated = await saveServerBackground(legacyBackground);
        currentBackground =
          migrated?.appearance?.backgroundUrl || legacyBackground;
      } else {
        currentBackground = appearance.backgroundUrl || "";
      }

      store(backgroundKey, "");
      loadedFromServer = true;

      if (currentBackground) {
        source = await extractPalette(currentBackground);
        store(paletteKey, JSON.stringify(source));
      } else {
        store(paletteKey, "");
      }
    } catch {
      // Keep a local fallback so the UI remains usable if the server is
      // temporarily unavailable, but new writes always target the server.
      currentBackground = readStored(backgroundKey, "");

      try {
        const storedPalette = JSON.parse(
          readStored(paletteKey, "null"),
        );
        if (
          Array.isArray(storedPalette) &&
          storedPalette.length >= 5
        ) {
          source = storedPalette;
        } else if (currentBackground) {
          source = await extractPalette(currentBackground);
        }
      } catch {
        source = currentBackground
          ? await extractPalette(currentBackground)
          : defaults;
      }
    }

    if (loadedFromServer && !currentBackground) {
      source = defaults;
    }

    applyBackdrop(currentBackground);
    applyPalette(source);
  }

  window.NutcTheme = {
    init,
    setBackgroundFile,
    clearBackground,
    palette: () => [...currentPalette],
    sourcePalette: () => [...currentSourcePalette],
    schemes: () =>
      Object.entries(colorSchemes).map(([id, scheme]) => ({
        id,
        name: scheme.name,
      })),
    settings: () => ({ ...currentSettings }),
    previewSettings,
    applySettings,
    defaultSettings: () => ({ ...defaultSettings }),
    hasBackground: () => Boolean(currentBackground),
    rgba: hexToRgba,
  };
})();
