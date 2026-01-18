# Wedding Planner

A simple wedding guest management application with a REST API and web interface.

## Features

- Add, update, and delete wedding guests
- Track RSVP status (pending, confirmed, declined)
- Email validation
- Clean, responsive web interface
- RESTful API

## Installation

```bash
npm install
```

## Running the Application

### Web Interface (Recommended)

Start the server:
```bash
npm start
```

Then open your browser to: http://localhost:3001

The web interface allows you to:
- Add new guests with name, email, and RSVP status
- View all guests in a clean list
- Update guest RSVP status with one click
- Delete guests with confirmation

### Command Line Testing

Run the demo script:
```bash
node demo.js
```

### Run Tests

```bash
npm test
```

## API Endpoints

- `GET /api/guests` - List all guests
- `GET /api/guests/:id` - Get a specific guest
- `POST /api/guests` - Add a new guest
- `PUT /api/guests/:id` - Update a guest
- `DELETE /api/guests/:id` - Delete a guest

### Example API Usage

```bash
# List all guests
curl http://localhost:3001/api/guests

# Add a guest
curl -X POST http://localhost:3001/api/guests \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","rsvpStatus":"confirmed"}'

# Update a guest
curl -X PUT http://localhost:3001/api/guests/1 \
  -H "Content-Type: application/json" \
  -d '{"rsvpStatus":"declined"}'

# Delete a guest
curl -X DELETE http://localhost:3001/api/guests/1
```

## Project Structure

```
wedding-planner-app/
├── src/
│   ├── index.js          # Main entry point
│   └── guests.js         # Guest management module
├── public/
│   └── index.html        # Web interface
├── tests/
│   └── guests.test.js    # Jest tests
├── server.js             # Express API server
├── demo.js               # Command-line demo
└── package.json
```
