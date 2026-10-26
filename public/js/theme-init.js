(function () {
  try {
    var raw = localStorage.getItem("crac_a_quiz_v1");
    var saved = raw ? JSON.parse(raw) : null;
    var preference = saved && saved.settings && saved.settings.theme ? saved.settings.theme : "system";
    var dark =
      preference === "dark" ||
      (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
