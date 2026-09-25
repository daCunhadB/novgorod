/* ==========================================================================
   Casa Principesca de Novgorod — scripts
   Este arquivo é compartilhado por index.html e por todas as páginas de
   publicação (blog0001.html, blog0002.html, blog0003.html, ...). Cada
   página só precisa dos elementos com os IDs/classes usados abaixo; o
   script verifica a presença de cada um antes de usá-lo, então é seguro
   incluí-lo sem alterações em qualquer nova página do site.

   Índice geral:
   0. Detecção de capacidade gráfica — liga o tecido animado completo
      (#cloth-wave) apenas onde ele roda bem; nos demais aparelhos fica a
      versão leve (#cloth-wave-lite), já aplicada pelo CSS.
   1. Alternador de tema (claro/escuro) com persistência — também troca o
      avatar (<img id="avatarImg"> + <source id="avatarSource"> em WebP)
      quando presente na página.
   2. Barra de progresso de rolagem + paralaxe sutil da bandeira
   3. Revelação de elementos ao entrar na tela (classe .reveal), com
      escalonamento automático dentro de cada grupo
   4. Transição de saída ao navegar entre páginas do próprio site
   5. Compartilhamento das publicações do blog (Web Share API ou
      cópia do link para a área de transferência)
   ========================================================================== */

