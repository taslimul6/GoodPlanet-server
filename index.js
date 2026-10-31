import express from 'express';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';

dotenv.config();


const app = express();
const port= 5000;

app.use(cors());
app.use(express.json())

//db connection

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();

const db = connectedClient.db('goodPlanet');
const eventsCollection = db.collection('events')









app.get('/', async(req, res) => {
    const events = await eventsCollection.find().toArray();
    res.send(events);
});

app.get('/featured', async(req, res) => {
    const events = await eventsCollection.find().limit(6).toArray();
    res.send(events);
});

app.get('/event/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        message: "Event not found",
      });
    }

    res.send(event);

  } catch (err) {
    res.status(500).send({
      message: "Failed to fetch event",
    });
  }
});




console.log()


app.listen(port, ()=>{
    console.log(`Server is running on port ${port}`);
})