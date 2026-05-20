const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const multer = require("multer");
const crypto = require("crypto");
const sharp = require("sharp");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();
const { sendProgress } = require("./searchProgress");
const { extractTextSafe, describeImageSemanticSafe } = require("../services/ocr");
const { requireDb } = require("../services/db");

function notImplemented(req, res) {
  res.status(501).json({
    ok: false,
    error: "Search API endpoint not implemented in this build.",
    path: req.path,
    method: req.method,
  });
}

router.post("/index-folders", notImplemented);
router.post("/cancel-index", notImplemented);
router.post("/reocr", notImplemented);
router.post("/ask", notImplemented);
router.post("/share/public-link", notImplemented);
router.post("/image-match", notImplemented);
router.post("/reset-app", notImplemented);
router.post("/", notImplemented);

router.all("*", notImplemented);

module.exports = router;
