---
layout: page
title: Nimble
description: Using embodied AI models to perform out-of-distribution generalization on human manipulation tasks for WashU Robotics.
img: assets/img/nimble-arm-still.jpg
video: assets/video/nimble-arm.mp4
video_width: 560
video_height: 478
importance: 1
category: clubs
related_publications: false
---

The robot of choice (Trossen Robotics' WidowX AI Follower) is shown below running a simple pick-and-place routine.

<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
</script>

<figure class="wxai-viewer" data-wxai-viewer>
  <img src="{{ '/assets/img/widowx-ai.jpg' | relative_url }}" alt="The Trossen WidowX AI robot arm" />
  <figcaption>
    <a href="https://github.com/TrossenRobotics/trossen_arm_description">Trossen Arm Description</a> used under the <a href="{{ '/assets/models/wxai/LICENSE' | relative_url }}">BSD 3-Clause license</a>.
  </figcaption>
</figure>

<script type="module" src="{{ '/assets/js/three/wxai-viewer.js' | relative_url }}"></script>
