// backend/server.js
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = "mysecretkey";

mongoose.connect("mongodb://127.0.0.1:27017/eventDB", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// ---------- Schemas ----------
const userSchema = new mongoose.Schema({
  username: String,
  email: { type: String, unique: true },
  password: String,
  isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model("User", userSchema);

const eventSchema = new mongoose.Schema({
  title: String,
  description: String,
  venue: String,
  date: Date,
  startTime: String,
  endTime: String,
  price: { type: Number, default: 0 },
  capacity: { type: Number, default: 100 },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model("Event", eventSchema);

const bookingSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: String,
  seats: { type: Number, default: 1 },
  paid: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model("Booking", bookingSchema);

// ---------- Auth Helpers ----------
const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ---------- Auth Routes ----------
app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Signup failed", details: err.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: "User not found" });
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) return res.status(400).json({ error: "Invalid password" });
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "6h" });
  res.json({ message: "Login successful", token });
});


// Specific routes FIRST
app.get("/events/upcoming", authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = await Event.find({ date: { $gt: today } }).sort({ date: 1 });
    res.json(upcoming);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch upcoming events" });
  }
});

app.get("/events/live", authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const liveEvents = await Event.find({
      date: { $gte: today, $lt: tomorrow }
    });
    res.json(liveEvents);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch live events" });
  }
});

// All events
app.get("/events", authMiddleware, async (req, res) => {
  try {
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Generic route LAST
app.get("/events/:id", authMiddleware, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch event" });
  }
});
// ---------- Profile Routes ----------

// Get profile + booking history
app.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    const bookings = await Booking.find({ userId: req.userId }).populate("eventId");
    res.json({ user, bookings });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Update profile
app.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const updateData = {};

    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { $set: updateData },
      { new: true }
    ).select("-password");

    res.json({ message: "Profile updated successfully", user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ---------- Booking Routes ----------

// Create a booking
app.post("/bookings", authMiddleware, async (req, res) => {
  try {
    const { eventId, seats } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (event.capacity < seats) {
      return res.status(400).json({ error: "Not enough seats available" });
    }

    // reduce available capacity
    event.capacity -= seats;
    await event.save();

    const booking = new Booking({
      eventId,
      userId: req.userId,
      seats,
      paid: false, // payment step comes next
    });

    await booking.save();
    res.json({ message: "Booking created. Proceed to payment.", booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Booking failed" });
  }
});

// Get user bookings (history)
app.get("/bookings/my", authMiddleware, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.userId }).populate("eventId");
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});
// Mark booking as paid (checkout simulation)
app.post("/bookings/:id/pay", authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, userId: req.userId }).populate("eventId");
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.paid) return res.status(400).json({ error: "Already paid" });

    // mark as paid
    booking.paid = true;
    await booking.save();

    res.json({ message: "✅ Payment successful", booking });
  } catch (err) {
    res.status(500).json({ error: "Payment failed" });
  }
});


// ---------- Start ----------
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
