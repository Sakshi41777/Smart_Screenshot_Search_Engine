require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth");
const searchRoutes = require("./routes/search");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/search", searchRoutes);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, { })
  .then(()=> {
    console.log("MongoDB connected");
    app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
  })
  .catch(err => {
    console.error("Mongo connect error:", err);
    process.exit(1);
  });
