/**
 * Guest management module with in-memory storage
 * Provides CRUD operations for managing wedding guests
 */

// Internal storage - Map keyed by guest id for O(1) lookups
const guests = new Map();

// Auto-incrementing ID counter (starts at 1)
let nextId = 1;

/**
 * Validate email format using regex
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email format
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // Basic email validation: must have @ and domain with dot
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Add a new guest to the system
 * @param {Object} guestData - Guest data
 * @param {string} guestData.name - Guest name (required)
 * @param {string} guestData.email - Guest email (required, validated)
 * @param {string} [guestData.rsvpStatus='pending'] - RSVP status
 * @returns {Object} - Created guest with generated id
 * @throws {Error} - If name is missing or email is invalid
 */
function addGuest({ name, email, rsvpStatus = 'pending' } = {}) {
  if (!name) {
    throw new Error('Name is required');
  }
  if (!isValidEmail(email)) {
    throw new Error('Invalid email format');
  }

  const id = String(nextId++);
  const guest = {
    id,
    name,
    email,
    rsvpStatus
  };

  guests.set(id, guest);
  return { ...guest };
}

/**
 * Get a guest by ID
 * @param {string} id - Guest ID
 * @returns {Object|null} - Guest object if found, null otherwise
 */
function getGuest(id) {
  if (id == null || typeof id !== 'string') {
    return null;
  }
  const guest = guests.get(id);
  return guest ? { ...guest } : null;
}

/**
 * Update an existing guest
 * @param {string} id - Guest ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated guest or null if not found
 * @throws {Error} - If email update is invalid
 */
function updateGuest(id, updates) {
  const guest = guests.get(id);
  if (!guest) {
    return null;
  }

  // Validate email if being updated
  if (updates.email !== undefined && !isValidEmail(updates.email)) {
    throw new Error('Invalid email format');
  }

  // Apply updates but preserve id
  const { id: _ignoredId, ...validUpdates } = updates;
  const updatedGuest = { ...guest, ...validUpdates };
  guests.set(id, updatedGuest);

  return { ...updatedGuest };
}

/**
 * Delete a guest by ID
 * @param {string} id - Guest ID
 * @returns {boolean} - True if deleted, false if not found
 */
function deleteGuest(id) {
  return guests.delete(id);
}

/**
 * List all guests
 * @returns {Array} - Array of all guest objects (copy, not reference)
 */
function listGuests() {
  return Array.from(guests.values()).map(guest => ({ ...guest }));
}

/**
 * Clear all guests (for testing purposes)
 */
function clearGuests() {
  guests.clear();
  nextId = 1;
}

module.exports = {
  addGuest,
  getGuest,
  updateGuest,
  deleteGuest,
  listGuests,
  clearGuests
};
