// ════════════════════════════════════════════════════════════
// THEME.JS — Açık / Koyu tema yönetimi (tüm sayfalarda ortak)
//
// KULLANIM:
// 1) Bu dosyayı her sayfanın <head> içinde, base.css'ten HEMEN
//    ÖNCE ve mümkünse en üstte <script> ile yükleyin. Böylece
//    tema, sayfa boyanmadan önce uygulanır ve "yanlış temayla
//    yanıp sönme" (FOUC) olmaz:
//
//    <script src="/static/js/theme.js"></script>
//    <link rel="stylesheet" href="/static/css/base.css">
//    ...
//
// 2) Navbar'a şu butonu ekleyin (herhangi bir yere koyabilirsiniz,
//    id ve class'lar sabit kalmalı):
//
//    <button id="theme-toggle-btn" class="theme-toggle-btn" type="button"
//            aria-label="Temayı değiştir" title="Açık/Koyu tema">
//        <i class="fa-solid fa-moon"></i>
//    </button>
//
// 3) Canvas ile çizim yapan sayfalarda (topology.js, speed_test.js)
//    tema değiştiğinde yeniden çizim yapmak için şunu dinleyin:
//
//    window.addEventListener('np-theme-change', () => draw());
// ════════════════════════════════════════════════════════════

(function () {
    "use strict";

    var STORAGE_KEY = "np-theme"; // 'dark' | 'light'

    function getStoredTheme() {
        try {
            return window.localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null; // localStorage kapalıysa (gizli sekme vb.) sessizce yoksay
        }
    }

    function storeTheme(theme) {
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {
            /* yoksay */
        }
    }

    function systemPrefersLight() {
        return (
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: light)").matches
        );
    }

    function currentTheme() {
        return document.documentElement.getAttribute("data-theme") === "light"
            ? "light"
            : "dark";
    }

    // ── Temayı hemen uygula (DOM henüz hazır olmasa da <html> mevcut) ──
    function applyTheme(theme, opts) {
        var silent = opts && opts.silent;
        if (theme === "light") {
            document.documentElement.setAttribute("data-theme", "light");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
        updateToggleButton(theme);
        if (!silent) {
            window.dispatchEvent(
                new CustomEvent("np-theme-change", { detail: { theme: theme } })
            );
        }
    }

    function updateToggleButton(theme) {
        var btn = document.getElementById("theme-toggle-btn");
        if (!btn) return;
        var icon = btn.querySelector("i");
        if (icon) {
            icon.classList.remove("fa-sun", "fa-moon");
            icon.classList.add(theme === "light" ? "fa-sun" : "fa-moon");
        }
        btn.setAttribute(
            "aria-label",
            theme === "light" ? "Koyu temaya geç" : "Açık temaya geç"
        );
        btn.classList.toggle("is-light", theme === "light");
    }

    function toggleTheme() {
        var next = currentTheme() === "light" ? "dark" : "light";
        storeTheme(next);
        applyTheme(next);
    }

    // ── İlk uygulama: kayıtlı tercih > sistem tercihi > koyu (varsayılan) ──
    var initial = getStoredTheme() || (systemPrefersLight() ? "light" : "dark");
    applyTheme(initial, { silent: true });

    // ── Buton bağlama + kayıtlı tercih yoksa sistem değişikliklerini izleme ──
    document.addEventListener("DOMContentLoaded", function () {
        updateToggleButton(currentTheme());

        var btn = document.getElementById("theme-toggle-btn");
        if (btn) {
            btn.addEventListener("click", toggleTheme);
        }

        if (!getStoredTheme() && window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: light)").addEventListener(
                "change",
                function (e) {
                    if (getStoredTheme()) return; // kullanıcı elle seçtiyse sistemi izleme
                    applyTheme(e.matches ? "light" : "dark");
                }
            );
        }
    });

    // Dışarıya (konsoldan veya diğer scriptlerden) erişim için
    window.NPTheme = {
        get: currentTheme,
        set: function (theme) {
            storeTheme(theme);
            applyTheme(theme);
        },
        toggle: toggleTheme,
    };
})();
