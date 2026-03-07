import express from "express";
import cors from "cors";
import multer from "multer";
import cloudinary from "cloudinary";
import admin from "firebase-admin";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ================= FIREBASE ================= */
const mainServiceAccount = JSON.parse(
  fs.readFileSync("./MainServiceKey.json", "utf8")
);

const mainAdminApp = admin.initializeApp(
  {
    credential: admin.credential.cert(mainServiceAccount),
    databaseURL: process.env.FB_DB_URL
  },
  "mainApp"
);

const mainDB = mainAdminApp.database();
/* ================= HISTORY FIREBASE ================= */

const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://history-aa002-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const historyDB = admin.database();

/* ================= TRANSLATION FIREBASE ================= */

const translationServiceAccount = JSON.parse(
  fs.readFileSync("./translationServiceKey.json", "utf8")
);

const translationAdminApp = admin.initializeApp(
  {
    credential: admin.credential.cert(translationServiceAccount),
    databaseURL:
      "https://translation-d501e-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  "translationApp" 
);

const translationDB = translationAdminApp.database();

/* ================= ADMIN-DATA FIREBASE ================= */

const adminDataServiceAccount = JSON.parse(
  fs.readFileSync("./adminServiceKey.json", "utf8")
);

const adminDataApp = admin.initializeApp(
  {
    credential: admin.credential.cert(adminDataServiceAccount),
    databaseURL: "https://admindata-95eeb-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  "adminDataApp"
);

const adminDB = adminDataApp.database();

/* ================= CLOUDINARY ================= */
cloudinary.v2.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

/* ================= MULTER ================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ================= HELPERS ================= */
function extractPublicId(url) {
  if (!url) return null;

  const match = url.match(
    /\/upload\/(?:v\d+\/)?(.+)\.(jpg|jpeg|png|webp|avif)/i
  );

  return match ? match[1] : null;
}

/* ================= CHECK ADMIN ================= */

app.post("/api/check-admin", async (req, res) => {
  try {

    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: "Email required"
      });
    }

    const ADMIN_EMAIL = "adamhussain5353@gmail.com";

    const isAdmin = userEmail === ADMIN_EMAIL;

    res.json({
      success: true,
      isAdmin
    });

  } catch (error) {

    console.error("ADMIN CHECK ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Failed to check admin"
    });

  }
});

/* ================= DELETE PRODUCT ================= */
app.post("/api/delete-product", async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: "Product ID required" });
    }

    const productRef = mainDB.ref(`products/${productId}`);
    const snap = await productRef.get();

    if (!snap.exists()) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = snap.val();

    if (product.mainImage) {
      const pid = extractPublicId(product.mainImage);
      if (pid) {
        await cloudinary.v2.uploader.destroy(pid);
      }
    }

    if (Array.isArray(product.thumbnails)) {
      for (const url of product.thumbnails) {
        const pid = extractPublicId(url);
        if (pid) {
          await cloudinary.v2.uploader.destroy(pid);
        }
      }
    }

    await productRef.remove();

    await translationDB.ref(`translationCache/${productId}`).remove();

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* ================= DELETE HERO IMAGE ================= */
app.post("/api/delete-hero", async (req, res) => {
  try {
    const { userEmail, imageUrl } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email provided" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (!imageUrl) {
      return res.status(400).json({ error: "Image URL required" });
    }

    const pid = extractPublicId(imageUrl);

    if (pid) {
      await cloudinary.v2.uploader.destroy(pid);
    }

    const heroRef = adminDB.ref("Hero");
    const snapshot = await heroRef.once("value");

    if (!snapshot.exists()) {
      return res.json({ success: true });
    }

    const data = snapshot.val();
    const currentImgs = Array.isArray(data.heroImg) ? data.heroImg : [];

    const updatedImgs = currentImgs.filter(img => img !== imageUrl);

    await heroRef.set({
      heroImg: updatedImgs,
      updatedAt: Date.now()
    });

    res.json({ success: true });

  } catch (err) {
    console.error("HERO DELETE ERROR:", err);
    res.status(500).json({ error: "Hero delete failed" });
  }
});

/* ================= UPDATE PRODUCT ================= */

app.post("/api/update-product", async (req, res) => {
  try {

    const {
      userEmail,
      productId,
      updates
    } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email provided" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (!productId || !updates) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const productRef = mainDB.ref(`products/${productId}`);

    await productRef.update({
      ...updates,
      updatedAt: Date.now()
    });

    res.json({ success: true });

  } catch (err) {

    console.error("UPDATE PRODUCT ERROR:", err);

    res.status(500).json({
      error: "Failed to update product"
    });

  }
});

