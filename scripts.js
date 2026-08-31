/* ==========================================================================
   Casa Principesca de Novgorod — scripts
   1. Alternador de tema (claro/escuro) com persistência
   2. Barra de progresso de rolagem + paralaxe sutil da bandeira
   3. Revelação de elementos ao entrar na tela
   4. Compartilhamento das publicações do blog
   ========================================================================== */

(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     1. Alternador de tema
     ------------------------------------------------------------------ */
  var THEME_KEY = "novgorod-theme";
  var html = document.documentElement;
  var themeToggle = document.getElementById("themeToggle");
  var avatarImg = document.getElementById("avatarImg");

  var AVATAR_DARK = "./assets/card.png";
  var AVATAR_LIGHT = "./assets/brasao-pequenas-armas.png";

  function applyTheme(isLight) {
    html.classList.toggle("light", isLight);
    if (themeToggle) {
      themeToggle.setAttribute("aria-checked", String(isLight));
    }
    if (avatarImg) {
      avatarImg.src = isLight ? AVATAR_LIGHT : AVATAR_DARK;
    }
  }

  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (err) {
      /* localStorage indisponível (ex.: navegação privada); segue com o padrão */
    }

    if (saved === "light" || saved === "dark") {
      applyTheme(saved === "light");
      return;
    }

    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight);
  }

  function toggleTheme() {
    var isLight = !html.classList.contains("light");
    applyTheme(isLight);
    try {
      localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
    } catch (err) {
      /* segue sem persistir */
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  initTheme();

  /* ------------------------------------------------------------------
     2. Barra de progresso de rolagem + paralaxe da bandeira
     ------------------------------------------------------------------ */
  var progressBanner = document.getElementById("progressBanner");
  var ticking = false;

  function updateOnScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

    if (progressBanner) {
      progressBanner.style.width = progress + "%";
    }

    if (!prefersReducedMotion) {
      document.documentElement.style.setProperty("--scroll-y", scrollTop.toFixed(1));
    }

    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(updateOnScroll);
      ticking = true;
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  updateOnScroll();

  /* ------------------------------------------------------------------
     3. Revelação de elementos ao entrar na tela
     ------------------------------------------------------------------ */
  var revealTargets = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window && revealTargets.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );

    revealTargets.forEach(function (target) {
      observer.observe(target);
    });
  } else {
    revealTargets.forEach(function (target) {
      target.classList.add("is-visible");
    });
  }

  /* ------------------------------------------------------------------
     4. Compartilhamento das publicações do blog
     ------------------------------------------------------------------ */
  var toast = document.getElementById("toast");
  var toastTimer = null;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(textarea);
      }
    });
  }

  document.querySelectorAll(".share-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      var post = button.closest("[data-share-url]");
      var title = (post && post.dataset.shareTitle) || document.title;
      var url = (post && post.dataset.shareUrl) || window.location.href;

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {
          /* usuário cancelou o compartilhamento; nada a fazer */
        });
        return;
      }

      copyToClipboard(url)
        .then(function () {
          showToast("Link copiado para a área de transferência!");
        })
        .catch(function () {
          showToast("Não foi possível copiar o link.");
        });
    });
  });
})();
