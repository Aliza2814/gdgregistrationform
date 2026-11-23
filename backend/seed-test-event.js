import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

loadEnv({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const schema = new mongoose.Schema({
  name: String,
  venue: String,
  startsAt: Date,
  endsAt: Date,
  deadline: Date,
  capacity: Number,
  registeredCount: { type: Number, default: 0 },
  registrationOpen: { type: Boolean, default: true }
});

try {
  await mongoose.connect(process.env.MONGODB_URI);

  const Event = mongoose.model("Event", schema);

  const event = await Event.create({
    name: "GDG Email Verification Test",
    venue: "Online Test Environment",
    startsAt: new Date("2026-11-30T04:30:00.000Z"),
    endsAt: new Date("2026-11-30T05:30:00.000Z"),
    deadline: new Date("2026-11-29T18:29:00.000Z"),
    capacity: 10,
    registeredCount: 0,
    registrationOpen: true
  });

  console.log("Test event created successfully!");
  console.log("Event ID:", event._id.toString());
  console.log("Event name:", event.name);
  console.log("Capacity:", event.capacity);
} catch (error) {
  console.error("Could not create test event:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
