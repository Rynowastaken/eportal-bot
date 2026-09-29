(() => {
  "use strict";

  const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

  function reduced() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  function play(element, keyframes, options = {}) {
    if (!element || reduced() || typeof element.animate !== "function") {
      return Promise.resolve();
    }

    const animation = element.animate(keyframes, {
      fill: "both",
      easing,
      ...options,
    });

    return animation.finished
      .catch(() => {})
      .finally(() => {
        try {
          animation.cancel();
        } catch {
          // The element may already be detached.
        }
      });
  }

  function enter(
    element,
    {
      delay = 0,
      duration = 340,
      y = 10,
      scale = 0.98,
    } = {},
  ) {
    return play(
      element,
      [
        {
          opacity: 0,
          transform: `translateY(${y}px) scale(${scale})`,
        },
        {
          opacity: 1,
          transform: "translateY(0) scale(1)",
        },
      ],
      { duration, delay },
    );
  }

  function exit(
    element,
    {
      duration = 180,
      y = 8,
      scale = 0.985,
    } = {},
  ) {
    return play(
      element,
      [
        {
          opacity: 1,
          transform: "translateY(0) scale(1)",
        },
        {
          opacity: 0,
          transform: `translateY(${y}px) scale(${scale})`,
        },
      ],
      { duration },
    );
  }

  function pop(element, { duration = 220, delay = 0 } = {}) {
    return play(
      element,
      [
        { opacity: 0, transform: "scale(0.82)" },
        { opacity: 1, transform: "scale(1.06)", offset: 0.68 },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration, delay },
    );
  }

  function fade(element, { duration = 200, from = 0, to = 1 } = {}) {
    return play(
      element,
      [{ opacity: from }, { opacity: to }],
      { duration, easing: "ease" },
    );
  }

  function stagger(
    elements,
    {
      step = 45,
      duration = 340,
      y = 10,
      scale = 0.98,
      maxDelay = 240,
    } = {},
  ) {
    if (reduced()) return Promise.resolve();

    return Promise.all(
      [...elements].map((element, index) =>
        enter(element, {
          delay: Math.min(index * step, maxDelay),
          duration,
          y,
          scale,
        }),
      ),
    );
  }

  async function openDialog(
    dialog,
    card,
    {
      duration = 280,
      y = 14,
      scale = 0.97,
    } = {},
  ) {
    if (!dialog.open) dialog.showModal();

    if (reduced()) return;

    fade(dialog, { duration: Math.min(duration, 220) });
    await enter(card, { duration, y, scale });
  }

  async function closeDialog(
    dialog,
    card,
    {
      duration = 180,
      y = 10,
      scale = 0.985,
    } = {},
  ) {
    if (!dialog?.open) return;

    if (!reduced()) {
      await Promise.all([
        exit(card, { duration, y, scale }),
        fade(dialog, { duration, from: 1, to: 0 }),
      ]);
    }

    dialog.close();
  }

  function emphasize(element, { duration = 220 } = {}) {
    return play(
      element,
      [
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(1.04)", filter: "brightness(1.08)", offset: 0.55 },
        { transform: "scale(1)", filter: "brightness(1)" },
      ],
      { duration },
    );
  }

  window.NutcMotion = {
    reduced,
    play,
    enter,
    exit,
    pop,
    fade,
    stagger,
    openDialog,
    closeDialog,
    emphasize,
  };
})();
