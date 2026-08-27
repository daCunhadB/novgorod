
/* =====================================================================
   BLOCO: BARRA DE PROGRESSO DE ROLAGEM
===================================================================== */
const scrollProgressEl = document.querySelector(".scroll-progress");

function updateScrollProgress() {
  const doc = document.documentElement;
  const scrollTop = doc.scrollTop || document.body.scrollTop;
  const scrollHeight = (doc.scrollHeight || document.body.scrollHeight) - doc.clientHeight;
  const fraction = scrollHeight > 0 ? scrollTop / scrollHeight : 0;

  if (scrollProgressEl) {
    scrollProgressEl.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
  }

  return fraction;
}

/* =====================================================================
   BLOCO: REVELAÇÃO DE ELEMENTOS DURANTE A ROLAGEM
   Observa todos os blocos marcados com .reveal e adiciona
   .is-visible quando entram na área visível da tela.
===================================================================== */
function setupScrollReveal() {
  const revealTargets = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window) || revealTargets.length === 0) {
    revealTargets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );

  revealTargets.forEach((el) => observer.observe(el));
}

/* =====================================================================
   BLOCO: GALERIA HERÁLDICA — montagem dinâmica + caixa expansiva
   Cada imagem do acervo (exceto o "card", já exibido em destaque,
   e o ícone de contato) é listada aqui. O título exibido é
   derivado automaticamente do nome do arquivo.
===================================================================== */
const GALLERY_IMAGES = [
  "bandeira.png",
  "brasao-grandes-armas.png",
  "brasao-mozer.png",
  "brasao-pequenas-armas.png",
  "poitiers.png",
];

// Correções de acentuação para nomes de arquivo sem diacríticos.
const TITLE_WORD_FIXES = {
  brasao: "Brasão",
};

function titleFromFilename(filename) {
  const baseName = filename.replace(/\.[^/.]+$/, "");
  return baseName
    .split("-")
    .map((word) => TITLE_WORD_FIXES[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildGallery() {
  const grid = document.getElementById("gallery-grid");
  const toggleButton = document.getElementById("gallery-toggle");
  if (!grid || !toggleButton) return;

  GALLERY_IMAGES.forEach((filename) => {
    const title = titleFromFilename(filename);

    const figure = document.createElement("figure");
    figure.className = "gallery-item";

    const frame = document.createElement("div");
    frame.className = "gallery-item__frame";

    const img = document.createElement("img");
    img.src = `./assets/${filename}`;
    img.alt = title;
    img.loading = "lazy";

    const caption = document.createElement("figcaption");
    caption.textContent = title;

    frame.appendChild(img);
    figure.appendChild(frame);
    figure.appendChild(caption);
    grid.appendChild(figure);
  });

  toggleButton.addEventListener("click", () => {
    const isOpen = grid.classList.toggle("is-open");
    grid.hidden = false;
    toggleButton.setAttribute("aria-expanded", String(isOpen));
    toggleButton.querySelector(".gallery-toggle__label").textContent = isOpen
      ? "Ver menos"
      : "Ver mais";

    if (!isOpen) {
      // Aguarda a transição de fechamento antes de esconder de fato.
      window.setTimeout(() => {
        if (!grid.classList.contains("is-open")) grid.hidden = true;
      }, 700);
    } else {
      grid.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

/* =====================================================================
   BLOCO: FUNDO ANIMADO — BANDEIRA FLAMEJANTE
   Desenha o arquivo "bandeira.png" em ondulação contínua, como um
   pano ao vento / flama. A rolagem da página controla:
     - a amplitude e a velocidade da ondulação (mais viva ao avançar);
     - o filtro visual do canvas (de memória esmaecida a honra plena).
===================================================================== */
function setupFlagBackground() {
  const canvas = document.getElementById("flag-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const flagImage = new Image();
  flagImage.src = "./assets/bandeira.png";

  let offscreen = document.createElement("canvas");
  let offscreenCtx = offscreen.getContext("2d");
  let imageReady = false;
  let scrollFraction = 0;
  let startTime = performance.now();

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    offscreen.width = window.innerWidth;
    offscreen.height = window.innerHeight;
    drawCoverImage();
  }

  // Desenha a bandeira em "cover" numa tela auxiliar (evita recalcular
  // o recorte a cada quadro da animação).
  function drawCoverImage() {
    if (!flagImage.complete || flagImage.naturalWidth === 0) return;

    const canvasRatio = offscreen.width / offscreen.height;
    const imageRatio = flagImage.naturalWidth / flagImage.naturalHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (imageRatio > canvasRatio) {
      drawHeight = offscreen.height;
      drawWidth = drawHeight * imageRatio;
      offsetX = (offscreen.width - drawWidth) / 2;
      offsetY = 0;
    } else {
      drawWidth = offscreen.width;
      drawHeight = drawWidth / imageRatio;
      offsetX = 0;
      offsetY = (offscreen.height - drawHeight) / 2;
    }

    offscreenCtx.clearRect(0, 0, offscreen.width, offscreen.height);
    offscreenCtx.drawImage(flagImage, offsetX, offsetY, drawWidth, drawHeight);
    imageReady = true;
  }

  function applyScrollFilter() {
    // 0 no topo (memória adormecida) -> 1 no meio (honra em pleno vigor)
    // -> levemente reduzido perto do rodapé (assentado, solene).
    const wakeUp = Math.min(1, scrollFraction / 0.55);
    const settle = scrollFraction > 0.75 ? (scrollFraction - 0.75) / 0.25 : 0;

    const grayscale = Math.max(0, 65 - wakeUp * 65 + settle * 12);
    const brightness = 0.55 + wakeUp * 0.55 - settle * 0.12;
    const saturate = 0.8 + wakeUp * 0.55 - settle * 0.1;

    canvas.style.filter = `grayscale(${grayscale}%) brightness(${brightness}) saturate(${saturate})`;
  }

  function drawWavingFlag(time) {
    if (!imageReady) {
      requestAnimationFrame(drawWavingFlag);
      return;
    }

    const elapsed = (time - startTime) / 1000;
    const wakeUp = Math.min(1, scrollFraction / 0.55);

    // A ondulação cresce e acelera levemente conforme a rolagem avança.
    const amplitude = 4 + wakeUp * 10;
    const speed = 0.6 + wakeUp * 0.9;
    const frequency = 0.018;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sliceHeight = 4;
    for (let y = 0; y < canvas.height; y += sliceHeight) {
      const offsetX = Math.sin(y * frequency + elapsed * speed) * amplitude;
      ctx.drawImage(
        offscreen,
        0,
        y,
        canvas.width,
        sliceHeight,
        offsetX,
        y,
        canvas.width,
        sliceHeight
      );
    }

    requestAnimationFrame(drawWavingFlag);
  }

  function drawStaticFlag() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0);
  }

  flagImage.addEventListener("load", () => {
    drawCoverImage();
    if (prefersReducedMotion) {
      drawStaticFlag();
    } else {
      requestAnimationFrame(drawWavingFlag);
    }
  });

  window.addEventListener("resize", () => {
    resize();
    if (prefersReducedMotion) drawStaticFlag();
  });

  window.addEventListener(
    "scroll",
    () => {
      scrollFraction = updateScrollProgress();
      applyScrollFilter();
    },
    { passive: true }
  );

  resize();
  applyScrollFilter();
}

/* =====================================================================
   BLOCO: INICIALIZAÇÃO
===================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  updateScrollProgress();
  setupScrollReveal();
  buildGallery();
  setupFlagBackground();
});
