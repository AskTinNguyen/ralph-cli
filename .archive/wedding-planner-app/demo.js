#!/usr/bin/env node
/**
 * Demo script to manually test the wedding planner app
 */

const { addGuest, getGuest, updateGuest, deleteGuest, listGuests } = require('./src/guests.js');

console.log('=== Wedding Planner App Demo ===\n');

// 1. Add guests
console.log('1. Adding guests...');
const guest1 = addGuest({ name: 'John Doe', email: 'john@example.com' });
console.log('  ✓ Added:', guest1);

const guest2 = addGuest({ name: 'Jane Smith', email: 'jane@example.com', rsvpStatus: 'confirmed' });
console.log('  ✓ Added:', guest2);

const guest3 = addGuest({ name: 'Bob Johnson', email: 'bob@example.com' });
console.log('  ✓ Added:', guest3);

// 2. List all guests
console.log('\n2. Current guest list:');
listGuests().forEach(g => {
  console.log(`  - ${g.name} (${g.email}) - RSVP: ${g.rsvpStatus}`);
});

// 3. Get a specific guest
console.log('\n3. Getting guest with ID "2":');
const retrieved = getGuest('2');
console.log('  ✓ Retrieved:', retrieved);

// 4. Update a guest
console.log('\n4. Updating guest "1" RSVP to confirmed:');
const updated = updateGuest('1', { rsvpStatus: 'confirmed' });
console.log('  ✓ Updated:', updated);

// 5. Delete a guest
console.log('\n5. Deleting guest "3":');
const deleted = deleteGuest('3');
console.log('  ✓ Deleted:', deleted);

// 6. Final guest list
console.log('\n6. Final guest list:');
listGuests().forEach(g => {
  console.log(`  - ${g.name} (${g.email}) - RSVP: ${g.rsvpStatus}`);
});

// 7. Test error handling
console.log('\n7. Testing error handling:');
try {
  addGuest({ name: 'Invalid', email: 'bad-email' });
} catch (error) {
  console.log('  ✓ Caught error:', error.message);
}

try {
  addGuest({ email: 'test@example.com' });
} catch (error) {
  console.log('  ✓ Caught error:', error.message);
}

console.log('\n=== Demo Complete ===');
