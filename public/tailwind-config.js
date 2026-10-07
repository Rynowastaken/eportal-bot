window.tailwind = window.tailwind || {};

const root = document.documentElement;
const defaults = {
  "--foreground": "#f7f1f6",
  "--muted": "rgba(247,241,246,.56)",
  "--faint": "rgba(247,241,246,.38)",
  "--primary": "#f0a8c8",
  "--accent": "#e8b86d",
  "--secondary": "#51314a",
  "--danger": "#f07178",
  "--primary-soft": "rgba(240,168,200,.14)",
  "--primary-ring": "rgba(240,168,200,.42)",
  "--control-bg": "#f0a8c8",
  "--control-border": "rgba(240,168,200,.72)",
  "--control-text": "#17121b",
  "--control-hover-bg": "#e8b86d",
  "--control-hover-border": "rgba(232,184,109,.78)",
  "--control-hover-text": "#17121b",
};

for (const [name, value] of Object.entries(defaults)) {
  root.style.setProperty(name, value);
}

const statusButtonStyle = document.createElement("style");
statusButtonStyle.textContent = `
  #serverStatusButton[data-status-expanded="false"] {
    border-color: transparent;
  }
`;
document.head.append(statusButtonStyle);

window.tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        "soft-out": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
};
