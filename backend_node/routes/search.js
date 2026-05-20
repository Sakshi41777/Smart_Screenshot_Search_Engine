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

/*  e602d9f76dae2518e38a65a9afec0f77ae0358a8
  }
});

module.exports = router;