/* ================= UPLOAD IMAGE ================= */
app.post("/api/upload-image", upload.single("image"), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const result = await new Promise((resolve, reject) => {
    cloudinary.v2.uploader.upload_stream(
      { folder: "fakhri-gold" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(req.file.buffer);
  });

  res.json({
    success: true,
    imageUrl: result.secure_url
  });
});

/* ================= UPDATE MONTH DATA ================= */
app.post("/api/update-month", async (req, res) => {
  try {
    const { item } = req.body;

    if (!item || !Array.isArray(item)) {
      return res.status(400).json({ error: "Invalid data" });
    }

    const monthRef = adminDB.ref("monthData");

    item.forEach((product) => {

      const { id, purity, category, quantity } = product;

      const qty = Number(quantity) || 0;

      if (qty <= 0) return;

      const keysToUpdate = [];

      if (id) keysToUpdate.push(id);
      if (purity) keysToUpdate.push(purity);
      if (category) keysToUpdate.push(category);

      for (const key of keysToUpdate) {

        monthRef.child(key).transaction((currentValue) => {
          return (currentValue || 0) + qty;
        });

      }

    });

    res.json({ success: true });

  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to update month data" });
  }
});

/* ================= GET PRODUCT DATES ================= */

app.get("/api/product-dates/:productId", async (req, res) => {
  try {

    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({ error: "Product ID required" });
    }

    const snapshot = await mainDB.ref(`products/${productId}`).get();

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        createdAt: null,
        updatedAt: null
      });
    }

    const data = snapshot.val();

    res.json({
      success: true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    });

  } catch (error) {

    console.error("PRODUCT DATE ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch product dates"
    });

  }
});

/* ================= GET MONTH ANALYSIS ================= */
app.get("/api/get-month-analysis", async (req, res) => {
  try {

    const monthRef = adminDB.ref("monthData");
    const snapshot = await monthRef.once("value");

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        topPurity: null,
        topCategory: null,
        topId: null
      });
    }

    const data = snapshot.val();
    const items = Object.keys(data);

    const purity = [];
    const category = [];
    const id = [];

    const purityList = ["24k", "22k", "21k", "18k"];
    const categoryList = ["bangle", "bracelet", "necklace", "ring", "earring", "other"];

    // Separate values
    items.forEach((item) => {

      const value = Number(data[item]) || 0;

      if (purityList.includes(item)) {
        purity.push({ key: item, value });
      }
      else if (categoryList.includes(item)) {
        category.push({ key: item, value });
      }
      else {
        id.push({ key: item, value });
      }

    });

    // ===== REDUCE TO FIND MAX =====

    const topPurity = purity.length > 0
      ? purity.reduce((max, current) =>
          current.value > max.value ? current : max
        )
      : null;

    const topCategory = category.length > 0
      ? category.reduce((max, current) =>
          current.value > max.value ? current : max
        )
      : null;

    const topId = id.length > 0
      ? id.reduce((max, current) =>
          current.value > max.value ? current : max
        )
      : null;

    res.json({
      success: true,
      topPurity,
      topCategory,
      topId,
    });

  } catch (err) {
    console.error("MONTH ANALYSIS ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Failed to analyze month data"
    });
  }
});

