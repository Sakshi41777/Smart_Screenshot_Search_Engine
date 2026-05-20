// client/src/Welcome.js
import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useNavigate } from "react-router-dom";
import "./Welcome.css";

/* Static images for falling animation */
const SAMPLE_IMAGES = [
  `${process.env.PUBLIC_URL}/screenshots/ss1.png`,
  `${process.env.PUBLIC_URL}/screenshots/ss2.png`,
  `${process.env.PUBLIC_URL}/screenshots/ss3.png`,
  `${process.env.PUBLIC_URL}/screenshots/ss4.png`,
];

export default function Welcome({ onAuth }) {
  const navigate = useNavigate();

  const titleRef = useRef(null);
  const subRef = useRef(null);
  const btnRef = useRef(null);
  const fallingRef = useRef(null);
  const [showOptions, setShowOptions] = useState(false);

  /* ---------- Falling background animation ---------- */
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
        onRepeat: () =>
          gsap.set(img, { xPercent: Math.random() * 100, y: -150 }),
      });

      items.push(img);
    }

    for (let i = 0; i < COUNT; i++) spawn(i);

    return () => items.forEach((it) => it.remove());
  }, []);

  /* ---------- Intro animations ---------- */
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

  /* ---------- CTA handlers ---------- */
  function handleMainClick() {
    gsap.fromTo(
      btnRef.current,
      { scale: 1 },
      { scale: 0.92, duration: 0.08, yoyo: true, repeat: 1 }
    );
    setShowOptions(true);
  }

  function handleLogin() {
    navigate("/signin");
  }

  function handleRegister() {
    navigate("/register");
  }

  // Clean guest mode is kept in the renderer.
  function handleGuest() {
    if (typeof onAuth === "function") {
      onAuth({
        user: {
          id: "guest",
          name: "Guest",
          guest: true,
        },
      });
    }
  }

  return (
    <div className="welcome-mini-root">
      <div className="falling-back" ref={fallingRef} />

      <div className="center-stage">
        <h1 className="wm-title" ref={titleRef}>
          Welcome to Visual Memory Search
        </h1>

        <h2 className="wm-sub" ref={subRef}>
          - Smart Screenshot Search Engine
        </h2>

        <button className="wm-cta" ref={btnRef} onClick={handleMainClick}>
          Search Screenshots
        </button>

        {showOptions && (
          <div className="wm-options">
            <p className="wm-options-note">
              Choose how you'd like to proceed
            </p>

            <div className="wm-options-row">
              <button className="wm-option-btn" onClick={handleLogin}>
                Login
              </button>
              <button className="wm-option-btn" onClick={handleRegister}>
                Register
              </button>
              <button className="wm-option-ghost" onClick={handleGuest}>
                Use as guest
              </button>
            </div>

            <p className="wm-guest-note">
              Guest users can explore the app, but features like history, saved
              items, and analytics are disabled.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
