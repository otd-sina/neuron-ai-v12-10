(function initBottomNavigation() {
  const activePage = document.body?.dataset?.navPage;
  if (!activePage) {
    return;
  }

  const navItems = document.querySelectorAll(".bottom-nav-item[data-nav]");
  navItems.forEach((item) => {
    const isActive = item.dataset.nav === activePage;
    item.classList.toggle("active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
})();
