import express from "express";
import cors from "cors";
import multer from "multer";
import cloudinary from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ================= FIREBASE ================= */
const mainServiceAccount = JSON.parse(process.env.MAIN_SERVICE_KEY);

const mainAdminApp = admin.initializeApp(
  {
    credential: admin.credential.cert(mainServiceAccount),
    databaseURL: process.env.FB_DB_URL
  },
  "mainApp"
);

const mainDB = mainAdminApp.database();
/* ================= HISTORY FIREBASE ================= */

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://history-aa002-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const historyDB = admin.database();

/* ================= TRANSLATION FIREBASE ================= */

const translationServiceAccount = JSON.parse(process.env.TRANSLATION_SERVICE_KEY);

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

const adminDataServiceAccount = JSON.parse(process.env.ADMIN_SERVICE_KEY);

const adminDataApp = admin.initializeApp(
  {
    credential: admin.credential.cert(adminDataServiceAccount),
    databaseURL: "https://admindata-95eeb-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  "adminDataApp"
);

const adminDB = adminDataApp.database();

/* ================= ADMIN-DATA FIREBASE ================= */

const userServiceAccount = JSON.parse(process.env.USER_SERVICE_KEY);

const userApp = admin.initializeApp(
  {
    credential: admin.credential.cert(userServiceAccount),
    databaseURL: "https://user-pref-84fa6-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  "userApp"
);

const userDB = userApp.database();

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
    /\/upload\/(?:v\d+\/)?(.+)\.(jpg|jpeg|png|webp|avif)/i,
  );

  return match ? match[1] : null;
}

app.get("/", (req, res) => {
  res.send("Server is running");
});

