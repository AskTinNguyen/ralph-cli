/**
 * Risk pattern definitions - high-risk keywords and file patterns
 *
 * These patterns identify code changes that warrant additional review:
 * - Security-sensitive operations
 * - Financial/payment processing
 * - Database schema changes
 * - Authentication/authorization
 */

/**
 * High-risk keywords to detect in story text
 * Each pattern has a weight that contributes to the overall risk score
 */
const HIGH_RISK_KEYWORDS = [
  // Security
  { pattern: /\bauth\b/i, keyword: "auth", weight: 3, category: "security" },
  { pattern: /\bauthentication\b/i, keyword: "authentication", weight: 3, category: "security" },
  { pattern: /\bauthorization\b/i, keyword: "authorization", weight: 3, category: "security" },
  { pattern: /\bsecurity\b/i, keyword: "security", weight: 3, category: "security" },
  { pattern: /\bpassword\b/i, keyword: "password", weight: 3, category: "security" },
  { pattern: /\bcredential/i, keyword: "credential", weight: 3, category: "security" },
  { pattern: /\btoken\b/i, keyword: "token", weight: 2, category: "security" },
  { pattern: /\bsession\b/i, keyword: "session", weight: 2, category: "security" },
  { pattern: /\bpermission/i, keyword: "permission", weight: 2, category: "security" },
  { pattern: /\baccess.?control/i, keyword: "access-control", weight: 3, category: "security" },
  { pattern: /\bencrypt/i, keyword: "encryption", weight: 3, category: "security" },
  { pattern: /\bdecrypt/i, keyword: "decryption", weight: 3, category: "security" },
  { pattern: /\bcrypto/i, keyword: "crypto", weight: 3, category: "security" },
  { pattern: /\bssl\b/i, keyword: "ssl", weight: 2, category: "security" },
  { pattern: /\btls\b/i, keyword: "tls", weight: 2, category: "security" },
  { pattern: /\bcert/i, keyword: "certificate", weight: 2, category: "security" },

  // Payment/Financial
  { pattern: /\bpayment/i, keyword: "payment", weight: 4, category: "financial" },
  { pattern: /\bbilling\b/i, keyword: "billing", weight: 4, category: "financial" },
  { pattern: /\btransaction/i, keyword: "transaction", weight: 3, category: "financial" },
  { pattern: /\bcharge\b/i, keyword: "charge", weight: 3, category: "financial" },
  { pattern: /\bstripe\b/i, keyword: "stripe", weight: 3, category: "financial" },
  { pattern: /\bpaypal\b/i, keyword: "paypal", weight: 3, category: "financial" },
  { pattern: /\brefund/i, keyword: "refund", weight: 3, category: "financial" },
  { pattern: /\binvoice/i, keyword: "invoice", weight: 2, category: "financial" },
  { pattern: /\bsubscription/i, keyword: "subscription", weight: 2, category: "financial" },

  // Database
  { pattern: /\bmigration/i, keyword: "migration", weight: 3, category: "database" },
  { pattern: /\bdatabase\b/i, keyword: "database", weight: 2, category: "database" },
  { pattern: /\bschema\b/i, keyword: "schema", weight: 3, category: "database" },
  { pattern: /\bsql\b/i, keyword: "sql", weight: 2, category: "database" },
  { pattern: /\bquery\b/i, keyword: "query", weight: 1, category: "database" },
  { pattern: /\bdelete\b/i, keyword: "delete", weight: 2, category: "database" },
  { pattern: /\bdrop\b/i, keyword: "drop", weight: 3, category: "database" },
  { pattern: /\btruncate/i, keyword: "truncate", weight: 3, category: "database" },
  { pattern: /\balter\b/i, keyword: "alter", weight: 2, category: "database" },

  // Infrastructure
  { pattern: /\bproduction\b/i, keyword: "production", weight: 3, category: "infrastructure" },
  { pattern: /\bdeploy/i, keyword: "deployment", weight: 2, category: "infrastructure" },
  { pattern: /\bci\/cd/i, keyword: "ci/cd", weight: 2, category: "infrastructure" },
  { pattern: /\bpipeline/i, keyword: "pipeline", weight: 1, category: "infrastructure" },
  { pattern: /\benvironment/i, keyword: "environment", weight: 1, category: "infrastructure" },
  { pattern: /\bconfig/i, keyword: "config", weight: 1, category: "infrastructure" },

  // Data integrity
  { pattern: /\bdata.?loss/i, keyword: "data-loss", weight: 4, category: "data" },
  { pattern: /\bcorrupt/i, keyword: "corruption", weight: 4, category: "data" },
  { pattern: /\bbackup/i, keyword: "backup", weight: 2, category: "data" },
  { pattern: /\brestore/i, keyword: "restore", weight: 2, category: "data" },
  { pattern: /\bpii\b/i, keyword: "pii", weight: 4, category: "data" },
  { pattern: /\bpersonal.?data/i, keyword: "personal-data", weight: 3, category: "data" },
  { pattern: /\bgdpr\b/i, keyword: "gdpr", weight: 3, category: "data" },
];

