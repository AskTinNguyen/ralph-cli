/**
 * Build Static Documentation
 *
 * Prepares Ralph CLI documentation for standalone deployment
 * (GitHub Pages, Vercel, Cloudflare Pages, etc.)
 *
 * Usage: node ui/scripts/build-static-docs.js
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');
const outputDir = path.join(__dirname, '../../docs');

// ============================================================
// Configuration
// ============================================================

const COPY_RULES = {
  // Documentation pages (preserve structure)
  docs: {
    src: path.join(publicDir, 'docs'),
    dest: path.join(outputDir, 'docs'),
    include: ['*.html', '*.css', '*.js']
  },

  // Static assets
  css: {
    src: path.join(publicDir, 'css'),
    dest: path.join(outputDir, 'css'),
    include: ['*.css']
  },
  js: {
    src: path.join(publicDir, 'js'),
    dest: path.join(outputDir, 'js'),
    include: ['*.js']
  },
  images: {
    src: publicDir,
    dest: outputDir,
    include: ['*.png', '*.jpg', '*.svg', '*.ico', '*.gif']
  }
};

// Root-level markdown files to copy
const ROOT_DOCS = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'TESTING.md',
  'DESIGN_SYSTEM.md',
  'ROADMAP.md',
  'FOR_HUMAN_BEGINNERS_GUIDE.md',
  'AGENT_QUICKSTART.md',
  'DEPLOYMENT_GUIDE.md'
];

// ============================================================
// Build Functions
// ============================================================

/**
 * Clean output directory
 */
async function cleanOutput() {
  console.log('🧹 Cleaning output directory...');
  await fs.emptyDir(outputDir);
  console.log('✅ Output directory cleaned');
}

/**
 * Copy files based on rules
 */
async function copyFiles() {
  console.log('📦 Copying files...');

  for (const [name, rule] of Object.entries(COPY_RULES)) {
    console.log(`  Copying ${name}...`);

    if (await fs.pathExists(rule.src)) {
      await fs.copy(rule.src, rule.dest, {
        filter: (src) => {
          // Include directories
          if (fs.statSync(src).isDirectory()) {
            return true;
          }

          // Check file against include patterns
          const fileName = path.basename(src);
          return rule.include.some(pattern => {
            if (pattern === '*.*') return true;
            if (pattern.startsWith('*.')) {
              return fileName.endsWith(pattern.slice(1));
            }
            return fileName === pattern;
          });
        }
      });
      console.log(`  ✅ Copied ${name}`);
    } else {
      console.log(`  ⚠️  Skipped ${name} (not found)`);
    }
  }
}

/**
 * Copy root-level documentation
 */
async function copyRootDocs() {
  console.log('📄 Copying root documentation...');

  for (const doc of ROOT_DOCS) {
    const srcPath = path.join(__dirname, '../../', doc);
    const destPath = path.join(outputDir, doc);

    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, destPath);
      console.log(`  ✅ Copied ${doc}`);
    } else {
      console.log(`  ⚠️  Skipped ${doc} (not found)`);
    }
  }
}

/**
 * Copy landing page as root index.html
 */
async function copyLandingPage() {
  console.log('🏠 Copying Ralph landing page as root index...');

  const landingPageSrc = path.join(publicDir, 'docs/index.html');
  const landingPageDest = path.join(outputDir, 'index.html');

  if (await fs.pathExists(landingPageSrc)) {
    await fs.copy(landingPageSrc, landingPageDest);
    console.log('✅ Copied landing page to root');
  } else {
    console.error('❌ Landing page not found at:', landingPageSrc);
    throw new Error('Landing page not found');
  }
}

/**
 * Create .nojekyll file (for GitHub Pages)
 */
async function createNoJekyll() {
  console.log('🚫 Creating .nojekyll file...');

  await fs.writeFile(
    path.join(outputDir, '.nojekyll'),
    '# Disable Jekyll processing for GitHub Pages\n'
  );

  console.log('✅ .nojekyll created');
}

