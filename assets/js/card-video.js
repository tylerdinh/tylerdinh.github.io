/*
 * Project-card videos (see _includes/projects.liquid, `video:` in a project's
 * front matter). They behave like GIFs: silent, looping, no controls. Each one
 * plays only while it is on screen, and never for visitors who prefer reduced
 * motion; they see the poster frame instead.
 */
(function () {
  "use strict";

  var videos = document.querySelectorAll("video[data-card-video]");
  if (!videos.length) return;

  var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduced = function () {
    return !!(motionQuery && motionQuery.matches);
  };
  var onScreen = new Set();

  function sync(video) {
    if (onScreen.has(video) && !reduced() && !document.hidden) {
      video.muted = true; // required for autoplay without a click
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () {});
    } else {
      video.pause();
    }
  }

  function syncAll() {
    videos.forEach(sync);
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
        sync(entry.target);
      });
    });
    videos.forEach(function (video) {
      observer.observe(video);
    });
  } else {
    videos.forEach(function (video) {
      onScreen.add(video);
    });
    syncAll();
  }

  document.addEventListener("visibilitychange", syncAll);
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncAll);
    else if (motionQuery.addListener) motionQuery.addListener(syncAll);
  }
})();
