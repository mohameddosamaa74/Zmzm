if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
  const previousScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";
  if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

  window.addEventListener("load", () => {
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);

    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
      history.scrollRestoration = previousScrollRestoration;
    });
  }, { once: true });
}
