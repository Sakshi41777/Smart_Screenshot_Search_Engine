// client/src/Welcome.js
import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import "./Welcome.css";

export default function Welcome() {
  const titleRef = useRef(null);
  const subRef = useRef(null);
  const btnRef = useRef(null);
  const fallingRef = useRef(null);
  const [message, setMessage] = useState("");

  const SAMPLE_IMAGES = [
    "/screenshots/ss1.png",
    "/screenshots/ss2.png",
    "/screenshots/ss3.png",
    "/screenshots/ss4.png",
  ];

  // Falling animation
  useEffect(() => {
    const container = fallingRef.current;
    if (!container) return;

    container.innerHTML = "";
    const items = [];
    const COUNT = 9;

    function spawn(i) {
      const img = document.createElement("img");
      img.className = "falling-img";
      img.src = SAMPLE_IMAGES[i % SAMPLE_IMAGES.length];
      container.appendChild(img);

      const startX = Math.random() * 100;
      const scale = 0.6 + Math.random() * 0.6;
      const rot = -25 + Math.random() * 50;

      gsap.set(img, { xPercent: startX, y: -150, scale, rotation: rot });

      gsap.to(img, {
        y: window.innerHeight + 300,
        rotation: rot + (Math.random() > 0.5 ? 60 : -60),
        duration: 6 + Math.random() * 6,
        repeat: -1,
        ease: "none",
        onRepeat: () => gsap.set(img, { xPercent: Math.random() * 100, y: -150 }),
      });

      items.push(img);
    }

    for (let i = 0; i < COUNT; i++) spawn(i);

    return () => {
      items.forEach((it) => it.remove());
    };
  }, []);

  // GSAP intro animation
  useEffect(() => {
    const a = titleRef.current;
    const b = subRef.current;
    const c = btnRef.current;

    const tl = gsap.timeline();
    gsap.set([a, b, c], { opacity: 0, y: 20 });

    tl.to(a, { opacity: 1, y: 0, duration: 0.6 })
      .to(b, { opacity: 1, y: 0, duration: 0.4 }, "-=0.3")
      .to(c, { opacity: 1, y: 0, duration: 0.4 }, "-=0.25");

    gsap.to(c, { scale: 1.04, duration: 1.2, repeat: -1, yoyo: true });

    return () => tl.kill();
  }, []);

  // Handle the button click
  async function handleClick() {
    gsap.fromTo(btnRef.current, { scale: 1 }, { scale: 0.92, duration: 0.08, yoyo: true, repeat: 1 });

    if (window?.electronAPI?.openPythonApp) {
      setMessage("Launching desktop application...");

      try {
        // startPythonApp(args) → Electron spawns Python → '--from-electron'
        const res = await window.electronAPI.openPythonApp({ args: ["--from-electron"] });
        console.log("Python app started:", res);
        setMessage("Desktop app opened!");
      } catch (err) {
        console.error(err);
        setMessage("Failed to launch Python app.");
      }

      return;
    }

    setMessage("Not running inside Electron. Use 'npm run dev'.");
  }

  return (
    <div className="welcome-mini-root">
      <div className="falling-back" ref={fallingRef} />

      <div className="center-stage">
        <h1 className="wm-title" ref={titleRef}>Welcome to Visual Memory Search</h1>

        <h2 className="wm-sub" ref={subRef}>- Smart Screenshot Search Engine</h2>

        <button
          className="wm-cta"
          ref={btnRef}
          onClick={handleClick}
        >
          Search Screenshots
        </button>

        {message && (
          <div style={{ marginTop: 14, color: "#cfe2ff" }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
