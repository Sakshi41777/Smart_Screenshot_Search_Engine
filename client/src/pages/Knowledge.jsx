import React from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import "./Knowledge.css";

const suggestionGroups = [
  {
    title: "Everyday Search",
    items: [
      "find files about onboarding",
      "show recent screenshots in this folder",
      "find files about invoice",
      "find duplicate screenshots",
    ],
  },
  {
    title: "Text Inside Files",
    items: [
      "find files containing login failed",
      "show files with a lot of text",
      "find images without readable text",
      "summarize this selected file",
    ],
  },
  {
    title: "Image Match",
    items: [
      "find similar images to this screenshot",
      "find matching UI error screen",
      "show screenshots similar to this capture",
    ],
  },
];

export default function Knowledge({ user, onSignOut }) {
  const navigate = useNavigate();

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={onSignOut} />

      <div style={{ marginTop: 12 }} />

      <div className="sp-body" style={{ gridTemplateColumns: "1fr" }}>
        <main style={{ gridColumn: "1 / -1" }}>
          <div className="sp-card knowledge-page-card">
            <h2>Knowledge Center</h2>
            <p className="k-subtitle">
              Learn how this app works and how to find files faster.
            </p>

            <section className="k-section">
              <h3>How It Works</h3>
              <div className="k-steps">
                <div>1. Choose one or more folders you want to search.</div>
                <div>2. The app quickly reads your files and remembers helpful details.</div>
                <div>3. It can also read text inside screenshots and many documents.</div>
                <div>4. Search uses your words and filters to show the best matches.</div>
              </div>
            </section>

            <section className="k-section">
              <h3>How To Use</h3>
              <div className="k-steps">
                <div>1. Open Search and click `Add Folder to Search`.</div>
                <div>2. Type what you want to find and choose file filters.</div>
                <div>3. Use date, size, and file format filters to narrow results.</div>
                <div>4. Open a result to save, copy, share, refresh text, or ask a question.</div>
              </div>
            </section>

            <section className="k-section">
              <h3>Suggested Searches</h3>
              <div className="k-groups">
                {suggestionGroups.map((group) => (
                  <div className="k-group" key={group.title}>
                    <strong>{group.title}</strong>
                    <div className="k-chips">
                      {group.items.map((item) => (
                        <span className="k-chip" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="k-actions">
              <button className="btn-outline" type="button" onClick={() => navigate("/profile")}>
                Back to Profile
              </button>
              <button className="btn-primary" type="button" onClick={() => navigate("/search")}>
                Go to Search
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