(function () {
  "use strict";

  var html = document.documentElement;
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var prefersReducedMotion = motionQuery.matches;

  /* ------------------------------------------------------------------
     0. Capacidade gráfica — tecido completo ou versão leve
     ------------------------------------------------------------------ */
  var qualityLocked = false;

  function evaluateSceneQuality() {
    if (qualityLocked) return;

    var cores = navigator.hardwareConcurrency || 4;
    var memory = navigator.deviceMemory || 4;
    var saveData = navigator.connection && navigator.connection.saveData;

    /* O flamular custa pouco: são três camadas pequenas em fusão cruzada,
       e há um jogo de quadros reduzido para telas menores. Por isso ele vale
       também em telefones — ficam de fora apenas os aparelhos declaradamente
       modestos, quem pediu economia de dados e quem prefere menos movimento. */
    var capable = !prefersReducedMotion && !saveData && (cores >= 4 || memory >= 4);

    html.classList.toggle("fx-full", !!capable);
  }

  evaluateSceneQuality();

  /* Guarda de desempenho: mede a taxa de quadros logo após o carregamento.
     Se a máquina não estiver dando conta do flamular, ele é desligado de
     vez (fica o quadro único) — vale mais uma página fluida do que uma
     bandeira animada engasgando. */
  function watchFrameRate() {
    if (!html.classList.contains("fx-full")) return;

    var frames = 0;
    var start = performance.now();

    function step(now) {
      frames++;
      if (now - start < 1400) {
        requestAnimationFrame(step);
        return;
      }
      var fps = frames / ((now - start) / 1000);
      if (fps < 24) {
        html.classList.remove("fx-full");
        qualityLocked = true;
      }
    }

    requestAnimationFrame(step);
  }

  window.addEventListener("load", function () {
    setTimeout(watchFrameRate, 900);
  });


  /* ------------------------------------------------------------------
     1b. Motor atmosférico — meteorologia + astronomia + localização real

     A cena usa três fontes complementares:
       • Geolocalização do navegador (watchPosition) para obter a posição
         atual com a melhor precisão disponível, sem persistir coordenadas;
       • Open-Meteo para clima atual, nuvens, chuva, visibilidade, vento e
         nascer/pôr do sol;
       • astronomia local calculada no cliente para posição aparente do
         Sol/Lua, fase lunar, escala visual e direção da luz.

     Sem permissão/rede, o site cai silenciosamente no modelo local anterior.
     O modo manual continua disponível para demonstração dos fenômenos.
     ------------------------------------------------------------------ */
  (function initAtmosphere() {
    var scene = document.querySelector(".scene");
    if (!scene) return;

    var rain = document.getElementById("sceneRain");
    var dust = document.getElementById("sceneDryDust");
    var lightning = document.getElementById("sceneLightning");
    var weatherToggle = document.getElementById("weatherToggle");
    var weatherPanel = document.getElementById("weatherPanel");
    var weatherMode = document.getElementById("weatherMode");
    var weatherReadout = document.getElementById("weatherReadout");
    var locationReadout = document.getElementById("locationReadout");
    var weatherDetails = document.getElementById("weatherDetails");
    var orb = scene.querySelector(".scene__orb");

    var WEATHER_KEY = "novgorod-weather-mode";
    var manualMode = "auto";
    var autoState = "clear";
    var lightningTimer = null;
    var cloudTimer = null;
    var weatherRefreshTimer = null;
    var locationWatchId = null;
    var fetchController = null;
    var lastWeatherFetch = 0;
    var rainCount = window.matchMedia("(max-width: 700px)").matches ? 50 : 88;
    var weatherState = {
      latitude: null,
      longitude: null,
      accuracy: null,
      current: null,
      daily: null,
      timezone: null,
      source: "simulado"
    };

    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }

    function rad(deg) { return deg * Math.PI / 180; }
    function deg(radValue) { return radValue * 180 / Math.PI; }
    function normalizeDeg(value) {
      return (value % 360 + 360) % 360;
    }
    function shortestAngleDiff(a, b) {
      var d = normalizeDeg(a - b + 180) - 180;
      return d;
    }

    function isSecureGeoContext() {
      return !!window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
      var dLat = rad(lat2 - lat1);
      var dLon = rad(lon2 - lon1);
      var a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function formatTime(value) {
      if (!value) return "--:--";
      var parts = String(value).split("T");
      return parts.length > 1 ? parts[1].slice(0, 5) : String(value);
    }

    function localNow() {
      return new Date();
    }

    function setReadout(text, detail) {
      if (weatherReadout) weatherReadout.textContent = text;
      if (weatherDetails) weatherDetails.textContent = detail || "";
    }

    function setLocationStatus(text) {
      if (locationReadout) locationReadout.textContent = text;
    }

    function setSceneTime(isDay) {
      html.setAttribute("data-scene-time", isDay ? "day" : "night");
      if (isDay) {
        scene.style.setProperty("--scene-cold-light", "rgba(188,222,255,.10)");
        scene.style.setProperty("--scene-warm-light", "rgba(255,213,146,.42)");
      } else {
        scene.style.setProperty("--scene-cold-light", "rgba(128,165,255,.24)");
        scene.style.setProperty("--scene-warm-light", "rgba(255,180,118,.10)");
      }
    }

    function makeParticles() {
      if (!rain || !dust) return;
      rain.textContent = "";
      dust.textContent = "";
      for (var i = 0; i < rainCount; i++) {
        var drop = document.createElement("span");
        drop.style.setProperty("--x", (Math.random() * 112 - 6).toFixed(2) + "%");
        drop.style.setProperty("--w", (Math.random() * 1.55 + 0.5).toFixed(2) + "px");
        drop.style.setProperty("--h", (Math.random() * 20 + 9).toFixed(1) + "px");
        drop.style.setProperty("--speed", (Math.random() * 1.55 + 0.62).toFixed(2) + "s");
        drop.style.setProperty("--delay", (-Math.random() * 4.5).toFixed(2) + "s");
        drop.style.setProperty("--angle", (-10 - Math.random() * 10).toFixed(1) + "deg");
        drop.style.setProperty("--drift", (Math.random() * 90 + 35).toFixed(0) + "px");
        drop.style.setProperty("--a", (0.16 + Math.random() * 0.54).toFixed(2));
        rain.appendChild(drop);
      }
    }

    function moonPhase(date) {
      var jd = date.getTime() / 86400000 + 2440587.5;
      var phase = ((jd - 2451550.09765) / 29.530588853) % 1;
      if (phase < 0) phase += 1;
      var illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
      return { phase: phase, illumination: illumination, age: phase * 29.530588853 };
    }

    /* Posição solar aparente (algoritmo compacto baseado no NOAA). */
    function sunPosition(date, lat, lon) {
      var jd = date.getTime() / 86400000 + 2440587.5;
      var n = jd - 2451545.0;
      var L = normalizeDeg(280.460 + 0.9856474 * n);
      var g = rad(normalizeDeg(357.528 + 0.9856003 * n));
      var lambda = rad(normalizeDeg(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)));
      var eps = rad(23.439 - 0.0000004 * n);
      var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
      var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
      var gmst = normalizeDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0));
      var H = rad(shortestAngleDiff(normalizeDeg(gmst + lon - deg(ra)), 0));
      var phi = rad(lat);
      var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
      var az = normalizeDeg(deg(Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H))) + 180);
      return { altitude: deg(alt), azimuth: az };
    }

    /* Lua: aproximação suficiente para animação/posição visual local.
       A fase é calculada independentemente com o mês sinódico. */
    function moonPosition(date, lat, lon) {
      var jd = date.getTime() / 86400000 + 2440587.5;
      var d = jd - 2451543.5;
      var N = rad(normalizeDeg(125.1228 - 0.0529538083 * d));
      var i = rad(5.1454);
      var w = rad(normalizeDeg(318.0634 + 0.1643573223 * d));
      var a = 60.2666;
      var e = 0.0549;
      var M = rad(normalizeDeg(115.3654 + 13.0649929509 * d));
      var E = M;
      for (var k = 0; k < 5; k++) E = M + e * Math.sin(E) * (1 + e * Math.cos(E));
      var xv = a * (Math.cos(E) - e);
      var yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));
      var v = Math.atan2(yv, xv);
      var r = Math.sqrt(xv * xv + yv * yv);
      var xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
      var yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
      var zh = r * (Math.sin(v + w) * Math.sin(i));
      var ecl = rad(23.4393);
      var xe = xh;
      var ye = yh * Math.cos(ecl) - zh * Math.sin(ecl);
      var ze = yh * Math.sin(ecl) + zh * Math.cos(ecl);
      var ra = Math.atan2(ye, xe);
      var dec = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye));
      var gmst = normalizeDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0));
      var H = rad(shortestAngleDiff(normalizeDeg(gmst + lon - deg(ra)), 0));
      var phi = rad(lat);
      var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
      var az = normalizeDeg(deg(Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H))) + 180);
      return { altitude: deg(alt), azimuth: az };
    }

    function updateOrbAndLight() {
      var date = localNow();
      var hasCoords = typeof weatherState.latitude === "number" && typeof weatherState.longitude === "number";
      var sun = hasCoords ? sunPosition(date, weatherState.latitude, weatherState.longitude) : null;
      var moon = hasCoords ? moonPosition(date, weatherState.latitude, weatherState.longitude) : null;
      var current = weatherState.current || {};
      var isDay = typeof current.is_day === "number" ? current.is_day === 1 : (sun ? sun.altitude > -0.35 : (date.getHours() >= 6 && date.getHours() < 18));
      setSceneTime(isDay);

      var astro = isDay ? sun : moon;
      if (!astro) astro = { altitude: isDay ? 55 : 30, azimuth: isDay ? 140 : 40 };

      var altitudeNorm = clamp((astro.altitude + 8) / 68, 0, 1);
      var size = 58 + altitudeNorm * 39;
      if (!isDay && weatherState.current && weatherState.current.cloud_cover > 80) size *= 0.92;
      var az = normalizeDeg(astro.azimuth);
      var x = 50 + Math.sin(rad(az)) * 34;
      var y = 12 + (1 - altitudeNorm) * 34;

      if (orb) {
        orb.style.setProperty("--orb-size", size.toFixed(1) + "px");
        orb.style.setProperty("--orb-x", x.toFixed(2) + "%");
        orb.style.setProperty("--orb-y", y.toFixed(2) + "%");
        orb.style.setProperty("--orb-altitude", astro.altitude.toFixed(2));
      }

      scene.style.setProperty("--light-angle", normalizeDeg(az + 90).toFixed(1) + "deg");
      scene.style.setProperty("--light-altitude", clamp(altitudeNorm, 0, 1).toFixed(3));
      var lightStrength = isDay ? clamp(0.42 + altitudeNorm * 0.58, .18, 1) : clamp(.18 + altitudeNorm * .22, .10, .42);
      scene.style.setProperty("--light-strength", lightStrength.toFixed(3));
      scene.style.setProperty("--shadow-strength", (0.16 + lightStrength * 0.34).toFixed(3));

      var phaseInfo = moonPhase(date);
      scene.style.setProperty("--moon-phase", phaseInfo.phase.toFixed(5));
      scene.style.setProperty("--moon-illumination", phaseInfo.illumination.toFixed(4));
      scene.style.setProperty("--moon-shadow-shift", ((0.5 - phaseInfo.phase) * 1.68).toFixed(4));
    }

    function setSky(p) {
      var isDay = html.getAttribute("data-scene-time") === "day";
      var base = isDay ? {
        sky1: p.sky1 || "#4b86c2",
        sky2: p.sky2 || "#78add8",
        sky3: p.sky3 || "#c4dced",
        ground: p.ground || "#e3d9c4"
      } : {
        sky1: p.sky1 || "#050a1a",
        sky2: p.sky2 || "#111a36",
        sky3: p.sky3 || "#3d4566",
        ground: p.ground || "#40394d"
      };
      var overlay = p.overlay || "rgba(255,255,255,0)";
      document.documentElement.style.setProperty(
        "--weather-body-bg",
        "radial-gradient(ellipse at 77% 10%, " + (isDay ? "rgba(255,238,180,.30)" : "rgba(110,140,210,.16)") + ", transparent 58%)," +
        "linear-gradient(180deg," + base.sky1 + " 0%," + base.sky2 + " 34%," + base.sky3 + " 67%," + base.ground + " 100%)"
      );
      document.documentElement.style.setProperty("--weather-overlay", overlay);
      document.documentElement.style.setProperty("--weather-ground", base.ground);
    }

    function modePreset(mode) {
      var isDay = html.getAttribute("data-scene-time") === "day";
      if (mode === "clear") return {
        sky1: isDay ? "#3f7cb8" : "#050a1a", sky2: isDay ? "#6ba3d6" : "#0b1226", sky3: isDay ? "#a8cdea" : "#34355a", ground: isDay ? "#e7dcc7" : "#4a3f52",
        cloud: isDay ? .34 : .20, brightness: isDay ? 1.06 : .44, saturation: isDay ? 1 : .52, contrast: 1.02, haze: isDay ? .07 : .025,
        groundTint: isDay ? "rgba(222,190,130,.11)" : "rgba(45,40,60,.10)", palace: isDay ? 1.03 : .28, palaceSat: isDay ? .84 : .44, lights: isDay ? 0 : .86,
        bands: [.22, .38, .10]
      };
      if (mode === "cloudy") return {
        sky1: isDay ? "#597b99" : "#11182c", sky2: isDay ? "#8399aa" : "#202943", sky3: isDay ? "#b6c1c7" : "#4a526b", ground: isDay ? "#b9b5aa" : "#454655",
        cloud: .86, brightness: isDay ? .80 : .30, saturation: .56, contrast: 1.08, haze: .28,
        groundTint: isDay ? "rgba(95,100,100,.16)" : "rgba(25,28,40,.18)", palace: isDay ? .78 : .24, palaceSat: .62, lights: isDay ? .08 : .90,
        bands: [.68, .88, .60]
      };
      if (mode === "rain") return {
        sky1: isDay ? "#3f566c" : "#080e1e", sky2: isDay ? "#657886" : "#151c31", sky3: isDay ? "#8d9ca3" : "#313a54", ground: isDay ? "#777a77" : "#343746",
        cloud: .96, brightness: isDay ? .62 : .23, saturation: .42, contrast: 1.18, haze: .44,
        groundTint: "rgba(55,65,70,.24)", palace: isDay ? .56 : .20, palaceSat: .50, lights: isDay ? .18 : .94,
        bands: [.84, .97, .80]
      };
      if (mode === "storm") return {
        sky1: "#080d1a", sky2: "#131e34", sky3: "#323b54", ground: "#2f303c",
        cloud: .99, brightness: .17, saturation: .28, contrast: 1.28, haze: .58,
        groundTint: "rgba(24,29,38,.38)", palace: .16, palaceSat: .35, lights: .99,
        bands: [.96, 1, .94]
      };
      return {
        sky1: isDay ? "#4e86a9" : "#141b2b", sky2: isDay ? "#9bb5b5" : "#303647", sky3: isDay ? "#d6caa8" : "#5a4e4a", ground: isDay ? "#c9ad72" : "#665443",
        cloud: .44, brightness: isDay ? .92 : .38, saturation: .78, contrast: 1.03, haze: .56,
        groundTint: "rgba(210,168,91,.27)", palace: isDay ? 1.06 : .34, palaceSat: .82, lights: isDay ? 0 : .80,
        bands: [.30, .42, .12]
      };
    }

    function applyLightAndWeather(mode) {
      var preset = modePreset(mode);
      setSky(preset);
      scene.style.setProperty("--weather-cloud-opacity", preset.cloud);
      scene.style.setProperty("--weather-cloud-brightness", preset.brightness);
      scene.style.setProperty("--weather-cloud-saturation", preset.saturation);
      scene.style.setProperty("--weather-cloud-contrast", preset.contrast);
      scene.style.setProperty("--weather-haze-opacity", preset.haze);
      scene.style.setProperty("--weather-ground-tint", preset.groundTint);
      scene.style.setProperty("--palace-brightness", preset.palace);
      scene.style.setProperty("--palace-saturation", preset.palaceSat);
      scene.style.setProperty("--palace-lights", preset.lights);
      scene.style.setProperty("--weather-vignette-opacity", mode === "storm" ? 1.14 : 1);

      var cloudBands = scene.querySelectorAll(".scene__clouds");
      cloudBands.forEach(function (band, index) {
        band.style.setProperty("--cloud-density", preset.bands[index] || .3);
        band.style.opacity = preset.bands[index] || .3;
      });

      var current = weatherState.current || {};
      var speed = Number(current.wind_speed_10m) || 7;
      var gust = Number(current.wind_gusts_10m) || speed;
      var direction = Number(current.wind_direction_10m);
      if (!isFinite(direction)) direction = 270;
      var speedFactor = clamp(.58 + speed / 22 + gust / 70, .65, 2.9);
      scene.style.setProperty("--weather-wind-factor", speedFactor.toFixed(3));
      scene.style.setProperty("--wind-bearing", direction.toFixed(1) + "deg");
      scene.style.setProperty("--wind-angle", normalizeDeg(direction + 180).toFixed(1) + "deg");
      scene.style.setProperty("--cloud-animation-direction", Math.sin(rad(direction)) >= 0 ? "normal" : "reverse");

      html.setAttribute("data-weather", mode);
      var labels = {
        clear: "Céu limpo · luz direta · sombras definidas",
        cloudy: "Nublado · luz difusa · camadas de nuvens calibradas",
        rain: "Chuva · alta cobertura de nuvens · atmosfera úmida",
        storm: "Tempestade · nuvens densas · relâmpagos intermitentes",
        drought: "Seca · ar quente · horizonte seco e poeira em suspensão"
      };
      var timeLabel = html.getAttribute("data-scene-time") === "day" ? "Dia" : "Noite";
      var sourceLabel = weatherState.source === "live" ? "dados locais em tempo real" : "modelo local de fallback";
      setReadout(timeLabel + " · " + labels[mode], sourceLabel);
      scheduleLightning(mode);
      updateOrbAndLight();
    }

    function modeFromLiveWeather() {
      var c = weatherState.current || {};
      var code = Number(c.weather_code);
      if ([95,96,99].indexOf(code) >= 0) return "storm";
      if ([51,53,55,56,57,61,63,65,66,67,80,81,82,85,86].indexOf(code) >= 0 || Number(c.rain) > 0.2 || Number(c.showers) > 0.2) return "rain";
      var cloud = Number(c.cloud_cover);
      var temp = Number(c.temperature_2m);
      if (cloud >= 88) return "cloudy";
      if (typeof temp === "number" && temp >= 31 && cloud < 45 && Number(c.precipitation) < 0.1) return "drought";
      if (cloud >= 38 || [1,2,3,45,48].indexOf(code) >= 0) return "cloudy";
      return "clear";
    }

    function chooseFallbackWeather() {
      var hour = localNow().getHours() + localNow().getMinutes() / 60;
      var wave = (Math.sin(Date.now() / 120000) + 1) / 2;
      if (hour >= 11 && hour <= 16 && wave > .76) return "drought";
      if (wave > .88) return "storm";
      if (wave > .64) return "rain";
      if (wave > .40) return "cloudy";
      return "clear";
    }

    function setFallback() {
      weatherState.source = "simulado";
      var date = localNow();
      /* Sem permissão de localização, não inventamos coordenadas. A cena
         continua funcionando com posição astronômica genérica e sincroniza
         imediatamente assim que watchPosition entregar uma posição real. */
      setSceneTime(date.getHours() >= 6 && date.getHours() < 18);
      if (!weatherState.current) weatherState.current = { wind_speed_10m: 7, wind_gusts_10m: 11, wind_direction_10m: 260 };
      if (manualMode === "auto") {
        autoState = chooseFallbackWeather();
        applyLightAndWeather(autoState);
      } else {
        applyLightAndWeather(manualMode);
      }
      setLocationStatus(isSecureGeoContext() ? "Aguardando permissão de localização…" : "Geolocalização exige HTTPS (ou localhost). Usando fallback.");
    }

    function scheduleLightning(mode) {
      if (lightningTimer) {
        clearTimeout(lightningTimer);
        lightningTimer = null;
      }
      if (!lightning || prefersReducedMotion || mode !== "storm") return;
      var delay = 3600 + Math.random() * 9400;
      lightningTimer = setTimeout(function () {
        lightning.classList.remove("is-flash");
        void lightning.offsetWidth;
        lightning.classList.add("is-flash");
        scheduleLightning(mode);
      }, delay);
    }

    function fetchLiveWeather() {
      if (typeof weatherState.latitude !== "number" || typeof weatherState.longitude !== "number") return Promise.resolve(false);
      var nowMs = Date.now();
      if (nowMs - lastWeatherFetch < 60000) return Promise.resolve(true);
      lastWeatherFetch = nowMs;
      if (fetchController) fetchController.abort();
      fetchController = new AbortController();
      var lat = weatherState.latitude.toFixed(6);
      var lon = weatherState.longitude.toFixed(6);
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
        "&longitude=" + lon +
        "&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,visibility,shortwave_radiation,direct_radiation,diffuse_radiation" +
        "&daily=sunrise,sunset,daylight_duration" +
        "&forecast_days=1&timezone=auto";
      setLocationStatus("Localização precisa obtida · atualizando meteorologia…");
      return fetch(url, { signal: fetchController.signal, headers: { "Accept": "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("weather-http-" + res.status);
          return res.json();
        })
        .then(function (data) {
          weatherState.current = data.current || {};
          weatherState.daily = data.daily || {};
          weatherState.timezone = data.timezone || null;
          weatherState.source = "live";
          var mode = manualMode === "auto" ? modeFromLiveWeather() : manualMode;
          autoState = modeFromLiveWeather();
          applyLightAndWeather(mode);
          var c = weatherState.current;
          var d = weatherState.daily;
          var temp = isFinite(Number(c.temperature_2m)) ? Number(c.temperature_2m).toFixed(1) + " °C" : "temperatura indisponível";
          var wind = isFinite(Number(c.wind_speed_10m)) ? Math.round(Number(c.wind_speed_10m)) + " km/h" : "vento indisponível";
          var cloud = isFinite(Number(c.cloud_cover)) ? Math.round(Number(c.cloud_cover)) + "% de nuvens" : "nuvens indisponíveis";
          var precip = Number(c.precipitation) || 0;
          var sunrise = d.sunrise && d.sunrise[0] ? formatTime(d.sunrise[0]) : "--:--";
          var sunset = d.sunset && d.sunset[0] ? formatTime(d.sunset[0]) : "--:--";
          setLocationStatus("Localização precisa · ±" + Math.round(Number(weatherState.accuracy) || 0) + " m · atualização dinâmica");
          setReadout((html.getAttribute("data-scene-time") === "day" ? "Dia" : "Noite") + " · " + (mode === "storm" ? "Tempestade" : mode === "rain" ? "Chuva" : mode === "cloudy" ? "Nublado" : mode === "drought" ? "Seca" : "Céu limpo"), "" + temp + " · " + wind + " · " + cloud + " · precipitação " + precip.toFixed(1) + " mm · nascer " + sunrise + " · pôr " + sunset);
          updateOrbAndLight();
          return true;
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return false;
          weatherState.source = "simulado";
          setLocationStatus("Localização obtida · API meteorológica indisponível, usando fallback visual.");
          applyLightAndWeather(manualMode === "auto" ? chooseFallbackWeather() : manualMode);
          return false;
        });
    }

    function onLocation(position) {
      var coords = position.coords || {};
      var lat = Number(coords.latitude);
      var lon = Number(coords.longitude);
      if (!isFinite(lat) || !isFinite(lon)) return;
      var moved = true;
      if (typeof weatherState.latitude === "number" && typeof weatherState.longitude === "number") {
        moved = haversineKm(weatherState.latitude, weatherState.longitude, lat, lon) > 0.12;
      }
      weatherState.latitude = lat;
      weatherState.longitude = lon;
      weatherState.accuracy = Number(coords.accuracy) || null;
      setLocationStatus("Localização precisa detectada · ±" + Math.round(weatherState.accuracy || 0) + " m");
      updateOrbAndLight();
      if (moved || !weatherState.current || Date.now() - lastWeatherFetch > 300000) fetchLiveWeather();
    }

    function onLocationError(error) {
      locationWatchId = null;
      var message = "Localização não autorizada · usando ciclo local";
      if (error && error.code === 2) message = "Localização indisponível · usando ciclo local";
      if (error && error.code === 3) message = "Tempo de localização excedido · tentando novamente em segundo plano";
      setLocationStatus(message);
      if (!weatherState.current) setFallback();
    }

    function startGeolocation() {
      if (!("geolocation" in navigator)) {
        setFallback();
        return;
      }
      if (!isSecureGeoContext()) {
        setFallback();
        return;
      }
      try {
        locationWatchId = navigator.geolocation.watchPosition(onLocation, onLocationError, {
          enableHighAccuracy: true,
          maximumAge: 60000,
          timeout: 15000
        });
      } catch (err) {
        setFallback();
      }
    }

    function syncThemeLighting() {
      var mode = manualMode === "auto" ? (weatherState.source === "live" ? modeFromLiveWeather() : chooseFallbackWeather()) : manualMode;
      applyLightAndWeather(mode);
      updateOrbAndLight();
    }

    makeParticles();
    try {
      var savedMode = localStorage.getItem(WEATHER_KEY);
      if (savedMode && ["auto","clear","cloudy","rain","storm","drought"].indexOf(savedMode) >= 0) manualMode = savedMode;
    } catch (err) {}
    if (weatherMode) weatherMode.value = manualMode;

    if (weatherToggle && weatherPanel) {
      weatherToggle.addEventListener("click", function () {
        if (weatherState.source !== "live" && locationWatchId === null) startGeolocation();
        var open = weatherToggle.getAttribute("aria-expanded") === "true";
        weatherToggle.setAttribute("aria-expanded", String(!open));
        weatherPanel.hidden = open;
      });
    }

    if (weatherMode) {
      weatherMode.addEventListener("change", function () {
        manualMode = weatherMode.value;
        try { localStorage.setItem(WEATHER_KEY, manualMode); } catch (err) {}
        syncThemeLighting();
      });
    }

    window.addEventListener("resize", function () {
      var nextCount = window.matchMedia("(max-width: 700px)").matches ? 50 : 88;
      if (nextCount !== rainCount) { rainCount = nextCount; makeParticles(); }
    }, { passive: true });

    cloudTimer = window.setInterval(function () {
      updateOrbAndLight();
      if (manualMode === "auto" && weatherState.source === "simulado") syncThemeLighting();
      else applyLightAndWeather(manualMode === "auto" ? modeFromLiveWeather() : manualMode);
    }, 30000);

    weatherRefreshTimer = window.setInterval(function () {
      if (weatherState.source === "live") fetchLiveWeather();
    }, 180000);

    window.addEventListener("beforeunload", function () {
      if (locationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);
      if (fetchController) fetchController.abort();
      if (cloudTimer) clearInterval(cloudTimer);
      if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
    });

    window.NovgorodWeather = {
      syncTheme: syncThemeLighting,
      refresh: fetchLiveWeather,
      getState: function () { return weatherState; }
    };

    setFallback();
    startGeolocation();
    updateOrbAndLight();
  })();

  /* ------------------------------------------------------------------
     1. Alternador de tema
     ------------------------------------------------------------------ */
  var THEME_KEY = "novgorod-theme";
  var themeToggle = document.getElementById("themeToggle");
  var avatarImg = document.getElementById("avatarImg");
  var avatarSource = document.getElementById("avatarSource");
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');

  var AVATAR_DARK = { png: "./assets/card.png", webp: "./assets/card.webp" };
  var AVATAR_LIGHT = {
    png: "./assets/brasao-pequenas-armas.png",
    webp: "./assets/brasao-pequenas-armas.webp"
  };

  function applyTheme(isLight) {
    html.classList.toggle("light", isLight);
    if (themeToggle) {
      themeToggle.setAttribute("aria-checked", String(isLight));
    }
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", isLight ? "#6ba3d6" : "#0b1226");
    }
    var avatar = isLight ? AVATAR_LIGHT : AVATAR_DARK;
    if (avatarImg) {
      avatarImg.src = avatar.png;
    }
    if (avatarSource) {
      avatarSource.srcset = avatar.webp;
    }
    if (window.NovgorodWeather) {
      window.NovgorodWeather.syncTheme();
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

    applyTheme(window.matchMedia("(prefers-color-scheme: light)").matches);
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
     2. Rolagem: barra de progresso, paralaxe da cena e VENTO

     A rolagem é o vento da cena. A velocidade com que a página corre vira
     --wind, que o CSS usa para acelerar o flamular da bandeira e a passagem
     das nuvens e para inclinar o mastro. O valor sobe depressa (a rajada
     chega junto com o gesto) e cai devagar (o vento amaina), com um piso de
     brisa para que a cena nunca fique parada.

     Tudo passa por duas variáveis apenas — --scroll-y e --wind — escritas
     no máximo uma vez por quadro; as camadas se movem por transform, sem
     repintura.
     ------------------------------------------------------------------ */
  var progressBanner = document.getElementById("progressBanner");

  var BREEZE = 0.85;        // brisa visual de repouso
  var GUST_MAX = 3.2;       // rajada visual máxima causada pela rolagem
  var weatherWindFactor = 1;
  var lastScroll = window.scrollY || 0;
  var lastTime = performance.now();
  var wind = BREEZE;
  var windTarget = BREEZE;
  var windLoop = null;
  var ticking = false;

  function writeWind() {
    var liveFactor = window.NovgorodWeather && window.NovgorodWeather.getState ? (Number(window.NovgorodWeather.getState().current && window.NovgorodWeather.getState().current.wind_speed_10m) || 7) : 7;
    weatherWindFactor = Math.max(0.65, Math.min(2.9, 0.58 + liveFactor / 22));
    html.style.setProperty("--wind", (wind * weatherWindFactor).toFixed(3));
    html.style.setProperty("--scroll-wind-boost", Math.max(0, wind - BREEZE).toFixed(3));
  }

  function updateOnScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

    if (progressBanner) {
      progressBanner.style.width = Math.min(100, Math.max(0, progress)) + "%";
    }

    html.style.setProperty("--scroll-y", prefersReducedMotion ? "0" : scrollTop.toFixed(1));

    if (!prefersReducedMotion) {
      var now = performance.now();
      var dt = Math.max(16, now - lastTime);
      var speed = Math.abs(scrollTop - lastScroll) / dt;    // px por ms
      lastScroll = scrollTop;
      lastTime = now;

      windTarget = Math.min(GUST_MAX, BREEZE + speed * 0.55);
      startWindLoop();
    }

    ticking = false;
  }

  /* O vento tem inércia própria: continua correndo alguns instantes depois
     que a rolagem parou, até voltar à brisa. */
  function startWindLoop() {
    if (windLoop !== null) return;

    var step = function () {
      // sobe rápido, desce devagar — é assim que uma rajada se comporta
      var rate = windTarget > wind ? 0.22 : 0.035;
      wind += (windTarget - wind) * rate;
      windTarget += (BREEZE - windTarget) * 0.04;
      writeWind();

      if (Math.abs(wind - BREEZE) < 0.01 && Math.abs(windTarget - BREEZE) < 0.01) {
        wind = BREEZE;
        windTarget = BREEZE;
        writeWind();
        windLoop = null;
        return;
      }
      windLoop = window.requestAnimationFrame(step);
    };

    windLoop = window.requestAnimationFrame(step);
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(updateOnScroll);
      ticking = true;
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  if (!prefersReducedMotion) {
    writeWind();
    /* Uma rajada de boas-vindas ao abrir a página */
    windTarget = 1.6;
    startWindLoop();
  }

  /* ------------------------------------------------------------------
     3. Revelação de elementos ao entrar na tela
     ------------------------------------------------------------------ */
  var revealTargets = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var sweepTimer = null;

  /* Escalonamento automático: cada elemento recebe o seu índice dentro do
     grupo de irmãos .reveal, para que grades (publicações, links, vídeos)
     apareçam em cascata sem regras :nth-child() escritas à mão. */
  function assignStagger() {
    var groups = new Map();

    revealTargets.forEach(function (el) {
      var parent = el.parentElement || document.body;
      var index = groups.get(parent) || 0;
      groups.set(parent, index + 1);
      el.style.setProperty("--reveal-i", String(Math.min(index, 8)));
    });
  }

  if (revealTargets.length) {
    assignStagger();
  }

  function revealAll() {
    revealTargets.forEach(function (target) {
      target.classList.add("is-visible");
    });
  }

  if (prefersReducedMotion) {
    revealAll();
  } else if ("IntersectionObserver" in window && revealTargets.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          /* Além dos elementos que entram na tela, revelamos também os que
             já ficaram para trás (topo acima da janela) — do contrário, um
             salto de rolagem, uma âncora (#blog) ou a volta pelo histórico
             deixariam blocos inteiros permanentemente invisíveis. */
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      /* Sem limiar percentual: publicações longas podem ser mais altas que a
         própria janela e nunca atingiriam 15% de interseção, ficando
         permanentemente invisíveis (opacity: 0). O rootMargin negativo na
         base mantém o efeito de "revelar ao subir a página". */
      { threshold: 0, rootMargin: "0px 0px -12% 0px" }
    );

    revealTargets.forEach(function (target) {
      observer.observe(target);
    });

    /* Rede de segurança: qualquer elemento que já esteja na tela (ou acima
       dela) é revelado, mesmo que o observador não tenha sido acionado. */
    var sweep = function () {
      revealTargets.forEach(function (target) {
        if (target.classList.contains("is-visible")) return;
        var rect = target.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.98) {
          target.classList.add("is-visible");
        }
      });
    };

    window.addEventListener("load", function () {
      setTimeout(sweep, 350);
    });
    window.addEventListener("hashchange", function () {
      setTimeout(sweep, 120);
    });
    window.addEventListener("scroll", function () {
      if (sweepTimer) clearTimeout(sweepTimer);
      sweepTimer = setTimeout(sweep, 220);
    }, { passive: true });
  } else {
    revealAll();
  }

  /* ------------------------------------------------------------------
     4. Transição de saída entre páginas do site
     ------------------------------------------------------------------ */
  if (!prefersReducedMotion) {
    document.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest && event.target.closest("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      var url;
      try {
        url = new URL(link.href, window.location.href);
      } catch (err) {
        return;
      }

      if (url.origin !== window.location.origin) return;
      /* Âncora na própria página: deixa a rolagem suave do CSS agir */
      if (url.pathname === window.location.pathname && url.hash) return;
      if (url.href === window.location.href) return;

      event.preventDefault();
      document.body.classList.add("is-leaving");
      setTimeout(function () {
        window.location.href = url.href;
      }, 240);
    });

    /* Ao voltar pelo histórico, o navegador pode restaurar a página já com
       a classe de saída aplicada — limpa-a. */
    window.addEventListener("pageshow", function () {
      document.body.classList.remove("is-leaving");
    });
  }

  /* ------------------------------------------------------------------
     5. Compartilhamento das publicações do blog
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

  Array.prototype.forEach.call(document.querySelectorAll(".share-btn"), function (button) {
    button.addEventListener("click", function () {
      var post = button.closest("[data-share-url]");
      var title = (post && post.dataset.shareTitle) || document.title;
      var url = (post && post.dataset.shareUrl) || window.location.href;

      if (navigator.share) {
        navigator
          .share({ title: title, url: url })
          .catch(function () {
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

  /* ------------------------------------------------------------------
     Reavaliações em mudanças de contexto (giro de tela, redimensionamento,
     preferência de movimento)
     ------------------------------------------------------------------ */
  var resizeTimer = null;
  window.addEventListener(
    "resize",
    function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        evaluateSceneQuality();
        updateOnScroll();
      }, 180);
    },
    { passive: true }
  );

  window.addEventListener("orientationchange", function () {
    setTimeout(updateOnScroll, 260);
  });

  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", function (event) {
      prefersReducedMotion = event.matches;
      evaluateSceneQuality();
      if (prefersReducedMotion) revealAll();
    });
  }

  updateOnScroll();

  /* ========================================================================
     6. GIROSCÓPIO + PARALAXE 360°
     ========================================================================

     Objetivo: o celular inclinado para qualquer lado desloca as camadas da
     cena como se fossem planos físicos a distâncias diferentes do usuário —
     exatamente o efeito do wallpaper 3D do iOS. Cada .scene__layer tem um
     atributo data-depth (0 = fundo, 1 = frente); o deslocamento é proporcional.

     Fontes do ângulo:
       • DeviceOrientationEvent (giroscópio real, mobile)  — preferida
       • mousemove normalizado (desktop / fallback)

     Nenhum estado é armazenado: toda a física é processada em rAF.
  ======================================================================== */
  (function initGyro() {
    if (prefersReducedMotion) return;

    /* ----- Coleta as camadas uma vez ----- */
    var layers = Array.prototype.slice.call(
      document.querySelectorAll(".scene__layer")
    ).map(function (el) {
      return {
        el: el,
        depth: parseFloat(el.getAttribute("data-depth") || "0.3")
      };
    });

    if (!layers.length) return;

    /* ----- Estado do giroscópio ----- */
    /* tiltX: inclinação frente/trás (beta); tiltY: esq/dir (gamma) */
    var tiltX = 0, tiltY = 0;           /* valores suavizados atuais */
    var rawX  = 0, rawY  = 0;           /* valores brutos do sensor  */
    var baseX = null, baseY = null;     /* calibração no primeiro evento */
    var hasGyro = false;
    var rafId   = null;

    /* Intensidade máxima de deslocamento em px para profundidade 1.0 */
    var MAX_PX = 38;

    /* ----- Aplica o paralaxe em todas as camadas ----- */
    function applyParallax() {
      /* Lerp suave: responde rápido, desacelera elegante */
      tiltX += (rawX - tiltX) * 0.10;
      tiltY += (rawY - tiltY) * 0.10;

      var settled = (
        Math.abs(rawX - tiltX) < 0.08 &&
        Math.abs(rawY - tiltY) < 0.08
      );

      layers.forEach(function (layer) {
        var dx = tiltY * MAX_PX * layer.depth;
        var dy = tiltX * MAX_PX * layer.depth;
        layer.el.style.transform =
          "translate3d(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px,0)";
      });

      if (settled) {
        rafId = null;
      } else {
        rafId = requestAnimationFrame(applyParallax);
      }
    }

    function scheduleFrame() {
      if (!rafId) rafId = requestAnimationFrame(applyParallax);
    }

    /* ----- Giroscópio real (Android / iOS) ----- */
    function onOrientation(evt) {
      /* beta  → inclinação frente/trás  −180 … 180
         gamma → inclinação esq/dir      −90  … 90  */
      var b = evt.beta  != null ? evt.beta  : 0;
      var g = evt.gamma != null ? evt.gamma : 0;

      /* Calibrar na primeira leitura */
      if (baseX === null) { baseX = b; baseY = g; }

      /* Diferença da posição neutra, normalizada para −1 … 1 */
      rawX = Math.max(-1, Math.min(1, (b - baseX) / 45));
      rawY = Math.max(-1, Math.min(1, (g - baseY) / 45));

      scheduleFrame();
    }

    /* ----- Solicitar permissão (iOS 13+) ----- */
    function startGyro() {
      if (typeof DeviceOrientationEvent === "undefined") return false;

      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        /* iOS 13+: precisa de gesto do usuário */
        document.addEventListener("touchend", function askOnce() {
          document.removeEventListener("touchend", askOnce);
          DeviceOrientationEvent.requestPermission()
            .then(function (state) {
              if (state === "granted") {
                window.addEventListener("deviceorientation", onOrientation, { passive: true });
                hasGyro = true;
              }
            })
            .catch(function () {});
        }, { once: true });
        return true; /* Aguarda gesto; mouse cobre o intervalo */
      }

      /* Android / iOS < 13: permissão implícita */
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
      hasGyro = true;
      return true;
    }

    var gyroAvailable = startGyro();

    /* ----- Fallback: mouse simula giroscópio em desktop ----- */
    function onMouse(evt) {
      if (hasGyro) return; /* Giroscópio real assumiu o controle */
      var cx = window.innerWidth  / 2;
      var cy = window.innerHeight / 2;
      rawY = (evt.clientX - cx) / cx;   /* −1 a 1 horizontal */
      rawX = (evt.clientY - cy) / cy * -1; /* −1 a 1 vertical, invertido */
      scheduleFrame();
    }

    window.addEventListener("mousemove", onMouse, { passive: true });

    /* Ao sair do mouse, retornar suavemente ao centro */
    window.addEventListener("mouseleave", function () {
      if (hasGyro) return;
      rawX = 0; rawY = 0;
      scheduleFrame();
    }, { passive: true });

    /* Re-aplicar ao rolar (scroll muda translateY via --scroll-y no CSS,
       mas não interfere com o transform do giroscópio — são propriedades
       diferentes no inspector, mas o compositor combina os dois) */
    window.addEventListener("scroll", scheduleFrame, { passive: true });

    /* Primeiro frame */
    scheduleFrame();
  })();


  /* ========================================================================
     7. CANVAS PANORÂMICO 360°

     Um canvas fixo atrás da cena principal (`z-index: -4`) exibe o entorno
     de Novgorod em 360° horizontais. O giroscópio rotaciona o ponto de
     vista, dando a sensação de estar *dentro* da cena, não apenas olhando
     para ela.

     O canvas é pintado inteiramente em código — sem imagens externas —
     usando gradientes e formas geométricas simples para representar:
       • céu degradê (noite ↔ dia, sincronizado com data-scene-time)
       • floresta de pinheiros (taiga ao norte, leste e oeste)
       • Rio Volkhov (segmento leste com reflexo)
       • silhueta de aldeia (segmento sul e sudeste)
       • névoa de horizonte

     O azimute (0–360°) é lido da variável compartilhada window._gyroAz,
     que o bloco de giroscópio (seção 6) atualiza em cada quadro. Em
     dispositivos sem giroscópio, o mouse controla o azimute.
  ======================================================================== */
  (function initPanorama() {
    if (prefersReducedMotion) return;

    var canvas = document.getElementById("panCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    var W = 0, H = 0;
    var az = 0;           /* azimute atual suavizado (graus) */
    var rawAz = 0;        /* azimute alvo (bruto do sensor/mouse) */
    var hasGyroAz = false;

    /* Graus horizontais visíveis de cada vez */
    var FOV = 100;

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize, { passive: true });

    /* ---- Utilitários ---- */
    function lerp(a, b, t) { return a + (b - a) * t; }
    function lerpColor(c1, c2, t) {
      return [
        Math.round(lerp(c1[0], c2[0], t)),
        Math.round(lerp(c1[1], c2[1], t)),
        Math.round(lerp(c1[2], c2[2], t))
      ];
    }
    function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }
    function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

    /* ---- Paleta dinâmica sincronizada com tema/clima ---- */
    function palette() {
      var isDay = html.getAttribute("data-scene-time") === "day";
      var isLight = html.classList.contains("light");
      var weather = html.getAttribute("data-weather") || "clear";

      if (isDay) {
        var skyTop    = weather === "storm"  ? [20,25,40]    :
                        weather === "rain"   ? [55,72,95]    :
                        weather === "cloudy" ? [75,100,130]  : [45,98,180];
        var skyHoriz  = weather === "storm"  ? [35,38,52]    :
                        weather === "rain"   ? [88,100,120]  :
                        weather === "cloudy" ? [140,155,170] : [135,185,230];
        var groundCol = weather === "drought"? [140,118,72]  :
                        weather === "rain"   ? [62,70,65]    : [90,100,72];
        var waterCol  = [55,90,140];
        var treeCol   = [30,52,22];
        var treeDark  = [18,35,14];
        var hazeCol   = [200,215,230];
      } else {
        var skyTop    = [4,7,18];
        var skyHoriz  = [15,22,45];
        var groundCol = [22,18,12];
        var waterCol  = [16,24,48];
        var treeCol   = [12,20,8];
        var treeDark  = [6,12,4];
        var hazeCol   = [30,35,55];
      }

      return { skyTop: skyTop, skyHoriz: skyHoriz, groundCol: groundCol,
               waterCol: waterCol, treeCol: treeCol, treeDark: treeDark,
               hazeCol: hazeCol, isDay: isDay };
    }

    /* ---- Converte graus do mundo para pixels X na tela ---- */
    function worldToX(worldDeg) {
      /* Diferença angular normalizada para −180 … 180 */
      var diff = worldDeg - az;
      while (diff >  180) diff -= 360;
      while (diff < -180) diff += 360;
      return W / 2 + (diff / FOV) * W;
    }

    /* Largura em pixels de um arco de angleDeg graus */
    function arcW(angleDeg) { return (angleDeg / FOV) * W; }

    /* ---- Renderização do panorama ---- */
    function draw() {
      if (!ctx) return;
      var p = palette();
      var groundY = H * 0.60;

      /* --- Céu degradê --- */
      var skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
      skyGrad.addColorStop(0,    rgb(p.skyTop));
      skyGrad.addColorStop(0.65, rgb(p.skyHoriz));
      skyGrad.addColorStop(1,    rgba(p.hazeCol, 0.6));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, groundY);

      /* --- Solo --- */
      var groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
      groundGrad.addColorStop(0,   rgb(p.groundCol));
      groundGrad.addColorStop(0.4, rgb(lerpColor(p.groundCol, [12,10,6], 0.5)));
      groundGrad.addColorStop(1,   rgb([8,7,4]));
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY, W, H - groundY);

      /* --- Floresta de pinheiros (norte: 330–360 e 0–60; leste: 80–120; oeste: 220–280) --- */
      var forests = [
        { azStart: 330, azEnd: 420, density: 22, hMax: 0.22, hMin: 0.12 }, /* Norte */
        { azStart:  80, azEnd: 120, density: 16, hMax: 0.18, hMin: 0.10 }, /* Leste */
        { azStart: 220, azEnd: 282, density: 18, hMax: 0.20, hMin: 0.11 }, /* Oeste */
        { azStart: 140, azEnd: 180, density: 10, hMax: 0.13, hMin: 0.08 }, /* SE esparso */
      ];

      forests.forEach(function (f) {
        var step = (f.azEnd - f.azStart) / f.density;
        for (var i = 0; i < f.density; i++) {
          var treeAz = f.azStart + i * step + (i * 7.3 % step * 0.4);
          var x = worldToX(treeAz);
          if (x < -80 || x > W + 80) continue;

          var t = (i / f.density);
          var treeH = lerp(f.hMin, f.hMax, 0.5 + Math.sin(i * 1.7) * 0.5) * H;
          var treeBase = groundY + 2;
          var treeTop  = groundY - treeH;
          var treeW    = treeH * 0.38;

          /* Tronco */
          ctx.fillStyle = rgba([60,40,20], 0.7);
          ctx.fillRect(x - 1.5, treeBase - treeH * 0.25, 3, treeH * 0.28);

          /* 3 camadas de copa cônica */
          for (var lev = 2; lev >= 0; lev--) {
            var layerT  = lev / 3;
            var layerY  = treeTop + treeH * layerT * 0.55;
            var layerW  = treeW   * (1 - layerT * 0.4);
            var layerH  = treeH   * 0.42;
            var col     = lev === 0 ? p.treeCol : (lev === 1 ? lerpColor(p.treeCol, p.treeDark, 0.4) : p.treeDark);
            ctx.fillStyle = rgba(col, 0.82);
            ctx.beginPath();
            ctx.moveTo(x - layerW / 2, layerY + layerH);
            ctx.lineTo(x,              layerY);
            ctx.lineTo(x + layerW / 2, layerY + layerH);
            ctx.closePath();
            ctx.fill();
          }
        }
      });

      /* --- Rio Volkhov (leste: 85–110°) --- */
      var riverAzStart = 85, riverAzEnd = 112;
      var rx1 = worldToX(riverAzStart);
      var rx2 = worldToX(riverAzEnd);
      if (rx2 > 0 && rx1 < W) {
        rx1 = Math.max(0, rx1);
        rx2 = Math.min(W, rx2);
        /* Corpo do rio */
        var riverGrad = ctx.createLinearGradient(rx1, 0, rx2, 0);
        riverGrad.addColorStop(0,   rgba(p.waterCol, 0.3));
        riverGrad.addColorStop(0.3, rgba(p.waterCol, 0.9));
        riverGrad.addColorStop(0.7, rgba(p.waterCol, 0.9));
        riverGrad.addColorStop(1,   rgba(p.waterCol, 0.3));
        ctx.fillStyle = riverGrad;
        ctx.fillRect(rx1, groundY, rx2 - rx1, H * 0.12);

        /* Reflexo de luz */
        if (p.isDay) {
          ctx.fillStyle = rgba([200,220,255], 0.12);
          ctx.fillRect(rx1 + (rx2 - rx1) * 0.3, groundY + 2, (rx2 - rx1) * 0.4, 4);
        }
      }

      /* --- Aldeia / casas simples (sul: 160–200°) --- */
      var houseAzList = [162,168,174,180,186,192,198];
      houseAzList.forEach(function (haz, i) {
        var hx = worldToX(haz);
        if (hx < -30 || hx > W + 30) return;
        var hw = 18 + i % 3 * 8;
        var hh = (0.07 + i % 4 * 0.015) * H;
        var hy = groundY - hh;
        var wallCol = p.isDay ? [82,64,38] : [35,28,16];
        var roofCol = p.isDay ? [62,52,34] : [28,22,12];
        ctx.fillStyle = rgba(wallCol, 0.88);
        ctx.fillRect(hx - hw / 2, hy, hw, hh);
        /* Telhado */
        ctx.fillStyle = rgba(roofCol, 0.9);
        ctx.beginPath();
        ctx.moveTo(hx - hw / 2 - 3, hy);
        ctx.lineTo(hx, hy - hh * 0.5);
        ctx.lineTo(hx + hw / 2 + 3, hy);
        ctx.closePath();
        ctx.fill();
        /* Janela (à noite brilha) */
        if (!p.isDay) {
          ctx.fillStyle = rgba([255,200,80], 0.72);
          ctx.fillRect(hx - 3, hy + hh * 0.3, 6, 8);
        }
      });

      /* --- Névoa do horizonte --- */
      var hazeGrad = ctx.createLinearGradient(0, groundY - H * 0.12, 0, groundY + H * 0.08);
      hazeGrad.addColorStop(0, rgba(p.hazeCol, 0));
      hazeGrad.addColorStop(0.5, rgba(p.hazeCol, 0.18));
      hazeGrad.addColorStop(1, rgba(p.hazeCol, 0.05));
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, groundY - H * 0.12, W, H * 0.20);

      /* --- Vinheta lateral (suaviza emendas do panorama) --- */
      var vLeft = ctx.createLinearGradient(0, 0, W * 0.12, 0);
      vLeft.addColorStop(0, rgba([0,0,0], 0.38));
      vLeft.addColorStop(1, rgba([0,0,0], 0));
      ctx.fillStyle = vLeft;
      ctx.fillRect(0, 0, W * 0.12, H);

      var vRight = ctx.createLinearGradient(W * 0.88, 0, W, 0);
      vRight.addColorStop(0, rgba([0,0,0], 0));
      vRight.addColorStop(1, rgba([0,0,0], 0.38));
      ctx.fillStyle = vRight;
      ctx.fillRect(W * 0.88, 0, W * 0.12, H);
    }

    /* ---- Loop de animação ---- */
    var lastAzTime = performance.now();
    var windDrift = 0;

    function loop(now) {
      var dt = now - lastAzTime;
      lastAzTime = now;

      /* Drift lento do vento (desloca o panorama com as nuvens) */
      var windVal = parseFloat(html.style.getPropertyValue("--wind")) || 1;
      windDrift += dt * 0.004 * (windVal - 0.8);

      /* Lerp suave do azimute */
      var target = rawAz + windDrift;
      var diff = target - az;
      while (diff >  180) diff -= 360;
      while (diff < -180) diff += 360;
      az += diff * 0.055;
      az  = ((az % 360) + 360) % 360;

      draw();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    /* ---- Integrar com o giroscópio (seção 6) ---- */
    /* O bloco de giroscópio publica rawX/rawY como window._gyroState.
       Aqui convertemos rawY (−1…1) em azimute (0-360°). */
    window._gyroState = window._gyroState || { x: 0, y: 0 };

    /* Substituir o onOrientation da seção 6 para também atualizar rawAz */
    var _origOrientation = window._onGyroOrientation;
    window._onGyroOrientation = function (b, g) {
      if (_origOrientation) _origOrientation(b, g);
      /* gamma −90…90 → azimute 90…270 (centro sul = 180°) */
      rawAz = 180 + g * 2.2;
      hasGyroAz = true;
    };

    /* Mouse: arrastar horizontalmente muda o azimute */
    var mouseAzBase = 180;
    var lastMouseX = null;
    window.addEventListener("mousemove", function (evt) {
      if (hasGyroAz) return;
      if (lastMouseX !== null) {
        var dx = evt.clientX - lastMouseX;
        rawAz -= dx * (FOV / W) * 0.6;
        rawAz  = ((rawAz % 360) + 360) % 360;
      }
      lastMouseX = evt.clientX;
    }, { passive: true });

    window.addEventListener("mouseleave", function () {
      lastMouseX = null;
    });

    /* Touch: deslize horizontal rotaciona o panorama */
    var lastTouchX = null;
    window.addEventListener("touchstart", function (e) {
      lastTouchX = e.touches[0].clientX;
    }, { passive: true });
    window.addEventListener("touchmove", function (e) {
      if (lastTouchX === null || hasGyroAz) return;
      var dx = e.touches[0].clientX - lastTouchX;
      lastTouchX = e.touches[0].clientX;
      rawAz -= dx * (FOV / W) * 1.1;
      rawAz  = ((rawAz % 360) + 360) % 360;
    }, { passive: true });
    window.addEventListener("touchend", function () { lastTouchX = null; }, { passive: true });
  })();

})();
