/**
 * Jest test suite for guest management module
 * Tests all CRUD operations: addGuest, getGuest, updateGuest, deleteGuest, listGuests
 */

const {
  addGuest,
  getGuest,
  updateGuest,
  deleteGuest,
  listGuests,
  clearGuests
} = require('../src/guests');

// Reset storage before each test for isolation
beforeEach(() => {
  clearGuests();
});

describe('addGuest', () => {
  describe('valid inputs', () => {
    test('creates guest with default rsvpStatus', () => {
      const guest = addGuest({ name: 'John Doe', email: 'john@example.com' });

      expect(guest).toEqual({
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        rsvpStatus: 'pending'
      });
    });

    test('creates guest with custom rsvpStatus', () => {
      const guest = addGuest({
        name: 'Jane Doe',
        email: 'jane@example.com',
        rsvpStatus: 'confirmed'
      });

      expect(guest.rsvpStatus).toBe('confirmed');
    });

    test('generates unique incrementing IDs', () => {
      const guest1 = addGuest({ name: 'Guest 1', email: 'g1@example.com' });
      const guest2 = addGuest({ name: 'Guest 2', email: 'g2@example.com' });
      const guest3 = addGuest({ name: 'Guest 3', email: 'g3@example.com' });

      expect(guest1.id).toBe('1');
      expect(guest2.id).toBe('2');
      expect(guest3.id).toBe('3');
    });

    test('stores guest in internal storage', () => {
      const added = addGuest({ name: 'Test', email: 'test@example.com' });
      const retrieved = getGuest(added.id);

      expect(retrieved).toEqual(added);
    });
  });

  describe('invalid inputs', () => {
    test('throws error for missing name', () => {
      expect(() => {
        addGuest({ email: 'test@example.com' });
      }).toThrow('Name is required');
    });

    test('throws error for empty name', () => {
      expect(() => {
        addGuest({ name: '', email: 'test@example.com' });
      }).toThrow('Name is required');
    });

    test('throws error for invalid email - no @', () => {
      expect(() => {
        addGuest({ name: 'Test', email: 'invalid' });
      }).toThrow('Invalid email format');
    });

    test('throws error for invalid email - no domain', () => {
      expect(() => {
        addGuest({ name: 'Test', email: 'test@' });
      }).toThrow('Invalid email format');
    });

    test('throws error for invalid email - no dot in domain', () => {
      expect(() => {
        addGuest({ name: 'Test', email: 'test@domain' });
      }).toThrow('Invalid email format');
    });

    test('throws error for missing email', () => {
      expect(() => {
        addGuest({ name: 'Test' });
      }).toThrow('Invalid email format');
    });
  });
});

describe('getGuest', () => {
  describe('found', () => {
    test('returns guest object for existing ID', () => {
      const added = addGuest({ name: 'John', email: 'john@example.com' });
      const retrieved = getGuest('1');

      expect(retrieved).toEqual(added);
    });

    test('returns a copy, not reference', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const retrieved = getGuest('1');
      retrieved.name = 'Modified';

      const retrievedAgain = getGuest('1');
      expect(retrievedAgain.name).toBe('John');
    });
  });

  describe('not found', () => {
    test('returns null for non-existent ID', () => {
      const result = getGuest('999');
      expect(result).toBeNull();
    });

    test('returns null for null ID', () => {
      const result = getGuest(null);
      expect(result).toBeNull();
    });

    test('returns null for undefined ID', () => {
      const result = getGuest(undefined);
      expect(result).toBeNull();
    });

    test('returns null for numeric ID', () => {
      addGuest({ name: 'Test', email: 'test@example.com' });
      const result = getGuest(1); // numeric, not string
      expect(result).toBeNull();
    });
  });
});

