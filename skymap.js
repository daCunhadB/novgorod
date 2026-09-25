/* ==========================================================================
   Novgorod SkyMap — motor panorâmico 360°×180°
   ==========================================================================

   Implementa um canvas equirretangular fixo atrás da cena HTML existente.
   Lê os sensores do dispositivo (DeviceOrientationEvent) e o mouse/touch
   para rotacionar o ponto de vista em 360° horizontais × 180° verticais,
   exatamente como apps de skymap (Stellarium, SkySafari) e wallpapers
   dinâmicos do iOS.

   Camadas renderizadas (de trás para a frente):
     1. Gradiente de céu dinâmico (sincronizado com data-scene-time e
        data-weather definidos pelo motor atmosférico existente)
     2. Estrelas procedurais (450+ estrelas com magnitude, cor espectral e
        cintilação; visíveis apenas à noite)
     3. Sol ou Lua posicionados de acordo com o motor astronômico existente
        (lê --orb-x, --orb-y, --orb-altitude definidos pelo JS original)
     4. Terreno panorâmico: floresta de taiga, Rio Volkhov, cidade, campos
        (desenhados em vetor a partir das coordenadas do azimute)
     5. Névoa de horizonte volumétrica

   Paralaxe de profundidade por camada:
     O canvas é o fundo (z-index -4). Sobre ele, a cena HTML existente
     (.scene) é deslocada via CSS custom property --gyro-x / --gyro-y
     escritas por este motor, de modo que cada camada CSS com data-parallax
     se desloca em proporção à sua profundidade — sem tocar na lógica de
     animação da bandeira ou das nuvens.

   Controles:
     • Giroscópio real (DeviceOrientationEvent / iOS requestPermission)
     • Mouse: arrastar para rotacionar o azimute, scroll para elevar
     • Touch: deslizar para rotacionar
     • Teclado: ←→ azimute, ↑↓ elevação, R para recentrar

   API pública: window.NovgorodSkyMap
   ========================================================================== */