function cosineSimilarity(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/* ================= SET GAME ================= */

app.get("/api/user-top-pref/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const snap = await userDB
      .ref(`user_pref/${userId}/id`)
      .once("value");

    const data = snap.val() || {};

    const entries = Object.entries(data);

    if (!entries.length) {
      return res.status(404).json({ error: "No preferences found" });
    }

    entries.sort((a, b) => b[1] - a[1]);

    const topFiveIds = entries.slice(0, 5).map(e => e[0]);

    const randomId =
      topFiveIds[Math.floor(Math.random() * topFiveIds.length)];

    res.json({
      topFive: topFiveIds,
      selectedId: randomId,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get user preference" });
  }
});

app.post("/api/ai-set", async (req, res) => {
  try {
    const { budget, baseProduct } = req.body;

    if (!baseProduct) {
      return res.status(400).json({ error: "Base product missing" });
    }

    const snap = await mainDB.ref("products").once("value");
    const products = Object.values(snap.val() || {});

    if (!products.length) {
      return res.status(400).json({ error: "No products found" });
    }

    const getCategory = (name="") => {
      name = name.toLowerCase();
      if (name.includes("necklace")) return "necklace";
      if (name.includes("bangle") || name.includes("bracelet")) return "bangle";
      if (name.includes("earring")) return "earring";
      if (name.includes("ring")) return "ring";
      return "other";
    };

    const categories = ["necklace", "bangle", "earring", "ring", "other"];
    const pools = {};

    for (const cat of categories) {
      pools[cat] = products
        .filter(p =>
          getCategory(p.category) === cat
        )
        .map(p => {
          const t = cosineSimilarity(p.textVector, baseProduct.textVector);
          const i = cosineSimilarity(p.vector, baseProduct.vector);
          const score = (i * 0.85) + (t * 0.15);

          return { product: p, score };
        })
        .sort((a, b) => b.score - a.score);
    }

    const finalSet = [];
    let remaining = budget;

    for (const cat of categories) {
      for (const item of pools[cat]) {
        if (item.product.price <= remaining) {
          finalSet.push(item.product);
          remaining -= item.product.price;
          break;
        }
      }
    }

    res.json({
      totalPrice: budget - remaining,
      set: finalSet
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI set failed" });
  }
});

/* ================= SEARCH HANDLER ================= */

app.get("/api/semantic-search/:query", async (req, res) => {
  try {
    const { query } = req.params;

    const queryVector = await getEmbedding(query);

    const snapshot = await mainDB.ref("products").get();
    const data = snapshot.val();

    const products = Object.values(data || {});

    const scored = products
      .map((p) => {
        if (!p.vector) return null;

        const score = cosineSimilarity(queryVector, p.vector);

        return { ...p, score };
      })
      .filter(Boolean);

    scored.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      results: scored.slice(0, 20),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

/* ================= VISUAL RECOMMENDER ================= */

app.get("/api/recommend/:email", async (req, res) => {
  try {
    const email = req.params.email.split("@")[0].replaceAll(".", "_");

    const prefSnap = await userDB.ref(`user_pref/${email}`).once("value");
    const pref = prefSnap.val() || {};

    // ===== TOP PREFERENCES =====
    const favCategories = Object.entries(pref.category || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((x) => x[0]);

    const favPurities = Object.entries(pref.purity || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map((x) => x[0]);

    const topIds = Object.entries(pref.id || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((x) => x[0]);

    // ===== PRODUCTS =====
    const productsSnap = await mainDB.ref("products").once("value");
    const products = Object.values(productsSnap.val() || {});

    if (!products.length) {
      return res.json({ success: true, products: [] });
    }

    // ===== USER VECTORS =====
    const userVectors = [];
    const weights = [];

    topIds.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (p && p.vector) {
        console.log("Name:", p.name);
        userVectors.push(p.vector);
        weights.push(pref.id[id] || 1);
      }
    });

    // ===== COSINE FUNCTION =====
    function cosine(a, b) {
      let dot = 0,
        magA = 0,
        magB = 0;

      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }

      if (magA === 0 || magB === 0) return 0;

      return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    // ===== SCORING =====
    const scored = products
      .filter((p) => p.status === "in stock")
      .filter((p) => !topIds.includes(p.id))
      .map((p) => {
        // ✅ MULTI VECTOR MATCH (IMPORTANT FIX)
        let vectorScore = 0;

        if (p.vector && userVectors.length) {
          let maxScore = 0;

          userVectors.forEach((v, idx) => {
            let sim = cosine(v, p.vector);

            // normalize weight (VERY IMPORTANT)
            let weightedSim = sim * (weights[idx] / Math.max(...weights));

            if (weightedSim > maxScore) {
              maxScore = weightedSim;
            }
          });

          vectorScore = (maxScore + 1) / 2;
        }

        // ===== BOOSTS =====
        const catBoost = favCategories.includes(p.category) ? 1 : 0;
        const purBoost = favPurities.includes(p.purity) ? 1 : 0;

        let newBoost = 0;
        if (p.createdAt && Date.now() - p.createdAt < 7 * 86400000) {
          newBoost = 1;
        }

        // ===== FINAL SCORE (BALANCED) =====
        const finalScore =
          vectorScore * 0.6 +
          catBoost * 0.2 +
          purBoost * 0.15 +
          newBoost * 0.05;

        return { ...p, score: finalScore };
      });

    const sorted = scored.sort((a, b) => b.score - a.score);

    // ===== DIVERSITY (CATEGORY LIMIT) =====
    const categoryCount = {};
    const usedIds = new Set();
    const final = [];

    for (let p of sorted) {
      if (usedIds.has(p.id)) continue;

      const count = categoryCount[p.category] || 0;

      if (count < 3) {
        final.push(p);
        usedIds.add(p.id);
        categoryCount[p.category] = count + 1;
      }

      if (final.length === 10) break;
    }

    // ===== FALLBACK =====
    if (final.length < 10) {
      for (let p of products) {
        if (usedIds.has(p.id)) continue;
        if (p.status !== "in stock") continue;

        final.push(p);
        usedIds.add(p.id);

        if (final.length === 10) break;
      }
    }

    res.json({
      success: true,
      products: final,
    });
  } catch (err) {
    console.error("Recommend error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= CHECK ADMIN ================= */

app.post("/api/check-admin", async (req, res) => {
  try {
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: "Email required",
      });
    }

    const ADMIN_EMAIL = "adamhussain5353@gmail.com";

    const isAdmin = userEmail === ADMIN_EMAIL;

    res.json({
      success: true,
      isAdmin,
    });
  } catch (error) {
    console.error("ADMIN CHECK ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Failed to check admin",
    });
  }
});

/* ================= DELETE PRODUCT ================= */
app.post("/api/delete-product", async (req, res) => {
  try {
    const { userEmail, productId } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email provided" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

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

    const updatedImgs = currentImgs.filter((img) => img !== imageUrl);

    await heroRef.set({
      heroImg: updatedImgs,
      updatedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("HERO DELETE ERROR:", err);
    res.status(500).json({ error: "Hero delete failed" });
  }
});

// ================= SUBMIT CHECKOUT ORDER =================

async function sendToSheet(payload) {
  const sheetURL = "https://script.google.com/macros/s/AKfycbzdzj6fkPeUsaVrHG4VJx7VCWxIGUeI-KQOhGt-np8W_g8sg3Q-FdxLFsV5EYF9DUFb/exec";

  const res = await fetch(sheetURL, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Sheet failed");

  return true;
}

async function saveHistoryDirect(userEmail, orderId, itemList, date) {
  const username = userEmail.split("@")[0];

  await historyDB.ref(`history/${username}`).update({
    fullEmail: userEmail,
  });

  await historyDB.ref(`history/${username}/${orderId}`).set({
    id: orderId,
    itemList,
    date,
  });
}

async function buildVerifiedProducts(cartItems) {
  const verified = [];

  for (const item of cartItems) {
    const snap = await mainDB.ref(`products/${item.id}`).once("value");
    const dbProduct = snap.val();

    if (!dbProduct) {
      throw new Error("Found Adulteration In Product");
    }

    const fieldsToCheck = ["name", "price", "weight", "purity", "category", "image"];

    for (const field of fieldsToCheck) {
      if (String(item[field]) !== String(dbProduct[field])) {
        throw new Error(`Mismatch in ${field} for Product: ${item.name} ____ Real Value: ${String(dbProduct[field])} and Adulteration: ${String(item[field])}`);
      }
    }

    if (isNaN(item.quantity) || item.quantity <= 0) {
      throw new Error("Found Adulteration In Product");
    }

    verified.push({
      id: item.id,
      name: dbProduct.name,
      price: dbProduct.price,
      weight: dbProduct.weight,
      purity: dbProduct.purity,
      category: dbProduct.category,
      img: dbProduct.img,
      quantity: item.quantity
    });
  }

  return verified;
}

app.post("/api/checkout-order", async (req, res) => {
  try {
    const { orderId, name, mobile, email, address, lat, lng, products, time } = req.body;

    if (!products || !products.length) {
      return res.status(400).json({ success: false });
    }

    const verifiedProducts = await buildVerifiedProducts(products);

    await sendToSheet({
      action: "checkout",
      orderId,
      name,
      mobile,
      email,
      address,
      lat,
      lng,
      products: verifiedProducts,
      time
    });

    await saveHistoryDirect(email, orderId, products, time);

    res.json({ success: true });

  } catch (err) {
    console.error("Checkout error:", err);

    if (err.message === "Found Adulteration In Product") {
      return res.status(400).json({
        success: false,
        message: "Found Adulteration In Product"
      });
    } else if (err.message.includes("Mismatch")) {
      return res.status(403).json({
        success: false,
        message: err.message
      });
    }
    res.status(500).json({ success: false });
  }
});

app.post("/api/custom-order", async (req, res) => {
  try {
    const { orderId, name, mobile, email, address, lat, lng, description, karat, stone, weight, budget, customItem, time } = req.body;

    await sendToSheet({
      action: "custom",
      orderId,
      name,
      mobile,
      email,
      address,
      lat,
      lng,
      description,
      karat,
      stone,
      weight,
      budget,
      time
    });

    await saveHistoryDirect(email, orderId, customItem, time);

    res.json({ success: true });

  } catch (err) {
    console.error("Custom error:", err);
    res.status(500).json({ success: false });
  }
});

/* ================= UPDATE PRODUCT ================= */

app.post("/api/update-product", async (req, res) => {
  try {
    const { userEmail, productId, updates } = req.body;

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
      updatedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);

    res.status(500).json({
      error: "Failed to update product",
    });
  }
});

/* ================= UPLOAD IMAGE ================= */
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const result = await new Promise((resolve, reject) => {
    cloudinary.v2.uploader
      .upload_stream({ folder: "fakhri-gold" }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      })
      .end(req.file.buffer);
  });

  res.json({
    success: true,
    imageUrl: result.secure_url,
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

    for (const product of item) {
      const { id, purity, category, quantity } = product;

      const qty = Number(quantity) || 0;

      if (qty <= 0) continue;

      // ---------- PRODUCTS ----------
      if (id) {
        const productRef = monthRef.child(`products/${id}`);

        await productRef.transaction((current) => {
          return (current || 0) + qty;
        });
      }

      // ---------- PURITY ----------
      if (purity) {
        const purityRef = monthRef.child(`purity/${purity}`);

        await purityRef.transaction((current) => {
          return (current || 0) + qty;
        });
      }

      // ---------- CATEGORY ----------
      if (category) {
        const categoryRef = monthRef.child(`category/${category}`);

        await categoryRef.transaction((current) => {
          return (current || 0) + qty;
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE ERROR:", err);

    res.status(500).json({
      error: "Failed to update month data",
    });
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
        updatedAt: null,
      });
    }

    const data = snapshot.val();

    res.json({
      success: true,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    });
  } catch (error) {
    console.error("PRODUCT DATE ERROR:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch product dates",
    });
  }
});

/* ================= GET MONTH ANALYSIS ================= */
app.get("/api/get-month-analysis", async (req, res) => {
  try {
    const snap = await adminDB.ref("monthData").get();

    if (!snap.exists()) {
      return res.json({
        success: true,
        bestPurity: null,
        bestCategory: null,
        topProducts: [],
      });
    }

    const data = snap.val();

    const products = data.products || {};
    const purity = data.purity || {};
    const category = data.category || {};

    // ===== BEST PRODUCTS =====
    const bestProduct =
      Object.entries(products).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // ===== BEST PURITY =====
    const bestPurity = Object.entries(purity).length
      ? Object.entries(purity).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    // ===== BEST CATEGORY =====
    const bestCategory = Object.entries(category).length
      ? Object.entries(category).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    res.json({
      success: true,
      bestPurity,
      bestCategory,
      bestProduct,
    });
  } catch (err) {
    console.error("MONTH ANALYSIS ERROR:", err);

    res.status(500).json({
      success: false,
      error: "Failed to analyze month data",
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
      date,
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
app.post("/api/mark-complete", async (req, res) => {
  try {
    const { userEmail, orderId, itemIndex, status } = req.body;

    if (!userEmail || !orderId || itemIndex === undefined) {
      return res.status(400).json({ error: "Missing data" });
    }

    const historyRef = historyDB.ref(
      `history/${userEmail}/${orderId}/itemList/${itemIndex}`,
    );

    await historyRef.update({
      complete: Boolean(status),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

/* ================= SET ARRIVAL ================= */
app.post("/api/set-arrival", async (req, res) => {
  try {
    const { userEmail, orderId, itemIndex, arrival } = req.body;

    if (!userEmail || !orderId || itemIndex === undefined || !arrival) {
      return res.status(400).json({ error: "Missing data" });
    }

    const historyRef = historyDB.ref(
      `history/${userEmail}/${orderId}/itemList/${itemIndex}`,
    );

    await historyRef.update({
      arrival: arrival,
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
      templateId: "template_4frx3mr",
    };

    if (!snapshot.exists()) {
      return res.json({ success: true, history: {} });
    }

    res.json({
      success: true,
      history: snapshot.val(),
      emailData: emailData,
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
    const curr_url =
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";

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
      exchange_rate: exchange,
    });
  } catch (error) {
    console.error("Gold rate error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch gold rate",
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
        ar: cache[id][field].ar,
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
      ar: arabicText,
    };

    await cacheRef.set(cache);

    res.json({
      success: true,
      ar: arabicText,
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
      ...product,
    }));

    res.json({
      success: true,
      products,
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
      heroImg: snapshot.val().heroImg || [],
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
      thumbnails,
    } = req.body;

    if (!userEmail) {
      return res.status(403).json({ error: "No email Query" });
    }

    if (userEmail !== "adamhussain5353@gmail.com") {
      return res.status(405).json({ error: "Not Admin" });
    }

    if (
      !name ||
      !price ||
      !weight ||
      !category ||
      !purity ||
      !description ||
      !mainImage
    ) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // ================= VECTOR GENERATION =================
    // console.log("Generating vector...");

    // const textForVector = `
    //   ${name} 
    //   ${category} 
    //   ${description}
    // `;

    // const textVector = await getEmbedding(textForVector);

    // const vector = await getImageVector(mainImage);

    // console.log("Vector generated:", vector);
    // console.log("Vector length:", vector.length);

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
      // vector,
      // textVector,
      thumbnails: thumbnails || [],
      status: "in stock",
      createdAt: Date.now(),
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
      price: goldPrice,
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
      updatedAt: Date.now(),
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
      cloudinary.v2.uploader
        .upload_stream({ folder: "fakhri-gold" }, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        })
        .end(req.file.buffer);
    });

    res.json({
      success: true,
      imageUrl: result.secure_url,
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

    if (typeof orderQty !== "number" || typeof goldPrice !== "number") {
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
        hypeLevel: "No Activity",
      });
    }

    const data = snapshot.val();

    let totalQty = 0;

    Object.values(data).forEach((section) => {
      if (typeof section === "object") {
        Object.values(section).forEach((value) => {
          totalQty += Number(value) || 0;
        });
      }
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
      hypeLevel,
    });
  } catch (error) {
    console.error("Market Hype error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate market hype",
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
        lastOrder: "-",
      });
    }

    const data = snapshot.val();

    let totalQty = 0;
    let totalSpent = 0;
    let totalGold = 0;
    let lastOrder = "-";

    const orders = Object.values(data);

    orders.forEach((order) => {
      if (!order.itemList) return;

      lastOrder = order.date || "-";

      order.itemList.forEach((item) => {
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
      lastOrder,
    });
  } catch (error) {
    console.error("PROFILE DASHBOARD ERROR:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate profile data",
    });
  }
});

app.post("/api/add-pref", async (req, res) => {
  try {
    const { email, id, purity, category, points } = req.body;

    if (!email) {
      return res.status(400).json({ success: false });
    }

    const safeEmail = email.split("@")[0];

    const userRef = userDB.ref(`user_pref/${safeEmail}`);

    const score = points || 1; // default 1

    const updates = {};

    if (id) updates[`id/${id}`] = admin.database.ServerValue.increment(score);
    if (purity)
      updates[`purity/${purity}`] = admin.database.ServerValue.increment(score);
    if (category)
      updates[`category/${category}`] =
        admin.database.ServerValue.increment(score);

    await userRef.update(updates);

    res.json({ success: true });
  } catch (err) {
    console.error("Preference error:", err);
    res.status(500).json({ success: false });
  }
});

/* ================= GET USER PREF ================= */

app.get("/api/user-pref/:email", async (req, res) => {
  try {
    let { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email required",
      });
    }

    // convert email to firebase-safe key
    const safeEmail = email.split("@")[0];

    const prefRef = userDB.ref(`user_pref/${safeEmail}`);

    const snap = await prefRef.get();

    if (!snap.exists()) {
      return res.json({
        success: true,
        data: null,
      });
    }

    res.json({
      success: true,
      data: snap.val(),
    });
  } catch (error) {
    console.error("User pref error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to get user preferences",
    });
  }
});

/* ================= TOP TRENDING PRODUCTS ================= */

app.get("/api/top-products", async (req, res) => {
  try {
    const ref = adminDB.ref("monthData/products");

    const snap = await ref.get();

    if (!snap.exists()) {
      return res.json({
        success: true,
        topProducts: [],
      });
    }

    const data = snap.val();

    const topProducts = Object.entries(data)
      .sort((a, b) => b[1] - a[1]) // sort by clicks
      .slice(0, 5) // top 5
      .map((x) => x[0]); // return only ids

    res.json({
      success: true,
      topProducts,
    });
  } catch (error) {
    console.error("Top products error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to get top products",
    });
  }
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