/* ================= SAVE HISTORY ================= */
app.post("/api/save-history", async (req, res) => {
  try {
    const { userEmail, id, itemList, date } = req.body;

    if (!userEmail || !id) {
      return res.status(400).json({ error: "Missing data" });
    }

    const username = userEmail.split("@")[0];

    const historyEmail = historyDB.ref(`history/${username}`);

    await historyEmail.update({
      fullEmail: userEmail,
    });

    const historyRef = historyDB.ref(`history/${username}/${id}`);

    await historyRef.set({
      id,
      itemList,
      date
    });

    res.json({ success: true });

  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

/* ================= GET HISTORY ================= */
app.post("/api/get-history", async (req, res) => {
  try {
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "Email required" });
    }

    const username = userEmail.split("@")[0];

    const snapshot = await historyDB.ref(`history/${username}`).get();

    if (!snapshot.exists()) {
      return res.json({ orders: [] });
    }

    const data = snapshot.val();

    res.json({ orders: data });

  } catch (err) {
    console.error("GET HISTORY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/* ================= SET ARRIVAL ================= */
app.post("/api/set-arrival", async (req, res) => {
  try {
    const { userEmail, orderId, itemIndex, arrival } = req.body;

    if (!userEmail || !orderId || itemIndex === undefined || !arrival) {
      return res.status(400).json({ error: "Missing data" });
    }

    const historyRef = historyDB.ref(`history/${userEmail}/${orderId}/itemList/${itemIndex}`);

    await historyRef.update({
      arrival: arrival
    });

    res.json({ success: true });

  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

/* ================= CANCEL ORDER ================= */

app.post("/api/cancel-order", async (req, res) => {
  try {
    const { userEmail, orderId, itemIndex } = req.body;

    if (!userEmail || !orderId || itemIndex === undefined) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const safeEmail = userEmail.split("@")[0];

    const orderRef = historyDB.ref(`history/${safeEmail}/${orderId}`);
    const snapshot = await orderRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderData = snapshot.val();

    console.log("ItemIndex:", itemIndex);
    console.log("ItemList length:", orderData.itemList.length);

    orderData.itemList.splice(itemIndex, 1);

    if (orderData.itemList.length === 0) {
      await orderRef.remove();
    } else {
      await orderRef.set(orderData);
    }

    res.json({ success: true });

  } catch (error) {
    console.error("Cancel error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= ADMIN ORDER ================= */

app.post("/api/admin-order", async (req, res) => {
  try {
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(403).json({ error: "Not Admin" });
    }

    const snapshot = await historyDB.ref("history").once("value");
    const emailData = {
      serviceId: "service_ffwaewp",
      templateId: "template_4frx3mr"
    }

    if (!snapshot.exists()) {
      return res.json({ success: true, history: {} });
    }

    res.json({
      success: true,
      history: snapshot.val(),
      emailData: emailData
    });

  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= GET GOLD RATE ================= */

app.get("/api/gold-rate", async (req, res) => {

  try {

    const gold_url = "https://api.gold-api.com/price/XAU";
    const curr_url = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";

    const goldRes = await fetch(gold_url);
    const goldData = await goldRes.json();

    const currRes = await fetch(curr_url);
    const currData = await currRes.json();

    const exchange = currData.usd.kwd;

    const ounceToGram = 31.1035;

    const pricePerGramKWD = (goldData.price / ounceToGram) * exchange;

    res.json({
      success: true,
      priceGram: pricePerGramKWD,
      priceOunce: goldData.price,
      exchange_rate: exchange
    });

  } catch (error) {

    console.error("Gold rate error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch gold rate"
    });

  }

});

/* ================= TRANSLATE API ================= */

app.post("/api/translate", async (req, res) => {
  try {
    const { id, field, text } = req.body;

    if (!id || !field || !text) {
      return res.status(400).json({ error: "Missing data" });
    }

    const cacheRef = translationDB.ref("translationCache");
    const snapshot = await cacheRef.once("value");

    let cache = snapshot.exists() ? snapshot.val() : {};

    if (cache[id]?.[field]?.ar) {
      return res.json({
        success: true,
        ar: cache[id][field].ar
      });
    }

    const googleURL =
      "https://translate.googleapis.com/translate_a/single" +
      "?client=gtx&sl=en&tl=ar&dt=t&q=" +
      encodeURIComponent(text);

    const translateRes = await fetch(googleURL);
    const data = await translateRes.json();
    const arabicText = data[0][0][0];

    if (!cache[id]) cache[id] = {};
    cache[id][field] = {
      en: text,
      ar: arabicText
    };

    await cacheRef.set(cache);

    res.json({
      success: true,
      ar: arabicText
    });

  } catch (error) {
    console.error("TRANSLATION ERROR:", error);
    res.status(500).json({ error: "Translation failed" });
  }
});

/* ================= GET PRODUCTS ================= */

app.get("/api/products", async (req, res) => {
  try {

    const snapshot = await mainDB.ref("products").get();

    if (!snapshot.exists()) {
      return res.json({ success: true, products: [] });
    }

    const data = snapshot.val();

    const products = Object.entries(data).map(([id, product]) => ({
      id,
      ...product
    }));

    res.json({
      success: true,
      products
    });

  } catch (error) {
    console.error("Products error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ================= GET HERO ================= */

app.get("/api/hero", async (req, res) => {
  try {

    const snapshot = await adminDB.ref("Hero").once("value");

    if (!snapshot.exists()) {
      return res.json({ success: true, heroImg: [] });
    }

    res.json({
      success: true,
      heroImg: snapshot.val().heroImg || []
    });

  } catch (error) {
    console.error("Hero fetch error:", error);
    res.status(500).json({ error: "Failed to fetch hero images" });
  }
});

/* ================= CREATE PRODUCT ================= */

app.post("/api/create-product", async (req, res) => {
  try {
    const {
      userEmail,
      name,
      price,
      weight,
      category,
      purity,
      description,
      mainImage,
      thumbnails
    } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email Query" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (!name || !price || !weight || !category || !purity || !description || !mainImage) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const productsRef = mainDB.ref("products");
    const newProductRef = productsRef.push();

    await newProductRef.update({
      id: newProductRef.key,
      name,
      price,
      weight,
      category,
      purity,
      description,
      mainImage,
      thumbnails: thumbnails || [],
      status: "in stock",
      createdAt: Date.now()
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= SET GOLD PRICE ================= */

app.post("/api/set-gold-price", async (req, res) => {
  try {
    const { userEmail, goldPrice, goldCategory } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email Query" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (!goldPrice || !goldCategory) {
      return res.status(400).json({ error: "Missing fields" });
    }

    await adminDB.ref(`gold/${goldCategory}`).set({
      price: goldPrice
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Gold price error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= SAVE HERO IMAGES ================= */

app.post("/api/save-hero", async (req, res) => {
  try {
    const { userEmail, heroImg } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email Query" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (!Array.isArray(heroImg)) {
      return res.status(400).json({ error: "Invalid data" });
    }

    await adminDB.ref("Hero").set({
      heroImg,
      updatedAt: Date.now()
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Hero save error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= CLOUDINARY UPLOAD ================= */

app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.v2.uploader.upload_stream(
        { folder: "fakhri-gold" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    res.json({
      success: true,
      imageUrl: result.secure_url
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ================= PROFILE DATA UPDATE =================

app.post("/api/update-profile-data", async (req, res) => {
  try {
    const { orderQty, goldPrice } = req.body;

    if (
      typeof orderQty !== "number" ||
      typeof goldPrice !== "number"
    ) {
      return res.status(400).json({
        error: "orderQty and goldPrice must be numbers",
      });
    }

    const ref = admin.database().ref("adminDB/profileData");

    const snapshot = await ref.once("value");
    const previousData = snapshot.val() || {};

    const previousQty = previousData.orderQty || 0;
    const previousGold = previousData.goldPrice || 0;

    const updatedQty = previousQty + orderQty;
    const updatedGold = previousGold + goldPrice;

    await ref.set({
      orderQty: updatedQty,
      goldPrice: updatedGold,
    });

    res.json({
      success: true,
      orderQty: updatedQty,
      goldPrice: updatedGold,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= MARKET HYPE ================= */

app.get("/api/get-market-hype", async (req, res) => {
  try {

    const monthRef = adminDB.ref("monthData");
    const snapshot = await monthRef.once("value");

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        totalQty: 0,
        hypeScore: 0,
        hypeLevel: "No Activity"
      });
    }

    const data = snapshot.val();

    let totalQty = 0;

    Object.values(data).forEach(value => {
      totalQty += Number(value) || 0;
    });

    let hypeScore = Math.min((totalQty / 300) * 100, 100);
    hypeScore = Math.round(hypeScore);

    let hypeLevel = "Low";

    if (hypeScore >= 80) {
      hypeLevel = "Explosive";
    } else if (hypeScore >= 50) {
      hypeLevel = "High";
    } else if (hypeScore >= 25) {
      hypeLevel = "Growing";
    }

    res.json({
      success: true,
      totalQty,
      hypeScore,
      hypeLevel
    });

  } catch (error) {
    console.error("Market Hype error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate market hype"
    });
  }
});

/* ================= PROFILE DASHBOARD ================= */

app.post("/api/get-profile-dashboard", async (req, res) => {
  try {
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "Email required" });
    }

    const username = userEmail.split("@")[0];
    const snapshot = await historyDB.ref(`history/${username}`).once("value");

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        totalQty: 0,
        totalSpent: 0,
        totalGold: 0,
        lastOrder: "-"
      });
    }

    const data = snapshot.val();

    let totalQty = 0;
    let totalSpent = 0;
    let totalGold = 0;
    let lastOrder = "-";

    const orders = Object.values(data);

    orders.forEach(order => {

      if (!order.itemList) return;

      lastOrder = order.date || "-";

      order.itemList.forEach(item => {
        totalQty += Number(item.quantity) || 0;
        totalSpent += Number(item.price) || 0;
        totalGold += Number(item.weight) || 0;
      });

    });

    res.json({
      success: true,
      totalQty,
      totalSpent,
      totalGold,
      lastOrder
    });

  } catch (error) {
    console.error("PROFILE DASHBOARD ERROR:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate profile data"
    });
  }
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