(function () {
  "use strict";

  /* -------------------------------------------------------------------------
     Configuração
     ------------------------------------------------------------------------- */
  var CFG = {
    FOV_H:       100,   /* graus horizontais visíveis (campo de visão) */
    FOV_V:        60,   /* graus verticais visíveis */
    PARALLAX_MAX: 32,   /* px de deslocamento máximo das camadas HTML */
    GYRO_SENS_AZ: 2.4,  /* sensibilidade: graus de gamma → graus de azimute */
    GYRO_SENS_EL: 0.55, /* sensibilidade: graus de beta  → graus de elevação */
    MOUSE_SENS:   0.40, /* sensibilidade do arrastar de mouse */
    LERP_AZ:      0.07, /* suavização exponencial do azimute */
    LERP_EL:      0.07,
    LERP_PAR:     0.10, /* suavização do paralaxe HTML */
    STAR_COUNT:   480,
    TERRAIN_SEED: 42
  };

  /* -------------------------------------------------------------------------
     Inicialização: só corre depois que o DOM está pronto
     ------------------------------------------------------------------------- */
  function init() {
    var html    = document.documentElement;
    var canvas  = document.getElementById("skyCanvas");
    if (!canvas) return;

    var ctx = canvas.getContext("2d");
    var W = 0, H = 0;

    /* --- Resize ------------------------------------------------------------ */
    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
      buildTerrain();   /* recalcular geometria do terreno */
    }
    window.addEventListener("resize", resize, { passive: true });
    resize();

    /* -----------------------------------------------------------------------
       Estado da câmera
       ----------------------------------------------------------------------- */
    var az    = 180;   /* azimute atual suavizado (0-360°; 180 = sul / kremlin) */
    var el    = 0;     /* elevação atual suavizada (-90 a +90°) */
    var rawAz = 180;   /* alvo bruto do sensor/input */
    var rawEl = 0;

    /* Paralaxe HTML (escrito em --gyro-x / --gyro-y) */
    var parX = 0, parY = 0;
    var rawParX = 0, rawParY = 0;

    /* -----------------------------------------------------------------------
       Terreno panorâmico (pontos do mundo em azimute → objeto visual)
       ----------------------------------------------------------------------- */
    var terrain = [];   /* lista de objetos de terreno */

    /* Pseudo-random determinístico */
    function prng(seed) {
      var s = seed;
      return function () {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };
    }

    function buildTerrain() {
      var rng = prng(CFG.TERRAIN_SEED);
      terrain = [];

      /* --- Floresta de pinheiros: norte (340–360 e 0–55), leste (85–120),
             oeste (230–285) ------------------------------------------------ */
      var forestZones = [
        { a0: 340, a1: 415, n: 38, hMin: 0.14, hMax: 0.26 }, /* Norte */
        { a0:  85, a1: 122, n: 28, hMin: 0.11, hMax: 0.20 }, /* Leste */
        { a0: 230, a1: 286, n: 32, hMin: 0.12, hMax: 0.22 }, /* Oeste */
        { a0: 145, a1: 182, n: 14, hMin: 0.07, hMax: 0.13 }, /* SE esparso */
      ];

      forestZones.forEach(function (zone) {
        var step = (zone.a1 - zone.a0) / zone.n;
        for (var i = 0; i < zone.n; i++) {
          var tAz = zone.a0 + i * step + (rng() - 0.5) * step * 0.6;
          terrain.push({
            type: "pine",
            az:   ((tAz % 360) + 360) % 360,
            h:    zone.hMin + rng() * (zone.hMax - zone.hMin),
            w:    0.025 + rng() * 0.022,
            depth: 0.5 + rng() * 0.4,   /* profundidade para sombra */
            phase: rng() * Math.PI * 2   /* fase para variação de cor */
          });
        }
      });

      /* --- Casas / aldeia: sul (162–200°) --------------------------------- */
      var houseAz = [162,167,172,177,182,187,192,197,202];
      houseAz.forEach(function (a, i) {
        terrain.push({
          type: "house",
          az:    a,
          h:     0.07 + (i % 4) * 0.018,
          w:     0.032 + (i % 3) * 0.008,
          depth: 0.8,
          lit:   (i % 3 === 0)   /* janela acesa à noite */
        });
      });

      /* --- Rio Volkhov (faixa azul, leste: 85–112°) ----------------------- */
      terrain.push({ type: "river", az0: 85, az1: 112, depth: 0.3 });

      /* --- Campo aberto SW (210–228°) ------------------------------------- */
      for (var f = 0; f < 12; f++) {
        terrain.push({
          type: "shrub",
          az:    210 + f * 1.5 + rng() * 1.2,
          h:     0.025 + rng() * 0.018,
          w:     0.018,
          depth: 0.9 + rng() * 0.1
        });
      }
    }

    /* -----------------------------------------------------------------------
       Geração de estrelas
       ----------------------------------------------------------------------- */
    var stars = [];

    (function buildStars() {
      var rng = prng(7777);
      for (var i = 0; i < CFG.STAR_COUNT; i++) {
        var mag = 0.2 + rng() * 5.5;            /* magnitude visual */
        var t   = rng();                          /* tipo espectral 0-1 */
        /* Cor espectral: O (azul) → A (branca) → F → G → K → M (vermelha) */
        var r, g, b;
        if (t < 0.12) { r = 160; g = 185; b = 255; }      /* O,B: azul */
        else if (t < 0.30) { r = 220; g = 230; b = 255; } /* A: branca-azul */
        else if (t < 0.55) { r = 255; g = 245; b = 225; } /* F,G: amarelo */
        else if (t < 0.78) { r = 255; g = 215; b = 155; } /* K: laranja */
        else { r = 255; g = 165; b = 100; }               /* M: vermelho */

        stars.push({
          az:       rng() * 360,
          elev:     rng() * 160 - 80,      /* -80 a +80° */
          mag:      mag,
          r: r, g: g, b: b,
          twinkle:  rng() * Math.PI * 2,   /* fase de cintilação */
          twinkleSpeed: 0.6 + rng() * 1.8
        });
      }
    })();

    /* -----------------------------------------------------------------------
       Utilitários de projeção
       ----------------------------------------------------------------------- */
    /* Diferença angular menor caminho -180..180 */
    function angleDiff(a, b) {
      var d = a - b;
      while (d >  180) d -= 360;
      while (d < -180) d += 360;
      return d;
    }

    /* Converte coordenadas do mundo (azimute, elevação) em pixels na tela */
    function project(worldAz, worldEl) {
      var dAz = angleDiff(worldAz, az);
      var dEl = worldEl - el;
      var pxX = W / 2 + (dAz / CFG.FOV_H) * W;
      var pxY = H / 2 - (dEl / CFG.FOV_V) * H;
      return { x: pxX, y: pxY };
    }

    /* Verifica se um azimute está dentro do campo de visão horizontal */
    function inFOV(worldAz, margin) {
      margin = margin || 0;
      return Math.abs(angleDiff(worldAz, az)) < CFG.FOV_H / 2 + margin;
    }

    /* Largura em pixels de um arco angular */
    function arcPx(angleDeg) {
      return (angleDeg / CFG.FOV_H) * W;
    }

    /* -----------------------------------------------------------------------
       Paleta dinâmica
       ----------------------------------------------------------------------- */
    function getPalette() {
      var isDay     = html.getAttribute("data-scene-time") === "day";
      var isLight   = html.classList.contains("light");
      var weather   = html.getAttribute("data-weather") || "clear";
      var isStorm   = weather === "storm";
      var isRain    = weather === "rain";
      var isCloudy  = weather === "cloudy" || isRain || isStorm;
      var isDrought = weather === "drought";

      return {
        isDay:    isDay,
        skyTop:   isDay
          ? (isStorm ? [20,25,40]   : isRain  ? [55,72,95]    : isCloudy ? [75,100,130] : isDrought ? [80,110,160] : [45,98,180])
          : [4,7,18],
        skyHorizon: isDay
          ? (isStorm ? [35,38,52]   : isRain  ? [88,100,120]  : isCloudy ? [140,155,170]: isDrought ? [170,155,110]: [135,185,230])
          : [15,22,45],
        skyHazeColor: isDay ? [210,228,248] : [22,28,55],
        groundBase: isDay
          ? (isDrought ? [148,126,75] : isRain ? [62,70,65]  : [88,96,70])
          : [20,16,10],
        waterColor: isDay ? [50,85,138] : [14,22,44],
        treeColor:  isDay ? [30,54,22]  : [10,18,6],
        treeDark:   isDay ? [18,36,14]  : [5,10,3],
        houseWall:  isDay ? [82,64,38]  : [35,28,16],
        houseRoof:  isDay ? [62,52,34]  : [26,20,10],
        windowGlow: [255, 200, 80],
        showStars:  !isDay && !isStorm,
        starFade:   isCloudy && !isDay ? 0.3 : 1.0
      };
    }

    function lerpC(a, b, t) {
      return [
        Math.round(a[0] + (b[0]-a[0]) * t),
        Math.round(a[1] + (b[1]-a[1]) * t),
        Math.round(a[2] + (b[2]-a[2]) * t)
      ];
    }
    function rgbStr(c, a) {
      if (a !== undefined) return "rgba("+c[0]+","+c[1]+","+c[2]+","+a+")";
      return "rgb("+c[0]+","+c[1]+","+c[2]+")";
    }

    /* -----------------------------------------------------------------------
       Renderização: céu
       ----------------------------------------------------------------------- */
    function drawSky(p, groundY) {
      /* Degradê do zênite ao horizonte */
      var grad = ctx.createLinearGradient(0, 0, 0, groundY);
      /* Zênite: escurece um pouco com elevação negativa (olhando para baixo) */
      var zenithBoost = Math.max(0, -el / 45);
      var skyTopAdj = lerpC(p.skyTop, p.groundBase, zenithBoost * 0.3);
      grad.addColorStop(0,    rgbStr(skyTopAdj));
      grad.addColorStop(0.65, rgbStr(p.skyHorizon));
      grad.addColorStop(0.9,  rgbStr(lerpC(p.skyHorizon, p.skyHazeColor, 0.45)));
      grad.addColorStop(1,    rgbStr(p.skyHazeColor, 0.7));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, groundY);
    }

    /* -----------------------------------------------------------------------
       Renderização: estrelas
       ----------------------------------------------------------------------- */
    function drawStars(p, t) {
      if (!p.showStars) return;
      var fade = p.starFade;

      stars.forEach(function (s) {
        if (!inFOV(s.az, 10)) return;
        /* Só estrelas acima do horizonte (com margem de 5°) */
        var dEl = s.elev - el;
        if (dEl < -CFG.FOV_V / 2 - 4 || dEl > CFG.FOV_V / 2 + 4) return;

        var pt = project(s.az, s.elev);
        if (pt.x < -8 || pt.x > W + 8 || pt.y < -8) return;
        /* Não desenhar estrelas abaixo da linha do horizonte */
        var groundY = H * getGroundFrac();
        if (pt.y > groundY - 4) return;

        /* Tamanho inversamente proporcional à magnitude */
        var size = Math.max(0.5, (6 - s.mag) * 0.38);
        /* Cintilação */
        var twinkle = 0.7 + 0.3 * Math.sin(t * s.twinkleSpeed + s.twinkle);
        var alpha = Math.min(1, (6 - s.mag) / 5.5) * twinkle * fade;

        ctx.save();
        /* Glow para estrelas brilhantes */
        if (s.mag < 2.5) {
          var glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, size * 4);
          glow.addColorStop(0, rgbStr([s.r,s.g,s.b], alpha * 0.5));
          glow.addColorStop(1, rgbStr([s.r,s.g,s.b], 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, size * 4, 0, Math.PI*2);
          ctx.fill();
        }
        /* Núcleo */
        ctx.fillStyle = rgbStr([s.r,s.g,s.b], alpha);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, size, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      });
    }

    /* -----------------------------------------------------------------------
       Fração da tela que é "chão" (abaixo do horizonte)
       A linha de horizonte cai a H*(1 - el/FOV_V * 0.5) aproximadamente.
       ----------------------------------------------------------------------- */
    function getGroundFrac() {
      /* Horizonte na tela: quando el=0, está em H/2; sobe com elevação +. */
      return 0.5 + el / CFG.FOV_V;
    }

    /* -----------------------------------------------------------------------
       Renderização: chão / terra
       ----------------------------------------------------------------------- */
    function drawGround(p, groundY) {
      var grad = ctx.createLinearGradient(0, groundY, 0, H);
      grad.addColorStop(0,   rgbStr(p.groundBase));
      grad.addColorStop(0.5, rgbStr(lerpC(p.groundBase, [8,6,3], 0.5)));
      grad.addColorStop(1,   rgbStr([5,4,2]));
      ctx.fillStyle = grad;
      ctx.fillRect(0, groundY, W, H - groundY);
    }

    /* -----------------------------------------------------------------------
       Renderização: terreno (pinheiros, casas, rio)
       ----------------------------------------------------------------------- */
    function drawTerrain(p, groundY, t) {
      /* Ordenar por profundidade (objetos mais distantes primeiro) */
      var sorted = terrain.slice().sort(function (a, b) {
        return (b.depth || 0.5) - (a.depth || 0.5);
      });

      sorted.forEach(function (obj) {
        if (obj.type === "river") {
          drawRiver(obj, p, groundY);
          return;
        }
        if (!inFOV(obj.az, 10)) return;

        var pt = project(obj.az, 0);
        var baseY = groundY + 1;
        var hPx   = (obj.h || 0.12) * H;
        var wPx   = arcPx((obj.w || 0.03) * CFG.FOV_H);

        if (obj.type === "pine") {
          drawPine(pt.x, baseY, hPx, wPx, p, obj);
        } else if (obj.type === "house") {
          drawHouse(pt.x, baseY, hPx, wPx, p, obj);
        } else if (obj.type === "shrub") {
          drawShrub(pt.x, baseY, hPx, wPx, p);
        }
      });
    }

    function drawPine(cx, baseY, hPx, wPx, p, obj) {
      /* Tronco */
      ctx.fillStyle = rgbStr([55,38,18], 0.75);
      ctx.fillRect(cx - 1.5, baseY - hPx * 0.22, 3, hPx * 0.24);

      /* 3 camadas de copa cônica (baixo → alto) */
      for (var lev = 2; lev >= 0; lev--) {
        var layerT = lev / 3;
        var ly     = baseY - hPx * (layerT * 0.58 + 0.04);
        var lw     = wPx  * (1 - layerT * 0.38);
        var lh     = hPx  * 0.42;
        /* Variação procedural de cor */
        var shade = 0.65 + 0.35 * Math.sin(obj.phase + lev);
        var col   = lev === 0 ? p.treeColor : lerpC(p.treeColor, p.treeDark, 0.5 + lev * 0.2);
        var colShaded = lerpC(col, [0,0,0], 0.28 * (1-shade));

        ctx.fillStyle = rgbStr(colShaded, 0.85);
        ctx.beginPath();
        ctx.moveTo(cx - lw/2, ly + lh);
        ctx.lineTo(cx,         ly);
        ctx.lineTo(cx + lw/2, ly + lh);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawHouse(cx, baseY, hPx, wPx, p, obj) {
      var isDay = p.isDay;
      var x1 = cx - wPx/2;
      var roofH = hPx * 0.48;
      var wallH = hPx;

      /* Parede */
      ctx.fillStyle = rgbStr(p.houseWall, 0.90);
      ctx.fillRect(x1, baseY - wallH, wPx, wallH);

      /* Sombra lateral */
      ctx.fillStyle = rgbStr([0,0,0], 0.25);
      ctx.fillRect(x1 + wPx * 0.65, baseY - wallH, wPx * 0.35, wallH);

      /* Telhado */
      ctx.fillStyle = rgbStr(p.houseRoof, 0.92);
      ctx.beginPath();
      ctx.moveTo(x1 - 3,        baseY - wallH);
      ctx.lineTo(cx,             baseY - wallH - roofH);
      ctx.lineTo(x1 + wPx + 3,  baseY - wallH);
      ctx.closePath();
      ctx.fill();

      /* Janela acesa à noite */
      if (!isDay && obj.lit) {
        var wy = baseY - wallH * 0.6;
        ctx.fillStyle = rgbStr(p.windowGlow, 0.78);
        ctx.fillRect(cx - wPx*0.12, wy, wPx*0.24, hPx*0.18);
        /* Halo */
        var hwg = ctx.createRadialGradient(cx, wy + hPx*0.09, 0, cx, wy + hPx*0.09, wPx*0.8);
        hwg.addColorStop(0, rgbStr(p.windowGlow, 0.22));
        hwg.addColorStop(1, rgbStr(p.windowGlow, 0));
        ctx.fillStyle = hwg;
        ctx.fillRect(cx - wPx, wy - hPx*0.2, wPx*2, hPx*0.6);
      }
    }

    function drawShrub(cx, baseY, hPx, wPx, p) {
      ctx.fillStyle = rgbStr(p.treeDark, 0.70);
      ctx.beginPath();
      ctx.ellipse(cx, baseY - hPx*0.5, wPx*0.5, hPx*0.55, 0, 0, Math.PI*2);
      ctx.fill();
    }

    function drawRiver(obj, p, groundY) {
      var x1 = worldToX(obj.az0);
      var x2 = worldToX(obj.az1);
      if (x2 < 0 || x1 > W) return;
      x1 = Math.max(0, x1);
      x2 = Math.min(W, x2);

      var rGrad = ctx.createLinearGradient(x1, 0, x2, 0);
      rGrad.addColorStop(0,   rgbStr(p.waterColor, 0.2));
      rGrad.addColorStop(0.3, rgbStr(p.waterColor, 0.88));
      rGrad.addColorStop(0.7, rgbStr(p.waterColor, 0.88));
      rGrad.addColorStop(1,   rgbStr(p.waterColor, 0.2));
      ctx.fillStyle = rGrad;
      ctx.fillRect(x1, groundY, x2 - x1, H * 0.08);

      /* Reflexo de luz */
      if (p.isDay) {
        ctx.fillStyle = rgbStr([200,220,255], 0.14);
        ctx.fillRect(x1+(x2-x1)*0.3, groundY+2, (x2-x1)*0.4, 4);
      }
    }

    /* Converte azimute do mundo diretamente em X (sem elevar) */
    function worldToX(worldAz) {
      var dAz = angleDiff(worldAz, az);
      return W/2 + (dAz / CFG.FOV_H) * W;
    }

    /* -----------------------------------------------------------------------
       Renderização: névoa de horizonte
       ----------------------------------------------------------------------- */
    function drawHaze(p, groundY) {
      var hazeH = H * 0.15;
      var hazeGrad = ctx.createLinearGradient(0, groundY - hazeH, 0, groundY + hazeH*0.5);
      hazeGrad.addColorStop(0,   rgbStr(p.skyHazeColor, 0));
      hazeGrad.addColorStop(0.5, rgbStr(p.skyHazeColor, 0.20));
      hazeGrad.addColorStop(1,   rgbStr(p.skyHazeColor, 0.05));
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, groundY - hazeH, W, hazeH * 1.5);
    }

    /* -----------------------------------------------------------------------
       Renderização: vinheta lateral (suaviza as bordas do panorama)
       ----------------------------------------------------------------------- */
    function drawVignette() {
      var vW = W * 0.10;
      var vgL = ctx.createLinearGradient(0, 0, vW, 0);
      vgL.addColorStop(0, "rgba(0,0,0,0.42)");
      vgL.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = vgL;
      ctx.fillRect(0, 0, vW, H);

      var vgR = ctx.createLinearGradient(W - vW, 0, W, 0);
      vgR.addColorStop(0, "rgba(0,0,0,0)");
      vgR.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = vgR;
      ctx.fillRect(W - vW, 0, vW, H);
    }

    /* -----------------------------------------------------------------------
       Loop de renderização principal
       ----------------------------------------------------------------------- */
    var lastFrame = 0;

    function render(now) {
      /* Suavizar câmera */
      var dAz = angleDiff(rawAz, az);
      az += dAz * CFG.LERP_AZ;
      az  = ((az % 360) + 360) % 360;

      var dEl = rawEl - el;
      el += dEl * CFG.LERP_EL;
      el  = Math.max(-45, Math.min(45, el));

      /* Suavizar paralaxe */
      parX += (rawParX - parX) * CFG.LERP_PAR;
      parY += (rawParY - parY) * CFG.LERP_PAR;

      /* Escrever variáveis CSS de paralaxe para as camadas HTML */
      document.documentElement.style.setProperty("--gyro-x", parX.toFixed(2) + "px");
      document.documentElement.style.setProperty("--gyro-y", parY.toFixed(2) + "px");

      var t = now * 0.001;   /* tempo em segundos */
      var p = getPalette();
      var groundY = H * getGroundFrac();

      ctx.clearRect(0, 0, W, H);
      drawSky(p, groundY);
      drawStars(p, t);
      drawGround(p, groundY);
      drawTerrain(p, groundY, t);
      drawHaze(p, groundY);
      drawVignette();

      lastFrame = now;
      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);

    /* -----------------------------------------------------------------------
       Entradas: giroscópio
       ----------------------------------------------------------------------- */
    var hasGyro  = false;
    var baseB    = null;   /* calibração beta  */
    var baseG    = null;   /* calibração gamma */

    function onOrientation(evt) {
      var b = evt.beta  != null ? evt.beta  : 0;
      var g = evt.gamma != null ? evt.gamma : 0;

      if (baseB === null) { baseB = b; baseG = g; }

      var dB = b - baseB;   /* delta beta  (frente/trás) */
      var dG = g - baseG;   /* delta gamma (esq/dir)     */

      /* Azimute: inclinação lateral */
      rawAz = 180 + dG * CFG.GYRO_SENS_AZ;
      rawAz = ((rawAz % 360) + 360) % 360;

      /* Elevação: inclinação frente/trás (invertida: frente=cima) */
      rawEl = Math.max(-45, Math.min(45, dB * -CFG.GYRO_SENS_EL));

      /* Paralaxe das camadas HTML */
      var norm = CFG.PARALLAX_MAX;
      rawParX = -dG / 45 * norm;
      rawParY = -dB / 45 * norm * 0.6;

      if (!hasGyro) {
        hasGyro = true;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("wheel",     onWheel);
      }
    }

    /* iOS 13+: pedir permissão no primeiro toque */
    function activateGyro() {
      if (typeof DeviceOrientationEvent === "undefined") return;
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        document.addEventListener("touchend", function ask() {
          document.removeEventListener("touchend", ask);
          DeviceOrientationEvent.requestPermission()
            .then(function (s) {
              if (s === "granted") {
                window.addEventListener("deviceorientation", onOrientation, { passive: true });
              }
            })
            .catch(function () {});
        }, { once: true });
      } else {
        window.addEventListener("deviceorientation", onOrientation, { passive: true });
      }
    }
    activateGyro();

    /* -----------------------------------------------------------------------
       Entradas: mouse (arrastar para rotacionar)
       ----------------------------------------------------------------------- */
    var dragging   = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragAz0    = 180;
    var dragEl0    = 0;

    function onMouseDown(e) {
      if (e.button !== 0) return;
      dragging   = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragAz0    = rawAz;
      dragEl0    = rawEl;
    }

    function onMouseMove(e) {
      if (hasGyro) return;
      if (!dragging) {
        /* Movimento leve sem arrastar: paralaxe suave */
        var cx = window.innerWidth  / 2;
        var cy = window.innerHeight / 2;
        rawParX = (e.clientX - cx) / cx * CFG.PARALLAX_MAX;
        rawParY = (e.clientY - cy) / cy * CFG.PARALLAX_MAX * 0.55;
        return;
      }
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      rawAz = ((dragAz0 - dx * CFG.MOUSE_SENS) % 360 + 360) % 360;
      rawEl = Math.max(-45, Math.min(45, dragEl0 + dy * CFG.MOUSE_SENS * 0.5));
    }

    function onMouseUp()   { dragging = false; }
    function onMouseLeave() {
      dragging = false;
      if (!hasGyro) { rawParX = 0; rawParY = 0; }
    }

    function onWheel(e) {
      if (hasGyro) return;
      rawEl = Math.max(-45, Math.min(45, rawEl - e.deltaY * 0.05));
    }

    var skyCnv = canvas;
    skyCnv.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove",  onMouseMove, { passive: true });
    window.addEventListener("mouseup",    onMouseUp,   { passive: true });
    skyCnv.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("wheel",      onWheel,     { passive: true });

    /* -----------------------------------------------------------------------
       Entradas: touch (deslizar para rotacionar)
       ----------------------------------------------------------------------- */
    var touchAz0   = 180;
    var touchEl0   = 0;
    var touchStartX= 0;
    var touchStartY= 0;

    skyCnv.addEventListener("touchstart", function (e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchAz0    = rawAz;
      touchEl0    = rawEl;
    }, { passive: true });

    skyCnv.addEventListener("touchmove", function (e) {
      if (hasGyro) return;
      var dx = e.touches[0].clientX - touchStartX;
      var dy = e.touches[0].clientY - touchStartY;
      rawAz = ((touchAz0 - dx * CFG.MOUSE_SENS * 1.4) % 360 + 360) % 360;
      rawEl = Math.max(-45, Math.min(45, touchEl0 + dy * CFG.MOUSE_SENS * 0.7));
    }, { passive: true });

    /* -----------------------------------------------------------------------
       Entradas: teclado
       ----------------------------------------------------------------------- */
    window.addEventListener("keydown", function (e) {
      var step = 5;
      if (e.key === "ArrowLeft")  { rawAz = ((rawAz - step) % 360 + 360) % 360; }
      if (e.key === "ArrowRight") { rawAz = ((rawAz + step) % 360 + 360) % 360; }
      if (e.key === "ArrowUp")    { rawEl = Math.min(45, rawEl + step * 0.5); }
      if (e.key === "ArrowDown")  { rawEl = Math.max(-45, rawEl - step * 0.5); }
      if (e.key === "r" || e.key === "R") { rawAz = 180; rawEl = 0; baseB = null; baseG = null; }
    });

    /* -----------------------------------------------------------------------
       API pública
       ----------------------------------------------------------------------- */
    window.NovgorodSkyMap = {
      getAzimuth:   function () { return az; },
      getElevation: function () { return el; },
      setAzimuth:   function (a) { rawAz = ((a % 360) + 360) % 360; },
      setElevation: function (e) { rawEl = Math.max(-45, Math.min(45, e)); },
      recenter:     function () { rawAz = 180; rawEl = 0; }
    };
  }

  /* Garantir execução após o DOM */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