describe('updateGuest', () => {
  describe('valid updates', () => {
    test('updates rsvpStatus', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', { rsvpStatus: 'confirmed' });

      expect(updated.rsvpStatus).toBe('confirmed');
      expect(updated.name).toBe('John');
      expect(updated.email).toBe('john@example.com');
    });

    test('updates name', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', { name: 'John Smith' });

      expect(updated.name).toBe('John Smith');
    });

    test('updates email with valid email', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', { email: 'john.smith@example.com' });

      expect(updated.email).toBe('john.smith@example.com');
    });

    test('updates multiple fields at once', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', {
        name: 'John Smith',
        rsvpStatus: 'declined'
      });

      expect(updated.name).toBe('John Smith');
      expect(updated.rsvpStatus).toBe('declined');
    });

    test('returns updated guest copy', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', { name: 'Modified' });
      updated.name = 'Further Modified';

      const retrieved = getGuest('1');
      expect(retrieved.name).toBe('Modified');
    });
  });

  describe('invalid updates', () => {
    test('throws error for invalid email update', () => {
      addGuest({ name: 'John', email: 'john@example.com' });

      expect(() => {
        updateGuest('1', { email: 'invalid' });
      }).toThrow('Invalid email format');
    });

    test('preserves original values after failed update', () => {
      addGuest({ name: 'John', email: 'john@example.com' });

      try {
        updateGuest('1', { email: 'invalid' });
      } catch (e) {
        // Expected
      }

      const guest = getGuest('1');
      expect(guest.email).toBe('john@example.com');
    });
  });

  describe('not found', () => {
    test('returns null for non-existent guest', () => {
      const result = updateGuest('999', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('id immutability', () => {
    test('cannot change id through updates', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const updated = updateGuest('1', { id: '999' });

      expect(updated.id).toBe('1');
      expect(getGuest('999')).toBeNull();
      expect(getGuest('1')).not.toBeNull();
    });
  });
});

describe('deleteGuest', () => {
  describe('exists', () => {
    test('returns true when guest deleted', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      const result = deleteGuest('1');

      expect(result).toBe(true);
    });

    test('guest no longer retrievable after deletion', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      deleteGuest('1');

      expect(getGuest('1')).toBeNull();
    });

    test('guest no longer in list after deletion', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      addGuest({ name: 'Jane', email: 'jane@example.com' });
      deleteGuest('1');

      const guests = listGuests();
      expect(guests).toHaveLength(1);
      expect(guests[0].name).toBe('Jane');
    });
  });

  describe('not exists', () => {
    test('returns false for non-existent guest', () => {
      const result = deleteGuest('999');
      expect(result).toBe(false);
    });

    test('returns false for already deleted guest', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      deleteGuest('1');
      const secondDelete = deleteGuest('1');

      expect(secondDelete).toBe(false);
    });
  });
});

describe('listGuests', () => {
  describe('empty', () => {
    test('returns empty array when no guests', () => {
      const guests = listGuests();
      expect(guests).toEqual([]);
    });
  });

  describe('populated', () => {
    test('returns all guests', () => {
      addGuest({ name: 'John', email: 'john@example.com' });
      addGuest({ name: 'Jane', email: 'jane@example.com' });

      const guests = listGuests();
      expect(guests).toHaveLength(2);
      expect(guests[0].name).toBe('John');
      expect(guests[1].name).toBe('Jane');
    });

    test('returns guests in order added', () => {
      addGuest({ name: 'Guest 1', email: 'g1@example.com' });
      addGuest({ name: 'Guest 2', email: 'g2@example.com' });
      addGuest({ name: 'Guest 3', email: 'g3@example.com' });

      const guests = listGuests();
      expect(guests.map(g => g.name)).toEqual(['Guest 1', 'Guest 2', 'Guest 3']);
    });
  });

  describe('returns copy', () => {
    test('mutations do not affect internal storage', () => {
      addGuest({ name: 'John', email: 'john@example.com' });

      const guests = listGuests();
      guests.push({ id: 'fake', name: 'Fake', email: 'fake@example.com' });
      guests[0].name = 'Modified';

      const freshList = listGuests();
      expect(freshList).toHaveLength(1);
      expect(freshList[0].name).toBe('John');
    });
  });
});
