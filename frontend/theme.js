/* ───────────────────────────────────────────────────────────────────────
   Predixion theme helper — framework-agnostic, ~0.4kb.
   DEFAULT THEME IS DARK. Persists the user's choice in localStorage.
   Usage:
     <script src="theme.js"></script>           // applies saved/dark theme ASAP
     PredixionTheme.set("light")                 // switch
     PredixionTheme.toggle()                     // flip
     PredixionTheme.get()                        // "dark" | "light"
   It sets data-pd-theme on <html>. Put it in <head> to avoid a flash.
   ─────────────────────────────────────────────────────────────────────── */
(function () {
  var KEY = "pd-theme";
  var root = document.documentElement;
  function apply(t) { root.setAttribute("data-pd-theme", t === "light" ? "light" : "dark"); }
  // DEFAULT = dark (only honor a stored explicit choice)
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "light" ? "light" : "dark");
  window.PredixionTheme = {
    get: function () { return root.getAttribute("data-pd-theme") || "dark"; },
    set: function (t) { apply(t); try { localStorage.setItem(KEY, t); } catch (e) {} },
    toggle: function () { this.set(this.get() === "dark" ? "light" : "dark"); }
  };
})();
