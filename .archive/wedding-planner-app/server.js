const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  addGuest,
  getGuest,
  updateGuest,
  deleteGuest,
  listGuests
} = require('./src/guests');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Routes

// GET /api/guests - List all guests
app.get('/api/guests', (req, res) => {
  res.json(listGuests());
});

// GET /api/guests/:id - Get a specific guest
app.get('/api/guests/:id', (req, res) => {
  const guest = getGuest(req.params.id);
  if (guest) {
    res.json(guest);
  } else {
    res.status(404).json({ error: 'Guest not found' });
  }
});

// POST /api/guests - Add a new guest
app.post('/api/guests', (req, res) => {
  try {
    const guest = addGuest(req.body);
    res.status(201).json(guest);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/guests/:id - Update a guest
app.put('/api/guests/:id', (req, res) => {
  try {
    const guest = updateGuest(req.params.id, req.body);
    if (guest) {
      res.json(guest);
    } else {
      res.status(404).json({ error: 'Guest not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/guests/:id - Delete a guest
app.delete('/api/guests/:id', (req, res) => {
  const deleted = deleteGuest(req.params.id);
  if (deleted) {
    res.status(204).send();
  } else {
    res.status(404).json({ error: 'Guest not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Wedding Planner App running at http://localhost:${PORT}`);
});
