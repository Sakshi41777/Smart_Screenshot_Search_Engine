import React from "react";
import { createRoot } from "react-dom/client";
<<<<<<< HEAD
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root"));

root.render(
  <HashRouter>
    <App />
  </HashRouter>
=======
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
);
