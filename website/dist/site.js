for (const link of document.querySelectorAll('[data-scroll-to="try-it"]')) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const section = document.getElementById("try-it");
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    section.setAttribute("tabindex", "-1");
    section.focus({ preventScroll: true });
    if (location.hash)
      history.replaceState(null, "", location.pathname + location.search);
  });
}

if (location.hash === "#try-it") {
  document.getElementById("try-it")?.scrollIntoView();
  history.replaceState(null, "", location.pathname + location.search);
}

for (const link of document.querySelectorAll("[data-scroll-home]")) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    history.replaceState(null, "", location.pathname + location.search);
  });
}

if (location.href.endsWith("#")) {
  history.replaceState(null, "", location.pathname + location.search);
}
