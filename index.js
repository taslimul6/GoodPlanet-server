// Loads .env before any other module reads process.env (must stay the first import).
import "dotenv/config";

import cors from "cors";
import express from "express";

import bookingsRouter from "./src/routes/bookings.js";
import eventsRouter from "./src/routes/events.js";
import followRouter from "./src/routes/follow.js";
import profileRouter from "./src/routes/profile.js";
import savedRouter from "./src/routes/saved.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use(eventsRouter);
app.use(bookingsRouter);
app.use(savedRouter);
app.use(followRouter);
app.use(profileRouter);

// On Vercel the app is exported (see api/index.js); everywhere else it listens.
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Server is running on port ${port}`));
}

export default app;
