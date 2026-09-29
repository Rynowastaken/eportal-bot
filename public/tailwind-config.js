window.tailwind = window.tailwind || {};
tailwind.config = {
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