/**
 * High-risk file patterns - files matching these patterns increase risk score
 * Uses glob-style patterns
 */
const HIGH_RISK_FILE_PATTERNS = [
  // Security-related directories
  { pattern: "**/auth/**", weight: 3, description: "Authentication code" },
  { pattern: "**/security/**", weight: 3, description: "Security module" },
  { pattern: "**/login/**", weight: 3, description: "Login functionality" },
  { pattern: "**/session/**", weight: 2, description: "Session management" },
  { pattern: "**/permission/**", weight: 2, description: "Permission system" },

  // Database
  { pattern: "**/*.sql", weight: 3, description: "SQL files" },
  { pattern: "**/migrations/**", weight: 3, description: "Database migrations" },
  { pattern: "**/schema/**", weight: 2, description: "Schema definitions" },
  { pattern: "**/database/**", weight: 2, description: "Database module" },

  // Payment
  { pattern: "**/payment/**", weight: 4, description: "Payment processing" },
  { pattern: "**/billing/**", weight: 4, description: "Billing system" },
  { pattern: "**/checkout/**", weight: 3, description: "Checkout flow" },
  { pattern: "**/stripe/**", weight: 3, description: "Stripe integration" },

  // Infrastructure
  { pattern: "**/.env*", weight: 3, description: "Environment config" },
  { pattern: "**/secrets/**", weight: 4, description: "Secrets storage" },
  { pattern: "**/*config*", weight: 1, description: "Configuration files" },
  { pattern: "**/ci/**", weight: 2, description: "CI configuration" },
  { pattern: "**/.github/**", weight: 2, description: "GitHub workflows" },

  // Core files
  { pattern: "**/core/**", weight: 2, description: "Core functionality" },
  { pattern: "**/middleware/**", weight: 2, description: "Middleware" },
];

/**
 * Dependency patterns that indicate higher risk
 */
const HIGH_RISK_DEPENDENCY_PATTERNS = [
  { pattern: /\bpassport\b/i, weight: 2, description: "Authentication library" },
  { pattern: /\bbcrypt\b/i, weight: 2, description: "Password hashing" },
  { pattern: /\bjsonwebtoken\b/i, weight: 2, description: "JWT library" },
  { pattern: /\bstripe\b/i, weight: 3, description: "Payment processor" },
  { pattern: /\bmongodb\b/i, weight: 2, description: "Database driver" },
  { pattern: /\bpg\b/i, weight: 2, description: "PostgreSQL driver" },
  { pattern: /\bmysql/i, weight: 2, description: "MySQL driver" },
  { pattern: /\bsequelize\b/i, weight: 2, description: "ORM" },
  { pattern: /\btypeorm\b/i, weight: 2, description: "ORM" },
  { pattern: /\bprisma\b/i, weight: 2, description: "ORM" },
  { pattern: /\bexpress\b/i, weight: 1, description: "Web framework" },
  { pattern: /\bhelmet\b/i, weight: 1, description: "Security middleware" },
];

/**
 * Risk categories with descriptions
 */
const RISK_CATEGORIES = {
  security: {
    name: "Security",
    description: "Authentication, authorization, encryption",
    baseWeight: 1.5,
  },
  financial: {
    name: "Financial",
    description: "Payment processing, billing, transactions",
    baseWeight: 2.0,
  },
  database: {
    name: "Database",
    description: "Schema changes, migrations, data operations",
    baseWeight: 1.3,
  },
  infrastructure: {
    name: "Infrastructure",
    description: "Deployment, configuration, environments",
    baseWeight: 1.2,
  },
  data: {
    name: "Data Integrity",
    description: "Data protection, backup, PII handling",
    baseWeight: 1.5,
  },
};

/**
 * Default risk configuration
 */
const DEFAULT_RISK_CONFIG = {
  threshold: 7, // Score at or above this is "high risk"
  pauseOnHighRisk: true,
  weights: {
    keyword: 0.3,
    filePattern: 0.3,
    dependency: 0.2,
    scope: 0.2,
  },
};

module.exports = {
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
};
