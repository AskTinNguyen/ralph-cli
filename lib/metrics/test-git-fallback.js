/**
 * Quick test for git fallback functionality
 */
const path = require('path');
const {
  getPrdCommits,
  extractStoryId,
  getCompletedStoriesFromGit,
  getStoriesWithFallback
} = require('./git-fallback');

// Test PRD-28
console.log('=== Testing Git Fallback for PRD-28 ===\n');

const prdPath = path.join(__dirname, '../../.ralph/PRD-28');

console.log('1. Getting commits for PRD-28...');
const commits = getPrdCommits(28);
console.log(`   Found ${commits.length} commits\n`);

if (commits.length > 0) {
  console.log('2. Sample commits:');
  commits.slice(0, 5).forEach(c => {
    const storyId = extractStoryId(c.subject, c.body);
    console.log(`   - ${c.subject}`);
    console.log(`     Story: ${storyId || 'none'}, Hash: ${c.hash.substring(0, 8)}, Date: ${c.timestamp}\n`);
  });
}

console.log('3. Getting completed stories from git...');
const gitStories = getCompletedStoriesFromGit(prdPath);
console.log(`   Found ${gitStories.length} stories from git\n`);

if (gitStories.length > 0) {
  console.log('4. Story details:');
  gitStories.forEach(s => {
    console.log(`   - ${s.story}`);
    console.log(`     Status: ${s.status}, Source: ${s.source}, Started: ${s.startedAt}\n`);
  });
}

console.log('5. Testing getStoriesWithFallback (empty existing runs)...');
const combined = getStoriesWithFallback(prdPath, []);
console.log(`   Combined runs: ${combined.length}`);
console.log(`   Modes: ${combined.map(r => r.mode).join(', ')}`);
console.log(`   Stories: ${combined.map(r => r.storyId || 'none').join(', ')}`);

console.log('\n=== Test Complete ===');