/**
 * Create CNAME file for custom domain (optional)
 */
async function createCNAME() {
  // Only create if RALPH_DOCS_DOMAIN is set
  const domain = process.env.RALPH_DOCS_DOMAIN;

  if (domain) {
    console.log(`🌐 Creating CNAME for ${domain}...`);

    await fs.writeFile(
      path.join(outputDir, 'CNAME'),
      domain
    );

    console.log('✅ CNAME created');
  }
}

/**
 * Generate sitemap.xml
 */
async function generateSitemap() {
  console.log('🗺️  Generating sitemap...');

  const baseURL = process.env.RALPH_DOCS_URL || 'https://example.com';
  const pages = [
    '',
    'docs/',
    'docs/tutorial.html',
    'docs/commands.html',
    'docs/examples.html',
    'docs/tips.html',
    'docs/troubleshooting.html',
    'docs/streams.html',
    'docs/integration.html',
    'docs/agent-guide.html'
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url>
    <loc>${baseURL}/${page}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${page === '' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;

  await fs.writeFile(
    path.join(outputDir, 'sitemap.xml'),
    sitemap
  );

  console.log('✅ Sitemap generated');
}

/**
 * Generate robots.txt
 */
async function generateRobotsTxt() {
  console.log('🤖 Generating robots.txt...');

  const baseURL = process.env.RALPH_DOCS_URL || 'https://example.com';
  const robotsTxt = `# Ralph CLI Documentation

User-agent: *
Allow: /

Sitemap: ${baseURL}/sitemap.xml
`;

  await fs.writeFile(
    path.join(outputDir, 'robots.txt'),
    robotsTxt
  );

  console.log('✅ robots.txt generated');
}

/**
 * Generate build info
 */
async function generateBuildInfo() {
  console.log('ℹ️  Generating build info...');

  const buildInfo = {
    buildDate: new Date().toISOString(),
    version: '1.0.0',
    mode: 'static',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'production'
  };

  await fs.writeFile(
    path.join(outputDir, 'build-info.json'),
    JSON.stringify(buildInfo, null, 2)
  );

  console.log('✅ Build info generated');
}

/**
 * Print build summary
 */
async function printSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('✨ Static documentation built successfully!');
  console.log('='.repeat(50));

  const stats = {
    outputDir: path.relative(process.cwd(), outputDir),
    files: await countFiles(outputDir),
    size: await getDirectorySize(outputDir)
  };

  console.log(`\n📁 Output directory: ${stats.outputDir}`);
  console.log(`📄 Total files: ${stats.files}`);
  console.log(`💾 Total size: ${formatBytes(stats.size)}`);

  console.log('\n🚀 Next steps:');
  console.log('  1. Test locally: npx serve docs -p 8080');
  console.log('  2. Disable streams: node ui/scripts/prepare-docs-deployment.js');
  console.log('  3. Deploy to:');
  console.log('     - GitHub Pages: Enable in repo settings');
  console.log('     - Vercel: vercel --prod');
  console.log('     - Cloudflare: wrangler pages deploy docs');
  console.log('');
}

/**
 * Count files in directory
 */
async function countFiles(dir) {
  let count = 0;

  async function walk(currentDir) {
    const items = await fs.readdir(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        await walk(fullPath);
      } else {
        count++;
      }
    }
  }

  await walk(dir);
  return count;
}

/**
 * Get directory size
 */
async function getDirectorySize(dir) {
  let size = 0;

  async function walk(currentDir) {
    const items = await fs.readdir(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        await walk(fullPath);
      } else {
        size += stat.size;
      }
    }
  }

  await walk(dir);
  return size;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============================================================
// Main Build Process
// ============================================================

async function build() {
  try {
    console.log('🏗️  Building static documentation...\n');

    await cleanOutput();
    await copyFiles();
    await copyRootDocs();
    await copyLandingPage();
    await createNoJekyll();
    await createCNAME();
    await generateSitemap();
    await generateRobotsTxt();
    await generateBuildInfo();
    await printSummary();

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run build
build();
